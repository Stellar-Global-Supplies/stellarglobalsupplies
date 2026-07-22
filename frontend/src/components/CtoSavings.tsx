/**
 * CtoSavings
 * Replaces the DataFlowDiagram at the top of the Dashboard.
 * Shows three period cards (monthly / yearly / till date), each with
 * Our Solution vs Outsourced costs and savings. Clicking a card expands
 * a per-app breakdown table with a legend explaining outsourced components.
 *
 * Data source: Supabase cto_savings_cache (written by savings-calculator Lambda)
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  TrendingUp,
  ChevronDown,
  ChevronUp,
  Zap,
  RefreshCw,
  AlertCircle,
  Info,
  Building2,
  Cpu,
  Users,
  Wrench,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

interface LegendItem {
  label: string;
  amount: number;
}

interface AppBreakdown {
  app_key: string;
  app_name: string;
  app_description: string;
  our_cost_monthly: number;
  outsourced_total_monthly: number;
  saving_monthly: number;
  outsourced_legend: string;
  legend_items: LegendItem[];
  launch_date: string;
}

interface SavingsCache {
  computed_at: string;
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
  app_breakdown: AppBreakdown[];
}

type Period = 'monthly' | 'yearly' | 'tilldate';

// ─── Data fetch ───────────────────────────────────────────────────────────────

async function fetchSavingsCache(): Promise<SavingsCache> {
  const { data, error } = await supabase
    .from('cto_savings_cache')
    .select('*')
    .order('computed_at', { ascending: false })
    .limit(1)
    .single();

  if (error) throw new Error(error.message);
  return data as SavingsCache;
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function inr(n: number): string {
  if (n >= 10_00_000) return `₹${(n / 10_00_000).toFixed(2)}L`;
  if (n >= 1_00_000) return `₹${(n / 1_00_000).toFixed(1)}L`;
  if (n >= 1_000) return `₹${(n / 1_000).toFixed(1)}K`;
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

function inrFull(n: number): string {
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

function savingPct(our: number, outsourced: number): string {
  if (outsourced === 0) return '0%';
  return `${((1 - our / outsourced) * 100).toFixed(1)}%`;
}

// ─── Legend icon map ──────────────────────────────────────────────────────────

const LEGEND_ICONS: Record<string, React.ReactNode> = {
  'SaaS tools':           <Wrench size={11} className="text-violet-400" />,
  'Agency / freelancer':  <Building2 size={11} className="text-amber-400" />,
  'Engineer cost share':  <Users size={11} className="text-sky-400" />,
  'LLM / AI API equiv.':  <Cpu size={11} className="text-emerald-400" />,
};

// ─── Period card ──────────────────────────────────────────────────────────────

interface PeriodCardProps {
  period: Period;
  active: boolean;
  label: string;
  sublabel: string;
  saving: number;
  ourCost: number;
  outsourced: number;
  months?: number;
  onClick: () => void;
}

function PeriodCard({
  active,
  label,
  sublabel,
  saving,
  ourCost,
  outsourced,
  months,
  onClick,
}: PeriodCardProps) {
  const pct = savingPct(ourCost, outsourced);

  return (
    <button
      onClick={onClick}
      className={`
        w-full text-left rounded-2xl border p-5 transition-all duration-200 group
        ${active
          ? 'bg-indigo-950/60 border-indigo-500/50 shadow-lg shadow-indigo-500/10'
          : 'bg-slate-900/60 border-slate-800 hover:border-slate-600 hover:bg-slate-900/80'}
      `}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-0.5">{label}</p>
          <p className="text-2xs text-slate-600">{sublabel}</p>
        </div>
        {active
          ? <ChevronUp size={14} className="text-indigo-400 mt-0.5 shrink-0" />
          : <ChevronDown size={14} className="text-slate-600 mt-0.5 shrink-0 group-hover:text-slate-400 transition-colors" />}
      </div>

      {/* Saving big number */}
      <p className={`text-3xl font-black tabular-nums mb-1 ${active ? 'text-emerald-400' : 'text-slate-100 group-hover:text-emerald-400 transition-colors'}`}>
        {inr(saving)}
      </p>
      <p className="text-xs text-slate-500 mb-4">
        saved vs outsourced{months != null ? ` · ${months} mo.` : ''}
      </p>

      {/* Our vs outsourced split */}
      <div className="grid grid-cols-3 gap-2 pt-3 border-t border-white/8">
        <div>
          <p className="text-2xs text-slate-600 mb-1">Our cost</p>
          <p className="text-sm font-bold text-emerald-400 tabular-nums">{inr(ourCost)}</p>
        </div>
        <div>
          <p className="text-2xs text-slate-600 mb-1">Outsourced</p>
          <p className="text-sm font-bold text-red-400 tabular-nums">{inr(outsourced)}</p>
        </div>
        <div>
          <p className="text-2xs text-slate-600 mb-1">Saving</p>
          <p className="text-sm font-bold text-indigo-300 tabular-nums">{pct}</p>
        </div>
      </div>
    </button>
  );
}

