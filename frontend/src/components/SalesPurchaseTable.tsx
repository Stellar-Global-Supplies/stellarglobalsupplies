import { useQuery } from '@tanstack/react-query';
import {
  RefreshCw,
  AlertCircle,
  Search,
  FileText,
  ShoppingCart,
  TrendingUp,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useState } from 'react';

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────
type RowType = 'sales' | 'purchase';

interface SalesRow {
  id: string;
  type: RowType;
  date: string;
  invoice_id: string;
  party_name: string;
  item_name: string;
  quantity: number;
  unit: string;
  unit_price: number;
  total_amount: number;
  material_type: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────
function fmt(n: number): string {
  if (n >= 1_000_000) return `₹${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `₹${(n / 1_000).toFixed(1)}K`;
  return `₹${n.toFixed(0)}`;
}

function fmtQty(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(2)}K`;
  return n.toFixed(2);
}

// ────────────────────────────────────────────────────────────────────────────
// Skeleton
// ────────────────────────────────────────────────────────────────────────────
function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      className={`rounded-lg bg-slate-800 relative overflow-hidden ${className}`}
      style={{
        backgroundImage:
          'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.04) 50%, transparent 100%)',
        backgroundSize: '200% 100%',
        animation: 'shimmer 2s linear infinite',
      }}
      aria-hidden="true"
    />
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Fetch sales/purchase data with filters
// ────────────────────────────────────────────────────────────────────────────
async function fetchSalesPurchaseData(
  year?: string,
  month?: string,
  type?: RowType,
): Promise<SalesRow[]> {
  const dateFilter: { gte: string; lte: string } | null = year
    ? month
      ? (() => {
          const lastDay = new Date(Number(year), Number(month), 0).getDate();
          return { gte: `${year}-${month}-01`, lte: `${year}-${month}-${String(lastDay).padStart(2, '0')}` };
        })()
      : { gte: `${year}-01-01`, lte: `${year}-12-31` }
    : null;

  const result: SalesRow[] = [];

  // Fetch sales if needed
  if (!type || type === 'sales') {
    let query = supabase
      .from('sales_items')
      .select('invoice_no, invoice_date, customer_name, item_name, quantity, unit, base_amount, gst_amount, total_amount, material_type');

    if (dateFilter) {
      query = query.gte('invoice_date', dateFilter.gte).lte('invoice_date', dateFilter.lte);
    }

    const { data, error } = await query.order('invoice_date', { ascending: false });

    if (error) throw new Error(error.message);

    for (const row of data ?? []) {
      result.push({
        id: `sales-${row.invoice_no}-${row.item_name}`,
        type: 'sales',
        date: row.invoice_date,
        invoice_id: row.invoice_no,
        party_name: row.customer_name,
        item_name: row.item_name,
        quantity: Number(row.quantity ?? 0),
        unit: row.unit ?? 'units',
        unit_price: Number(row.base_amount ?? 0),
        total_amount: Number(row.total_amount ?? 0),
        material_type: row.material_type ?? 'OTHER',
      });
    }
  }

  // Fetch purchases if needed
  if (!type || type === 'purchase') {
    let query = supabase
      .from('purchase_items')
      .select('invoice_no, invoice_date, supplier_name, item_name, quantity, unit, base_amount, gst_amount, total_amount, material_type');

    if (dateFilter) {
      query = query.gte('invoice_date', dateFilter.gte).lte('invoice_date', dateFilter.lte);
    }

    const { data, error } = await query.order('invoice_date', { ascending: false });

    if (error) throw new Error(error.message);

    for (const row of data ?? []) {
      result.push({
        id: `purchase-${row.invoice_no}-${row.item_name}`,
        type: 'purchase',
        date: row.invoice_date,
        invoice_id: row.invoice_no,
        party_name: row.supplier_name,
        item_name: row.item_name,
        quantity: Number(row.quantity ?? 0),
        unit: row.unit ?? 'units',
        unit_price: Number(row.base_amount ?? 0),
        total_amount: Number(row.total_amount ?? 0),
        material_type: row.material_type ?? 'OTHER',
      });
    }
  }

  // Sort by date descending
  result.sort((a, b) => b.date.localeCompare(a.date));
  return result;
}

// ────────────────────────────────────────────────────────────────────────────
// Filter options
// ────────────────────────────────────────────────────────────────────────────
const MONTH_NAMES = [
  { label: 'All Months', value: '' },
  { label: 'Jan', value: '01' },
  { label: 'Feb', value: '02' },
  { label: 'Mar', value: '03' },
  { label: 'Apr', value: '04' },
  { label: 'May', value: '05' },
  { label: 'Jun', value: '06' },
  { label: 'Jul', value: '07' },
  { label: 'Aug', value: '08' },
  { label: 'Sep', value: '09' },
  { label: 'Oct', value: '10' },
  { label: 'Nov', value: '11' },
  { label: 'Dec', value: '12' },
];

const YEAR_OPTIONS = [
  { label: 'All Time', value: '' },
  { label: '2026', value: '2026' },
  { label: '2025', value: '2025' },
];

const TYPE_OPTIONS = [
  { label: 'All', value: '' },
  { label: 'Sales Only', value: 'sales' },
  { label: 'Purchase Only', value: 'purchase' },
];

// ────────────────────────────────────────────────────────────────────────────
// Sales & Purchase Table Page
// ────────────────────────────────────────────────────────────────────────────
export default function SalesPurchaseTable() {
  const [selectedYear, setSelectedYear] = useState('');
  const [selectedMonth, setSelectedMonth] = useState('');
  const [selectedType, setSelectedType] = useState<RowType | ''>('');
  const [search, setSearch] = useState('');

  const handleYearChange = (year: string) => {
    setSelectedYear(year);
    if (!year) setSelectedMonth('');
  };

  const { data: rows = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['sales-purchase-table', selectedYear, selectedMonth, selectedType],
    queryFn: () => fetchSalesPurchaseData(selectedYear || undefined, selectedMonth || undefined, selectedType || undefined),
    staleTime: 5 * 60 * 1000,
  });

