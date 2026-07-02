import { supabase } from '@/lib/supabase';
import type { AnalyticsSummary, FinancialYear } from '@/types';

// Helper to aggregate raw sales rows into customer summaries
function aggregateCustomersFromSales(rows: any[]): AnalyticsSummary['top_customers'] {
  const map = new Map<string, { total_revenue: number; invoice_count: number }>();
  for (const row of rows) {
    const name = row.customer_name ?? 'Unknown';
    const existing = map.get(name) ?? { total_revenue: 0, invoice_count: 0 };
    map.set(name, {
      total_revenue: existing.total_revenue + Number(row.total_amount ?? 0),
      invoice_count: existing.invoice_count + 1,
    });
  }
  return Array.from(map.entries())
    .map(([customer_name, data]) => ({ customer_name, ...data }))
    .sort((a, b) => b.total_revenue - a.total_revenue)
    .slice(0, 10);
}

// Helper to aggregate raw sales rows into SKU summaries
function aggregateSKUsFromSales(rows: any[]): AnalyticsSummary['top_skus'] {
  const map = new Map<string, { total_revenue: number; total_qty: number; material_type: 'SS' | 'MS' | 'SERVICE' | 'OTHER' }>();
  for (const row of rows) {
    const sku = row.product_sku ?? 'Unknown';
    const existing = map.get(sku) ?? { total_revenue: 0, total_qty: 0, material_type: (row.material_type as 'SS' | 'MS' | 'SERVICE' | 'OTHER') ?? 'OTHER' };
    map.set(sku, {
      total_revenue: existing.total_revenue + Number(row.total_amount ?? 0),
      total_qty: existing.total_qty + Number(row.quantity ?? 0),
      material_type: (row.material_type as 'SS' | 'MS' | 'SERVICE' | 'OTHER') ?? existing.material_type,
    });
  }
  return Array.from(map.entries())
    .map(([sku, data]) => ({ sku, ...data }))
    .sort((a, b) => b.total_revenue - a.total_revenue)
    .slice(0, 10);
}

// Helper to aggregate raw sales rows into material split
function aggregateMaterialSplitFromSales(rows: any[]): AnalyticsSummary['material_split'] {
  return rows.reduce((acc, row) => {
    const key = String(row.material_type ?? 'OTHER') as keyof AnalyticsSummary['material_split'];
    acc[key] = (acc[key] ?? 0) + Number(row.total_amount ?? 0);
    return acc;
  }, { SS: 0, MS: 0, SERVICE: 0, OTHER: 0 });
}

// Helper to aggregate raw purchase order rows into supplier summaries
function aggregateSuppliersFromSales(rows: any[]): AnalyticsSummary['top_suppliers'] {
  const map = new Map<string, { total_purchase: number; invoice_count: number }>();
  for (const row of rows) {
    const name = row.vendor_name ?? 'Unknown';
    const existing = map.get(name) ?? { total_purchase: 0, invoice_count: 0 };
    map.set(name, {
      total_purchase: existing.total_purchase + Number(row.total_amount ?? 0),
      invoice_count: existing.invoice_count + 1,
    });
  }
  return Array.from(map.entries())
    .map(([supplier_name, data]) => ({ supplier_name, ...data }))
    .sort((a, b) => b.total_purchase - a.total_purchase)
    .slice(0, 10);
}

// Helper to compute item margin from raw sales rows
function aggregateMarginFromSales(rows: any[]): AnalyticsSummary['item_margin'] {
  const map = new Map<string, {
    sales_qty: number;
    purchase_qty: number;
    sales_amount: number;
    purchase_amount: number;
    gross_profit: number;
  }>();
  for (const row of rows) {
    const sku = row.product_sku ?? 'Unknown';
    const existing = map.get(sku) ?? { sales_qty: 0, purchase_qty: 0, sales_amount: 0, purchase_amount: 0, gross_profit: 0 };
    const qty = Number(row.quantity ?? 0);
    const amount = Number(row.total_amount ?? 0);
    const unitPrice = Number(row.unit_price ?? 0);
    map.set(sku, {
      sales_qty: existing.sales_qty + qty,
      purchase_qty: existing.purchase_qty + qty,
      sales_amount: existing.sales_amount + amount,
      purchase_amount: existing.purchase_amount + (qty * unitPrice),
      gross_profit: existing.gross_profit + (amount - qty * unitPrice),
    });
  }
  return Array.from(map.entries())
    .map(([item_name, data]) => ({ item_name, ...data }))
    .sort((a, b) => b.gross_profit - a.gross_profit)
    .slice(0, 10);
}

