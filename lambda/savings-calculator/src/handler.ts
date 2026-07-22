/**
 * Stellar Savings Calculator Lambda
 *
 * Triggered by: EventBridge schedule (monthly) OR manual invoke OR API Gateway POST
 *
 * What it does:
 *  1. Reads app config from cto_savings_config (costs, launch dates)
 *  2. Reads inflation rates from cto_savings_inflation (per calendar year %)
 *  3. For each app, walks every month from launch_date → today
 *     applying compound inflation per year to outsourced costs
 *  4. Computes monthly (current inflated month), yearly (12 months),
 *     and till-date (all months since launch) totals
 *  5. Upserts single row into cto_savings_cache
 *
 * Inflation logic:
 *  - Base year is the year the app launched
 *  - Each subsequent calendar year, outsourced cost compounds by that year's rate
 *  - Our cost (AWS/Bedrock) stays flat — cloud costs rarely inflate meaningfully
 *  - If a year has no inflation row, falls back to the most recent known rate
 */

import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Handler } from 'aws-lambda';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AppConfig {
  app_key: string;
  app_name: string;
  app_description: string;
  our_cost_monthly: number;
  outsourced_saas: number;
  outsourced_agency: number;
  outsourced_engineer: number;
  outsourced_llm: number;
  outsourced_legend: string;
  launch_date: string; // ISO date string YYYY-MM-DD
  is_active: boolean;
  sort_order: number;
}

interface InflationRow {
  year: number;
  rate_pct: number;
}

interface AppBreakdownItem {
  app_key: string;
  app_name: string;
  app_description: string;
  our_cost_monthly: number;
  outsourced_total_monthly: number; // current inflated monthly outsourced
  saving_monthly: number;
  outsourced_legend: string;
  legend_items: LegendItem[];
  launch_date: string;
}

interface LegendItem {
  label: string;
  amount: number;
}

interface ComputedTotals {
  monthly_our_cost: number;
  monthly_outsourced: number;
  monthly_saving: number;
  yearly_our_cost: number;
  yearly_outsourced: number;
  yearly_saving: number;
  tilldate_our_cost: number;
  tilldate_outsourced: number;
  tilldate_saving: number;
  tilldate_months: number;
  app_breakdown: AppBreakdownItem[];
}

// ─── SSM helper ───────────────────────────────────────────────────────────────

const ssm = new SSMClient({});

async function getParam(name: string): Promise<string> {
  const cmd = new GetParameterCommand({ Name: name, WithDecryption: true });
  const res = await ssm.send(cmd);
  const val = res.Parameter?.Value;
  if (!val) throw new Error(`SSM parameter not found: ${name}`);
  return val;
}

// ─── Supabase factory ─────────────────────────────────────────────────────────

