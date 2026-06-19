import { supabase } from '@/lib/supabase';
import type { AnalyticsSummary } from '@/types';

export async function fetchAnalyticsSummarySupabase(
  months = 6,
  year?: string,
  month?: string,
): Promise<AnalyticsSummary> {

  // Build date range filter if year is specified
  const dateFilter: { gte: string; lte: string } | null = year
    ? month
      ? (() => {
          const lastDay = new Date(Number(year), Number(month), 0).getDate();
          return { gte: `${year}-${month}-01`, lte: `${year}-${month}-${String(lastDay).padStart(2, '0')}` };
        })()
      : { gte: `${year}-01-01`, lte: `${year}-12-31` }
    : null;

  const monthsFilter = dateFilter
    ? supabase.from('monthly_revenue').select('*').gte('month', dateFilter.gte.slice(0, 7)).lte('month', dateFilter.lte.slice(0, 7)).order('month', { ascending: false })
    : supabase.from('monthly_revenue').select('*').order('month', { ascending: false }).limit(months);

  const businessFilter = dateFilter
    ? supabase.from('monthly_business').select('*').gte('month', dateFilter.gte.slice(0, 7)).lte('month', dateFilter.lte.slice(0, 7)).order('month', { ascending: false })
    : supabase.from('monthly_business').select('*').order('month', { ascending: false }).limit(months);

  const gstFilter = dateFilter
    ? supabase.from('monthly_gst').select('*').gte('month', dateFilter.gte.slice(0, 7)).lte('month', dateFilter.lte.slice(0, 7)).order('month', { ascending: false })
    : supabase.from('monthly_gst').select('*').order('month', { ascending: false }).limit(months);

  // For summary/top tables, we need to filter by invoice_date on the base tables
  // Since we can't easily filter views, we'll use the available views as-is
  // and apply client-side filtering where possible
  const summaryQuery = supabase.from('analytics_summary').select('*').single();
  const customersQuery = supabase.from('top_customers').select('*').limit(10);
  const skusQuery = supabase.from('top_skus').select('*').limit(10);
  const materialsQuery = supabase.from('material_split').select('*');
  const suppliersQuery = supabase.from('top_suppliers').select('*').limit(10);
  const marginQuery = supabase.from('item_margin').select('*').limit(10);

  const [
    { data: summary },
    { data: customers },
    { data: revenue },
    { data: skus },
    { data: materials },
    { data: suppliers },
    { data: business },
    { data: gst },
    { data: margin },
  ] = await Promise.all([
    summaryQuery,
    customersQuery,
    monthsFilter,
    skusQuery,
    materialsQuery,
    suppliersQuery,
    businessFilter,
    gstFilter,
    marginQuery,
  ]);

  const byMonthAsc = <T extends { month: string }>(rows: T[] | null) =>
    [...(rows ?? [])].sort((a, b) => a.month.localeCompare(b.month));

  const businessByMonth = byMonthAsc(business).map((row) => ({
    month: row.month,
    sales: Number(row.sales ?? 0),
    purchases: Number(row.purchases ?? 0),
    gross_profit: Number(row.gross_profit ?? 0),
    gross_margin_pct: Number(row.gross_margin_pct ?? 0),
    sales_invoices: Number(row.sales_invoices ?? 0),
    purchase_invoices: Number(row.purchase_invoices ?? 0),
  }));

  const materialSplit = (materials ?? []).reduce(
    (acc, row) => {
      const key = String(row.material_type ?? 'OTHER') as keyof typeof acc;
      acc[key] = (acc[key] ?? 0) + Number(row.total_revenue ?? 0);
      return acc;
    },
    { SS: 0, MS: 0, SERVICE: 0, OTHER: 0 },
  );

  const firstMonth = businessByMonth.at(0);
  const lastMonth = businessByMonth.at(-1);
  const growthRate =
    firstMonth && lastMonth && firstMonth.sales > 0
      ? ((lastMonth.sales - firstMonth.sales) / firstMonth.sales) * 100
      : 0;

  // When filtering by year/month, compute summary from filtered data
  // Otherwise use all-time summary view
  const useFilteredSummary = !!(year || (months !== 6));
  const filteredTotalRevenue = businessByMonth.reduce((s, m) => s + m.sales, 0);
  const filteredTotalPurchase = businessByMonth.reduce((s, m) => s + m.purchases, 0);
  const filteredGrossProfit = businessByMonth.reduce((s, m) => s + m.gross_profit, 0);
  const filteredInvoices = businessByMonth.reduce((s, m) => s + m.sales_invoices, 0);

  const totalRevenue = useFilteredSummary ? filteredTotalRevenue : Number(summary?.total_revenue ?? 0);
  const totalPurchase = useFilteredSummary ? filteredTotalPurchase : Number(summary?.total_purchase ?? 0);
  const grossProfit = useFilteredSummary ? filteredGrossProfit : Number(summary?.gross_profit ?? 0);
  const grossMarginPct = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;
  const totalInvoices = useFilteredSummary ? filteredInvoices : Number(summary?.total_invoices ?? 0);

  // Build period label
  let periodLabel: string;
  if (year && month) {
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    periodLabel = `${monthNames[parseInt(month) - 1]} ${year}`;
  } else if (year) {
    periodLabel = `FY ${year}`;
  } else {
    periodLabel = `Last ${months} months`;
  }

  return {
    period: periodLabel,
    total_revenue: totalRevenue,
    total_purchase: totalPurchase,
    gross_profit: grossProfit,
    gross_margin_pct: grossMarginPct,
    total_invoices: totalInvoices,
    avg_invoice_value: Number(summary?.avg_invoice_value ?? 0),
    customer_count: Number(summary?.customer_count ?? customers?.length ?? 0),
    supplier_count: Number(summary?.supplier_count ?? suppliers?.length ?? 0),
    top_customers: (customers ?? []).map((row) => ({
      customer_name: row.customer_name,
      total_revenue: Number(row.total_revenue ?? 0),
      invoice_count: Number(row.invoice_count ?? 0),
    })),
    top_suppliers: (suppliers ?? []).map((row) => ({
      supplier_name: row.supplier_name,
      total_purchase: Number(row.total_purchase ?? 0),
      invoice_count: Number(row.invoice_count ?? 0),
    })),
    revenue_by_month: byMonthAsc(revenue as any[]).map((row: any) => ({
      month: row.month,
      revenue: Number(row.revenue ?? 0),
      invoices: Number(row.invoices ?? 0),
    })),
    business_by_month: businessByMonth,
    gst_by_month: byMonthAsc(gst as any[]).map((row: any) => ({
      month: row.month,
      output_gst: Number(row.output_gst ?? 0),
      input_gst: Number(row.input_gst ?? 0),
      net_gst: Number(row.net_gst ?? 0),
    })),
    item_margin: (margin ?? []).map((row) => ({
      item_name: row.item_name,
      sales_qty: Number(row.sales_qty ?? 0),
      purchase_qty: Number(row.purchase_qty ?? 0),
      sales_amount: Number(row.sales_amount ?? 0),
      purchase_amount: Number(row.purchase_amount ?? 0),
      gross_profit: Number(row.gross_profit ?? 0),
    })),
    top_skus: (skus ?? []).map((row) => ({
      sku: row.sku,
      total_revenue: Number(row.total_revenue ?? 0),
      total_qty: Number(row.total_qty ?? 0),
      material_type: row.material_type ?? 'OTHER',
    })),
    material_split: materialSplit,
    growth_rate: growthRate,
  };
}