// ─── Legend pill ──────────────────────────────────────────────────────────────

function LegendPill({ item }: { item: LegendItem }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-2xs text-slate-400">
      {LEGEND_ICONS[item.label] ?? <Info size={11} className="text-slate-500" />}
      {item.label}
      <span className="font-semibold text-slate-300">{inrFull(item.amount)}/mo</span>
    </span>
  );
}

// ─── App breakdown row ────────────────────────────────────────────────────────

function AppRow({ app, period, multiplier }: { app: AppBreakdown; period: Period; multiplier: number }) {
  const [open, setOpen] = useState(false);

  const ourCost  = period === 'monthly' ? app.our_cost_monthly
    : period === 'yearly'  ? app.our_cost_monthly * 12
    : app.our_cost_monthly * multiplier;

  const outsourced = period === 'monthly' ? app.outsourced_total_monthly
    : period === 'yearly'  ? app.outsourced_total_monthly * 12
    : app.outsourced_total_monthly * multiplier;

  const saving = outsourced - ourCost;

  return (
    <>
      <tr
        className="border-b border-white/5 hover:bg-white/4 transition-colors cursor-pointer select-none"
        onClick={() => setOpen((o) => !o)}
      >
        <td className="py-3 pl-4 pr-2">
          <div className="flex items-center gap-2">
            {open
              ? <ChevronUp size={12} className="text-slate-500 shrink-0" />
              : <ChevronDown size={12} className="text-slate-600 shrink-0" />}
            <div>
              <p className="text-sm font-semibold text-slate-200">{app.app_name}</p>
              <p className="text-2xs text-slate-500 mt-0.5 leading-relaxed">{app.app_description}</p>
            </div>
          </div>
        </td>
        <td className="py-3 px-2 text-right tabular-nums">
          <span className="text-sm font-bold text-emerald-400">{inrFull(ourCost)}</span>
        </td>
        <td className="py-3 px-2 text-right tabular-nums">
          <span className="text-sm text-red-400">{inrFull(outsourced)}</span>
        </td>
        <td className="py-3 pl-2 pr-4 text-right tabular-nums">
          <span className="text-sm font-bold text-slate-100">{inrFull(saving)}</span>
        </td>
      </tr>

      {/* Expanded legend row */}
      {open && (
        <tr className="bg-indigo-950/20 border-b border-indigo-500/10">
          <td colSpan={4} className="py-3 px-6">
            <div className="mb-2">
              <p className="text-2xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                Outsourced equivalent breaks down as:
              </p>
              <div className="flex flex-wrap gap-2">
                {app.legend_items.map((item) => (
                  <LegendPill key={item.label} item={item} />
                ))}
              </div>
            </div>
            <p className="text-2xs text-slate-600 mt-2 leading-relaxed italic">
              {app.outsourced_legend}
            </p>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function CtoSavings() {
  const [activePeriod, setActivePeriod] = useState<Period>('monthly');

  const { data, isLoading, isError, refetch, isFetching } = useQuery<SavingsCache>({
    queryKey: ['cto-savings-cache'],
    queryFn: fetchSavingsCache,
    staleTime: 10 * 60 * 1000, // 10 min — Lambda updates monthly, no need to refetch often
    retry: 2,
  });

  // ── Loading skeleton ──
  if (isLoading) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="h-4 w-40 rounded bg-slate-800 animate-pulse" />
        </div>
        <div className="grid grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-40 rounded-2xl bg-slate-800 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  // ── Error state ──
  if (isError || !data) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-slate-400">
            <AlertCircle size={14} className="text-amber-400" />
            <span className="text-sm">Savings data unavailable</span>
          </div>
          <button
            onClick={() => refetch()}
            className="text-xs text-slate-500 hover:text-slate-300 flex items-center gap-1"
          >
            <RefreshCw size={11} /> Retry
          </button>
        </div>
        <p className="text-2xs text-slate-600">
          Run the savings-calculator Lambda to populate this section, or check Supabase cto_savings_cache.
        </p>
      </div>
    );
  }

  // ── Till-date multiplier (average months across apps, use tilldate_months) ──
  const tdMonths = data.tilldate_months || 1;

  const periods: Array<{
    period: Period;
    label: string;
    sublabel: string;
    saving: number;
    ourCost: number;
    outsourced: number;
    months?: number;
  }> = [
    {
      period: 'monthly',
      label: 'This month',
      sublabel: 'Current inflated monthly cost',
      saving: data.monthly_saving,
      ourCost: data.monthly_our_cost,
      outsourced: data.monthly_outsourced,
    },
    {
      period: 'yearly',
      label: 'This year',
      sublabel: '12 × current inflated monthly',
      saving: data.yearly_saving,
      ourCost: data.yearly_our_cost,
      outsourced: data.yearly_outsourced,
    },
    {
      period: 'tilldate',
      label: 'Till date',
      sublabel: `Since launch · compound inflation applied`,
      saving: data.tilldate_saving,
      ourCost: data.tilldate_our_cost,
      outsourced: data.tilldate_outsourced,
      months: tdMonths,
    },
  ];

  const lastComputed = new Date(data.computed_at).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">

      {/* Section header */}
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="h-6 w-6 rounded-lg bg-emerald-500/15 flex items-center justify-center">
              <TrendingUp size={13} className="text-emerald-400" />
            </div>
            <h2 className="text-sm font-bold text-slate-100">CTO Cost Intelligence</h2>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-2xs font-semibold text-emerald-400">
              <Zap size={9} /> LIVE
            </span>
          </div>
          <p className="text-xs text-slate-500 ml-8">
            What Stellar's CTO-as-code saves vs hiring agencies + engineers + SaaS tools
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-2xs text-slate-600">Last computed</p>
          <p className="text-2xs text-slate-500 font-medium">{lastComputed}</p>
        </div>
      </div>

      {/* 3 period cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        {periods.map((p) => (
          <PeriodCard
            key={p.period}
            {...p}
            active={activePeriod === p.period}
            onClick={() => setActivePeriod(p.period)}
          />
        ))}
      </div>

      {/* Per-app breakdown table */}
      <div className="rounded-2xl border border-white/8 overflow-hidden">

        {/* Table header */}
        <div className="grid grid-cols-[1fr_auto_auto_auto] bg-slate-950/60 border-b border-white/8">
          <div className="py-2.5 pl-8 pr-2 text-2xs font-semibold uppercase tracking-wider text-slate-500">
            Platform / App
          </div>
          <div className="py-2.5 px-2 text-right text-2xs font-semibold uppercase tracking-wider text-slate-500 w-28">
            Our cost
          </div>
          <div className="py-2.5 px-2 text-right text-2xs font-semibold uppercase tracking-wider text-slate-500 w-28">
            Outsourced
          </div>
          <div className="py-2.5 pl-2 pr-4 text-right text-2xs font-semibold uppercase tracking-wider text-slate-500 w-28">
            Saving
          </div>
        </div>

        <table className="w-full">
          <tbody>
            {data.app_breakdown.map((app) => (
              <AppRow
                key={app.app_key}
                app={app}
                period={activePeriod}
                multiplier={tdMonths}
              />
            ))}
          </tbody>

          {/* Totals footer */}
          <tfoot>
            <tr className="border-t-2 border-white/10 bg-slate-950/40">
              <td className="py-3.5 pl-8 pr-2">
                <span className="text-sm font-bold text-slate-300">Total</span>
              </td>
              <td className="py-3.5 px-2 text-right tabular-nums">
                <span className="text-sm font-black text-emerald-400">
                  {inrFull(
                    activePeriod === 'monthly' ? data.monthly_our_cost
                    : activePeriod === 'yearly' ? data.yearly_our_cost
                    : data.tilldate_our_cost,
                  )}
                </span>
              </td>
              <td className="py-3.5 px-2 text-right tabular-nums">
                <span className="text-sm font-bold text-red-400">
                  {inrFull(
                    activePeriod === 'monthly' ? data.monthly_outsourced
                    : activePeriod === 'yearly' ? data.yearly_outsourced
                    : data.tilldate_outsourced,
                  )}
                </span>
              </td>
              <td className="py-3.5 pl-2 pr-4 text-right tabular-nums">
                <span className="text-sm font-black text-slate-100">
                  {inrFull(
                    activePeriod === 'monthly' ? data.monthly_saving
                    : activePeriod === 'yearly' ? data.yearly_saving
                    : data.tilldate_saving,
                  )}
                </span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Legend key */}
      <div className="mt-4 rounded-xl bg-white/4 border border-white/8 px-4 py-3">
        <p className="text-2xs font-semibold uppercase tracking-wider text-slate-600 mb-2">
          Outsourced cost legend
        </p>
        <div className="flex flex-wrap gap-3">
          {[
            { label: 'SaaS tools', icon: <Wrench size={11} className="text-violet-400" />, desc: 'Zoho, PandaDoc, Datadog, Mailchimp, ChatBot SaaS…' },
            { label: 'Agency / freelancer', icon: <Building2 size={11} className="text-amber-400" />, desc: 'Social media agency, web design agency, doc writer…' },
            { label: 'Engineer cost share', icon: <Users size={11} className="text-sky-400" />, desc: 'Fractional senior engineer @ ₹1L/mo Pune market rate, inflated YoY' },
            { label: 'LLM / AI API equiv.', icon: <Cpu size={11} className="text-emerald-400" />, desc: 'OpenAI / Azure OpenAI equivalent for Bedrock usage' },
          ].map((item) => (
            <div key={item.label} className="flex items-start gap-2">
              <span className="mt-0.5">{item.icon}</span>
              <div>
                <p className="text-2xs font-semibold text-slate-400">{item.label}</p>
                <p className="text-2xs text-slate-600 leading-relaxed">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="text-2xs text-slate-700 mt-3 leading-relaxed">
          Inflation is compounded year-over-year using rates in <code className="text-slate-600">cto_savings_inflation</code>.
          Our AWS + Bedrock cost stays flat. Update inflation rates or app costs in Supabase — the Lambda recomputes automatically each month.
        </p>
      </div>

      {/* Refresh button */}
      <div className="flex justify-end mt-3">
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-2xs text-slate-500 hover:text-slate-300 border border-white/8 hover:border-white/20 bg-white/4 hover:bg-white/8 transition-all disabled:opacity-50"
        >
          <RefreshCw size={11} className={isFetching ? 'animate-spin' : ''} />
          Refresh data
        </button>
      </div>
    </section>
  );
}