  // Filter by search
  const filtered = search.trim()
    ? rows.filter((r) =>
        r.item_name.toLowerCase().includes(search.toLowerCase()) ||
        r.invoice_id.toLowerCase().includes(search.toLowerCase()) ||
        r.party_name.toLowerCase().includes(search.toLowerCase()),
      )
    : rows;

  // Compute totals
  const totalSales = rows.filter((r) => r.type === 'sales').reduce((s, r) => s + r.total_amount, 0);
  const totalPurchases = rows.filter((r) => r.type === 'purchase').reduce((s, r) => s + r.total_amount, 0);
  const totalQtySold = rows.filter((r) => r.type === 'sales').reduce((s, r) => s + r.quantity, 0);
  const totalQtyPurchased = rows.filter((r) => r.type === 'purchase').reduce((s, r) => s + r.quantity, 0);

  // Period label
  const periodLabel = selectedYear
    ? selectedMonth
      ? `${MONTH_NAMES.find(m => m.value === selectedMonth)?.label} ${selectedYear}`
      : `FY ${selectedYear}`
    : 'All Time';

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-7xl">
        <div>
          <Skeleton className="h-7 w-48 mb-1" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="glass-card p-5 space-y-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-8 w-20" />
            </div>
          ))}
        </div>
        <div className="glass-card p-5 space-y-3">
          <Skeleton className="h-6 w-40" />
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="max-w-lg">
        <div className="glass-card p-8 flex flex-col items-center gap-4 text-center">
          <AlertCircle size={32} className="text-red-400" />
          <div>
            <p className="text-sm font-semibold text-slate-200">Failed to load data</p>
            <p className="text-xs text-slate-500 mt-1">{(error as Error)?.message}</p>
          </div>
          <button
            onClick={() => refetch()}
            className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-medium rounded-lg transition-colors"
          >
            <RefreshCw size={12} /> Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-100">Sales & Purchase Register</h2>
          <p className="text-sm text-slate-400 mt-0.5">
            {periodLabel} · {filtered.length} records
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Type filter */}
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value as RowType | '')}
            className="text-2xs bg-slate-800 border border-slate-700 text-slate-300 rounded-lg px-2 py-1.5 outline-none cursor-pointer"
          >
            {TYPE_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>

          {/* Year / Month filters */}
          <div className="flex items-center gap-1 bg-slate-800 border border-slate-700 rounded-lg p-1">
            <select
              value={selectedYear}
              onChange={(e) => handleYearChange(e.target.value)}
              className="text-2xs bg-transparent text-slate-300 outline-none px-1 py-0.5 cursor-pointer"
            >
              {YEAR_OPTIONS.map((y) => (
                <option key={y.value} value={y.value}>{y.label}</option>
              ))}
            </select>
            <span className="text-slate-600 text-2xs">/</span>
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              disabled={!selectedYear}
              className="text-2xs bg-transparent text-slate-300 outline-none px-1 py-0.5 cursor-pointer disabled:opacity-40"
            >
              {MONTH_NAMES.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>

          <button
            onClick={() => refetch()}
            className="flex items-center gap-2 px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 transition-colors"
          >
            <RefreshCw size={12} />
            Refresh
          </button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="kpi-card">
          <div className="flex items-start justify-between mb-3">
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">Total Sales</p>
            <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: '#10b98120', color: '#10b981' }}>
              <FileText size={18} />
            </div>
          </div>
          <p className="text-2xl font-bold text-slate-100 tabular-nums">{fmt(totalSales)}</p>
          <p className="text-2xs text-slate-500 mt-2">{fmtQty(totalQtySold)} units sold</p>
        </div>

        <div className="kpi-card">
          <div className="flex items-start justify-between mb-3">
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">Total Purchases</p>
            <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: '#6366f120', color: '#6366f1' }}>
              <ShoppingCart size={18} />
            </div>
          </div>
          <p className="text-2xl font-bold text-slate-100 tabular-nums">{fmt(totalPurchases)}</p>
          <p className="text-2xs text-slate-500 mt-2">{fmtQty(totalQtyPurchased)} units purchased</p>
        </div>

        <div className="kpi-card">
          <div className="flex items-start justify-between mb-3">
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">Net Position</p>
            <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: totalSales >= totalPurchases ? '#10b98120' : '#ef444420', color: totalSales >= totalPurchases ? '#10b981' : '#ef4444' }}>
              <TrendingUp size={18} />
            </div>
          </div>
          <p className="text-2xl font-bold text-slate-100 tabular-nums">{fmt(Math.abs(totalSales - totalPurchases))}</p>
          <p className="text-2xs text-slate-500 mt-2">{totalSales >= totalPurchases ? 'Sales lead' : 'Purchases lead'}</p>
        </div>

        <div className="kpi-card">
          <div className="flex items-start justify-between mb-3">
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">Total Records</p>
            <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: '#f59e0b20', color: '#f59e0b' }}>
              <FileText size={18} />
            </div>
          </div>
          <p className="text-2xl font-bold text-slate-100 tabular-nums">{filtered.length}</p>
          <p className="text-2xs text-slate-500 mt-2">Line items</p>
        </div>
      </div>

      {/* Search bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 bg-slate-800/60 rounded-xl border border-slate-700">
        <Search size={16} className="text-slate-500 shrink-0" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by item name, invoice ID, or party name..."
          className="flex-1 bg-transparent text-sm text-slate-200 placeholder-slate-500 outline-none"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="text-2xs text-slate-500 hover:text-slate-300 transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* Data table */}
      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="text-left text-2xs font-medium text-slate-500 uppercase tracking-wider px-4 py-3">Type</th>
                <th className="text-left text-2xs font-medium text-slate-500 uppercase tracking-wider px-4 py-3">Date</th>
                <th className="text-left text-2xs font-medium text-slate-500 uppercase tracking-wider px-4 py-3">Invoice / PO</th>
                <th className="text-left text-2xs font-medium text-slate-500 uppercase tracking-wider px-4 py-3">Party</th>
                <th className="text-left text-2xs font-medium text-slate-500 uppercase tracking-wider px-4 py-3">Item</th>
                <th className="text-right text-2xs font-medium text-slate-500 uppercase tracking-wider px-4 py-3">Qty</th>
                <th className="text-right text-2xs font-medium text-slate-500 uppercase tracking-wider px-4 py-3">Unit Price</th>
                <th className="text-right text-2xs font-medium text-slate-500 uppercase tracking-wider px-4 py-3">Total</th>
                <th className="text-center text-2xs font-medium text-slate-500 uppercase tracking-wider px-4 py-3">Material</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-sm text-slate-500">
                    {search ? 'No records match your search.' : 'No data available — upload sales and purchase CSVs to populate.'}
                  </td>
                </tr>
              )}
              {filtered.map((row) => (
                <tr key={row.id} className="hover:bg-slate-800/40 transition-colors">
                  <td className="px-4 py-3">
                    <span
                      className="text-2xs px-2 py-1 rounded font-medium"
                      style={{
                        backgroundColor: row.type === 'sales' ? '#10b98120' : '#6366f120',
                        color: row.type === 'sales' ? '#10b981' : '#818cf8',
                      }}
                    >
                      {row.type === 'sales' ? 'SALE' : 'PURCHASE'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-300">
                    {new Date(row.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-300 font-mono">{row.invoice_id}</td>
                  <td className="px-4 py-3">
                    <p className="text-xs font-medium text-slate-200 truncate max-w-[180px]">{row.party_name}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-xs text-slate-300 truncate max-w-[200px]">{row.item_name}</p>
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-slate-300 tabular-nums">{fmtQty(row.quantity)}</td>
                  <td className="px-4 py-3 text-right text-xs text-slate-400 tabular-nums">{fmt(row.unit_price)}</td>
                  <td className="px-4 py-3 text-right text-xs font-semibold tabular-nums" style={{ color: row.type === 'sales' ? '#10b981' : '#6366f1' }}>
                    {fmt(row.total_amount)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className="text-2xs px-1.5 py-0.5 rounded font-medium"
                      style={{
                        backgroundColor: row.material_type === 'SS' ? '#6366f120' : '#06b6d420',
                        color: row.material_type === 'SS' ? '#818cf8' : '#22d3ee',
                      }}
                    >
                      {row.material_type}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Summary footer */}
      <div className="text-2xs text-slate-600 text-center">
        Showing {filtered.length} of {rows.length} records for {periodLabel}.
        {selectedYear ? ' Select a different period to view more data.' : ' Select a year above to filter by period.'}
      </div>
    </div>
  );
}