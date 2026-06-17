import { supabase } from '@/lib/supabase';
import type { AnalyticsSummary } from '@/types';

export async function fetchAnalyticsSummarySupabase(
  months = 6,
): Promise<AnalyticsSummary> {

  const [{ data: summary }, { data: customers }, { data: revenue }] =
    await Promise.all([
      supabase.from('analytics_summary').select('*').single(),
      supabase.from('top_customers').select('*').limit(10),
      supabase.from('monthly_revenue').select('*'),
    ]);

  return {
    period: `${months} months`,
    total_revenue: Number(summary?.total_revenue ?? 0),
    total_invoices: Number(summary?.total_invoices ?? 0),
    avg_invoice_value: Number(summary?.avg_invoice_value ?? 0),
    top_customers: customers ?? [],
    revenue_by_month: revenue ?? [],
    top_skus: [],
    material_split: {
      SS: 0,
      MS: 0,
    },
    growth_rate: 0,
  };
}