async function buildSupabase(): Promise<SupabaseClient> {
  const [url, key] = await Promise.all([
    getParam('/stellar/supabase/url'),
    getParam('/stellar/supabase/service-role-key'),
  ]);
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ─── Inflation engine ─────────────────────────────────────────────────────────

/**
 * Build a lookup: year → cumulative multiplier relative to the base year.
 * If 2024 = 10%, 2025 = 10%, 2026 = 10%:
 *   baseYear 2024 → 2024: 1.00, 2025: 1.10, 2026: 1.21
 */
function buildInflationMultipliers(
  inflationRows: InflationRow[],
  baseYear: number,
  upToYear: number,
): Map<number, number> {
  // Sort by year ascending
  const sorted = [...inflationRows].sort((a, b) => a.year - b.year);

  // Find the fallback rate (most recent known)
  const fallbackRate =
    sorted.length > 0 ? sorted[sorted.length - 1].rate_pct : 10;

  const rateMap = new Map<number, number>(sorted.map((r) => [r.year, r.rate_pct]));

  const multipliers = new Map<number, number>();
  let cumulative = 1.0;

  for (let year = baseYear; year <= upToYear; year++) {
    multipliers.set(year, cumulative);
    // Apply this year's rate to get next year's multiplier
    const rate = rateMap.get(year) ?? fallbackRate;
    cumulative = cumulative * (1 + rate / 100);
  }

  return multipliers;
}

/**
 * Return the inflation multiplier for a given year.
 * Years before base are treated as 1.0 (no inflation on historical months
 * before tracking started).
 */
function getMultiplier(
  multipliers: Map<number, number>,
  year: number,
): number {
  return multipliers.get(year) ?? (multipliers.size > 0 ? [...multipliers.values()].at(-1)! : 1.0);
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

/** Returns { year, month } for the current month */
function today(): { year: number; month: number } {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

/** Parse YYYY-MM-DD → { year, month } */
function parseDate(iso: string): { year: number; month: number } {
  const [y, m] = iso.split('-').map(Number);
  return { year: y!, month: m! };
}

/**
 * Walk every month from startYear/startMonth → endYear/endMonth inclusive.
 * Calls cb(year, month) for each step.
 */
function walkMonths(
  start: { year: number; month: number },
  end: { year: number; month: number },
  cb: (year: number, month: number) => void,
): void {
  let { year, month } = start;
  while (year < end.year || (year === end.year && month <= end.month)) {
    cb(year, month);
    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }
}

// ─── Per-app computation ──────────────────────────────────────────────────────

interface AppResult {
  breakdown: AppBreakdownItem;
  tilldate_our: number;
  tilldate_outsourced: number;
  tilldate_months: number;
  monthly_outsourced_inflated: number; // current month's inflated outsourced cost
}

function computeApp(
  app: AppConfig,
  inflationRows: InflationRow[],
  now: { year: number; month: number },
): AppResult {
  const launch = parseDate(app.launch_date);
  const baseOutsourced =
    app.outsourced_saas +
    app.outsourced_agency +
    app.outsourced_engineer +
    app.outsourced_llm;

  // Build multipliers from launch year → current year
  const multipliers = buildInflationMultipliers(
    inflationRows,
    launch.year,
    now.year,
  );

  let tilldate_our = 0;
  let tilldate_outsourced = 0;
  let tilldate_months = 0;
  let monthly_outsourced_inflated = 0;

  walkMonths(launch, now, (year, month) => {
    const mult = getMultiplier(multipliers, year);
    const inflatedOutsourced = baseOutsourced * mult;

    tilldate_our += app.our_cost_monthly;
    tilldate_outsourced += inflatedOutsourced;
    tilldate_months++;

    // Track current month's value (last iteration = current month)
    if (year === now.year && month === now.month) {
      monthly_outsourced_inflated = inflatedOutsourced;
    }
  });

  // If launch is in the future (misconfiguration), clamp to 0
  if (tilldate_months === 0) {
    monthly_outsourced_inflated = baseOutsourced;
    tilldate_months = 1;
    tilldate_our = app.our_cost_monthly;
    tilldate_outsourced = baseOutsourced;
  }

  // Build legend items (only non-zero components)
  const legendItems: LegendItem[] = [];
  const currentMult = getMultiplier(multipliers, now.year);
  if (app.outsourced_saas > 0)
    legendItems.push({ label: 'SaaS tools', amount: Math.round(app.outsourced_saas * currentMult) });
  if (app.outsourced_agency > 0)
    legendItems.push({ label: 'Agency / freelancer', amount: Math.round(app.outsourced_agency * currentMult) });
  if (app.outsourced_engineer > 0)
    legendItems.push({ label: 'Engineer cost share', amount: Math.round(app.outsourced_engineer * currentMult) });
  if (app.outsourced_llm > 0)
    legendItems.push({ label: 'LLM / AI API equiv.', amount: Math.round(app.outsourced_llm * currentMult) });

  const breakdown: AppBreakdownItem = {
    app_key: app.app_key,
    app_name: app.app_name,
    app_description: app.app_description,
    our_cost_monthly: app.our_cost_monthly,
    outsourced_total_monthly: Math.round(monthly_outsourced_inflated),
    saving_monthly: Math.round(monthly_outsourced_inflated - app.our_cost_monthly),
    outsourced_legend: app.outsourced_legend,
    legend_items: legendItems,
    launch_date: app.launch_date,
  };

  return {
    breakdown,
    tilldate_our: Math.round(tilldate_our),
    tilldate_outsourced: Math.round(tilldate_outsourced),
    tilldate_months,
    monthly_outsourced_inflated: Math.round(monthly_outsourced_inflated),
  };
}

// ─── Main computation ─────────────────────────────────────────────────────────

function compute(
  apps: AppConfig[],
  inflationRows: InflationRow[],
): ComputedTotals {
  const now = today();
  const activeApps = apps
    .filter((a) => a.is_active)
    .sort((a, b) => a.sort_order - b.sort_order);

  let totalMonthlyOur = 0;
  let totalMonthlyOutsourced = 0;
  let totalYearlyOur = 0;
  let totalYearlyOutsourced = 0;
  let totalTilldateOur = 0;
  let totalTilldateOutsourced = 0;
  let maxMonths = 0;
  const breakdowns: AppBreakdownItem[] = [];

  for (const app of activeApps) {
    const result = computeApp(app, inflationRows, now);

    totalMonthlyOur += app.our_cost_monthly;
    totalMonthlyOutsourced += result.monthly_outsourced_inflated;
    totalYearlyOur += app.our_cost_monthly * 12;
    totalYearlyOutsourced += result.monthly_outsourced_inflated * 12;
    totalTilldateOur += result.tilldate_our;
    totalTilldateOutsourced += result.tilldate_outsourced;
    maxMonths = Math.max(maxMonths, result.tilldate_months);
    breakdowns.push(result.breakdown);
  }

  return {
    monthly_our_cost: Math.round(totalMonthlyOur),
    monthly_outsourced: Math.round(totalMonthlyOutsourced),
    monthly_saving: Math.round(totalMonthlyOutsourced - totalMonthlyOur),
    yearly_our_cost: Math.round(totalYearlyOur),
    yearly_outsourced: Math.round(totalYearlyOutsourced),
    yearly_saving: Math.round(totalYearlyOutsourced - totalYearlyOur),
    tilldate_our_cost: Math.round(totalTilldateOur),
    tilldate_outsourced: Math.round(totalTilldateOutsourced),
    tilldate_saving: Math.round(totalTilldateOutsourced - totalTilldateOur),
    tilldate_months: maxMonths,
    app_breakdown: breakdowns,
  };
}

// ─── Upsert to Supabase ───────────────────────────────────────────────────────

async function upsertCache(
  supabase: SupabaseClient,
  totals: ComputedTotals,
): Promise<void> {
  // Delete existing singleton then insert fresh (simpler than true upsert with partial index)
  await supabase.from('cto_savings_cache').delete().neq('id', 0);

  const { error } = await supabase.from('cto_savings_cache').insert({
    computed_at: new Date().toISOString(),
    ...totals,
    app_breakdown: totals.app_breakdown,
  });

  if (error) throw new Error(`Supabase upsert failed: ${error.message}`);
}

// ─── Lambda handler ───────────────────────────────────────────────────────────

export const handler: Handler = async (event) => {
  console.log('[savings-calculator] invoked', JSON.stringify(event).slice(0, 200));

  try {
    const supabase = await buildSupabase();

    // Fetch config and inflation in parallel
    const [configRes, inflationRes] = await Promise.all([
      supabase
        .from('cto_savings_config')
        .select('*')
        .eq('is_active', true)
        .order('sort_order'),
      supabase
        .from('cto_savings_inflation')
        .select('year, rate_pct')
        .order('year'),
    ]);

    if (configRes.error) throw new Error(`Config fetch: ${configRes.error.message}`);
    if (inflationRes.error) throw new Error(`Inflation fetch: ${inflationRes.error.message}`);

    const apps = configRes.data as AppConfig[];
    const inflationRows = inflationRes.data as InflationRow[];

    console.log(`[savings-calculator] ${apps.length} apps, ${inflationRows.length} inflation years`);

    const totals = compute(apps, inflationRows);

    console.log('[savings-calculator] computed', {
      monthly_saving: totals.monthly_saving,
      yearly_saving: totals.yearly_saving,
      tilldate_saving: totals.tilldate_saving,
      tilldate_months: totals.tilldate_months,
    });

    await upsertCache(supabase, totals);

    console.log('[savings-calculator] cache updated ✓');

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        success: true,
        computed_at: new Date().toISOString(),
        summary: {
          monthly_saving: totals.monthly_saving,
          yearly_saving: totals.yearly_saving,
          tilldate_saving: totals.tilldate_saving,
          tilldate_months: totals.tilldate_months,
          apps_computed: apps.length,
        },
      }),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[savings-calculator] ERROR', msg);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: false, error: msg }),
    };
  }
};