export async function fetchAnalyticsSummarySupabase(
  months = 6,
  year?: string,
  month?: string,
  financialYear?: FinancialYear,
): Promise<AnalyticsSummary> {

  // Financial year filter takes precedence (Apr-Mar)
  const dateFilter: { gte: string; lte: string } | null = financialYear
    ? (() => {
        const start = new Date(financialYear.startYear, 3, 1); // Apr 1
        const end = new Date(financialYear.startYear + 1, 2, 31); // Mar 31 next year
        return { gte: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-01`, lte: `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-31` };
      })()
    : year
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

  // For summary/top tables, when filtering by date we query the base tables directly
  // Otherwise we use the convenience views which show all-time data
  const summaryQuery = supabase.from('analytics_summary').select('*').single();
  
  const customersQuery = dateFilter
    ? supabase.from('sales').select('customer_name, total_amount').gte('invoice_date', dateFilter.gte).lte('invoice_date', dateFilter.lte)
    : supabase.from('top_customers').select('*');
  
  const skusQuery = dateFilter
    ? supabase.from('sales').select('product_sku, total_amount, quantity, material_type').gte('invoice_date', dateFilter.gte).lte('invoice_date', dateFilter.lte)
    : supabase.from('top_skus').select('*');
  
  const materialsQuery = dateFilter
    ? supabase.from('sales').select('material_type, total_amount').gte('invoice_date', dateFilter.gte).lte('invoice_date', dateFilter.lte)
    : supabase.from('material_split').select('*');
  
  const suppliersQuery = dateFilter
    ? supabase.from('purchase_orders').select('vendor_name, total_amount').gte('po_date', dateFilter.gte).lte('po_date', dateFilter.lte)
    : supabase.from('top_suppliers').select('*');
  
  const marginQuery = dateFilter
    ? supabase.from('sales').select('product_sku, quantity, unit_price, total_amount').gte('invoice_date', dateFilter.gte).lte('invoice_date', dateFilter.lte).limit(1000)
    : supabase.from('item_margin').select('*').limit(1000);

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

  const byMonthAsc = <T extends { month: string }>(rows: T[] | null): T[] =>
    [...(rows ?? [])].sort((a, b) => a.month.localeCompare(b.month));

  const businessByMonth = byMonthAsc(business as any[]).map((row: any) => ({
    month: row.month,
    sales: Number(row.sales ?? 0),
    purchases: Number(row.purchases ?? 0),
    gross_profit: Number(row.gross_profit ?? 0),
    gross_margin_pct: Number(row.gross_margin_pct ?? 0),
    sales_invoices: Number(row.sales_invoices ?? 0),
    purchase_invoices: Number(row.purchase_invoices ?? 0),
  }));

  // When filtering by date, compute material split from filtered sales data
  // Otherwise use the material_split view
  const materialSplit: AnalyticsSummary['material_split'] = dateFilter
    ? aggregateMaterialSplitFromSales(materials ?? [])
    : (materials ?? []).reduce((acc: AnalyticsSummary['material_split'], row: any) => {
        const key = String(row.material_type ?? 'OTHER') as keyof AnalyticsSummary['material_split'];
        acc[key] = (acc[key] ?? 0) + Number(row.total_revenue ?? 0);
        return acc;
      }, { SS: 0, MS: 0, SERVICE: 0, OTHER: 0 });

  const firstMonth = businessByMonth.at(0);
  const lastMonth = businessByMonth.at(-1);
  const growthRate =
    firstMonth && lastMonth && firstMonth.sales > 0
      ? ((lastMonth.sales - firstMonth.sales) / firstMonth.sales) * 100
      : 0;

  // When filtering by year/month/financialYear, compute summary from filtered data
  // Otherwise use all-time summary view
  const useFilteredSummary = !!(year || month || financialYear || (months !== 6));
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
  if (financialYear) {
    periodLabel = financialYear.label;
  } else if (year && month) {
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
    // When filtering by date, aggregate from raw sales/purchase data
    // Otherwise use the convenience views
    top_customers: dateFilter
      ? aggregateCustomersFromSales(customers ?? [])
      : (customers ?? []).map((row: any) => ({
          customer_name: row.customer_name,
          total_revenue: Number(row.total_revenue ?? 0),
          invoice_count: Number(row.invoice_count ?? 0),
        })),
    top_suppliers: dateFilter
      ? aggregateSuppliersFromSales(suppliers ?? [])
      : (suppliers ?? []).map((row: any) => ({
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
    item_margin: dateFilter
      ? aggregateMarginFromSales(margin ?? [])
      : (margin ?? []).map((row: any) => ({
          item_name: row.item_name,
          sales_qty: Number(row.sales_qty ?? 0),
          purchase_qty: Number(row.purchase_qty ?? 0),
          sales_amount: Number(row.sales_amount ?? 0),
          purchase_amount: Number(row.purchase_amount ?? 0),
          gross_profit: Number(row.gross_profit ?? 0),
        })),
    top_skus: dateFilter
      ? aggregateSKUsFromSales(skus ?? [])
      : (skus ?? []).map((row: any) => ({
          sku: row.sku,
          total_revenue: Number(row.total_revenue ?? 0),
          total_qty: Number(row.total_qty ?? 0),
          material_type: row.material_type ?? 'OTHER',
        })),
    material_split: materialSplit,
    growth_rate: growthRate,
  };
}