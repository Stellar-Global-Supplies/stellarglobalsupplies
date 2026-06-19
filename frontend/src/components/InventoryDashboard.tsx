import { useQuery } from '@tanstack/react-query';
import {
  Package,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  RefreshCw,
  AlertCircle,
  Search,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { InventoryItem } from '@/types';
import { useState } from 'react';

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────
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
// Fetch inventory from Supabase with optional year/month filter
// ────────────────────────────────────────────────────────────────────────────
async function fetchInventory(year?: string, month?: string): Promise<InventoryItem[]> {
  // Build date range for filtering
  const dateFilter: { gte: string; lte: string } | null = year
    ? month
      ? { gte: `${year}-${month}-01`, lte: `${year}-${month}-31` }
      : { gte: `${year}-01-01`, lte: `${year}-12-31` }
    : null;

  if (dateFilter) {
    // Query base tables with date filters for period-specific inventory
    const [purchaseResult, salesResult] = await Promise.all([
      supabase
        .from('purchase_items')
        .select('item_name, quantity, unit, material_type')
        .gte('invoice_date', dateFilter.gte)
        .lte('invoice_date', dateFilter.lte),
      supabase
        .from('sales_items')
        .select('item_name, quantity, unit, material_type')
        .gte('invoice_date', dateFilter.gte)
        .lte('invoice_date', dateFilter.lte),
    ]);

    if (purchaseResult.error) throw new Error(purchaseResult.error.message);
    if (salesResult.error) throw new Error(salesResult.error.message);

    // Aggregate purchases
    const purchaseMap = new Map<string, { qty: number; unit: string; material: string }>();
    for (const row of purchaseResult.data ?? []) {
      const existing = purchaseMap.get(row.item_name) ?? { qty: 0, unit: row.unit ?? 'units', material: row.material_type ?? 'OTHER' };
      existing.qty += Number(row.quantity ?? 0);
      purchaseMap.set(row.item_name, existing);
    }

    // Aggregate sales
    const salesMap = new Map<string, { qty: number; unit: string; material: string }>();
    for (const row of salesResult.data ?? []) {
      const existing = salesMap.get(row.item_name) ?? { qty: 0, unit: row.unit ?? 'units', material: row.material_type ?? 'OTHER' };
      existing.qty += Number(row.quantity ?? 0);
      salesMap.set(row.item_name, existing);
    }

    // Merge all item names
    const allItems = new Set([...purchaseMap.keys(), ...salesMap.keys()]);
    const result: InventoryItem[] = [];

    for (const itemName of allItems) {
      const p = purchaseMap.get(itemName);
      const s = salesMap.get(itemName);
      const purchasedQty = p?.qty ?? 0;
      const soldQty = s?.qty ?? 0;
      const unit = p?.unit ?? s?.unit ?? 'units';
      const material = p?.material ?? s?.material ?? 'OTHER';

      result.push({
        item_name: itemName,
        purchased_qty: purchasedQty,
        sold_qty: soldQty,
        current_stock: purchasedQty - soldQty,
        unit,
        material_type: material as InventoryItem['material_type'],
      });
    }

    result.sort((a, b) => b.current_stock - a.current_stock);
    return result;
  }

  // No date filter - use the pre-built view (all-time data)
  const { data, error } = await supabase
    .from('inventory_summary')
    .select('*')
    .order('current_stock', { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    item_name:     row.item_name,
    purchased_qty: Number(row.purchased_qty ?? 0),
    sold_qty:      Number(row.sold_qty ?? 0),
    current_stock: Number(row.current_stock ?? 0),
    unit:          row.unit ?? 'units',
    material_type: row.material_type ?? 'OTHER',
  }));
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

// ────────────────────────────────────────────────────────────────────────────
// Inventory Dashboard
// ────────────────────────────────────────────────────────────────────────────
export default function InventoryDashboard() {
  const [search, setSearch] = useState('');
  const [selectedYear, setSelectedYear] = useState('');
  const [selectedMonth, setSelectedMonth] = useState('');

  const handleYearChange = (year: string) => {
    setSelectedYear(year);
    if (!year) setSelectedMonth('');
  };

  const { data: items = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['inventory', selectedYear, selectedMonth],
    queryFn:  () => fetchInventory(selectedYear || undefined, selectedMonth || undefined),
    staleTime: 5 * 60 * 1000,
  });

  // Compute summary stats
  const totalItems = items.length;
  const totalStock = items.reduce((sum, i) => sum + Math.max(0, i.current_stock), 0);
  const lowStockItems = items.filter((i) => i.current_stock > 0 && i.current_stock < 10);
  const outOfStockItems = items.filter((i) => i.current_stock <= 0);
  const inStockItems = items.filter((i) => i.current_stock > 0);

  // Filter by search
  const filtered = search.trim()
    ? items.filter((i) =>
        i.item_name.toLowerCase().includes(search.toLowerCase()),
      )
    : items;

  // Build period label
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
          {Array.from({ length: 5 }).map((_, i) => (
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
            <p className="text-sm font-semibold text-slate-200">Failed to load inventory</p>
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
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-100">Inventory</h2>
          <p className="text-sm text-slate-400 mt-0.5">
            {periodLabel} · {totalItems} items tracked · {fmtQty(totalStock)} total units
          </p>
        </div>

        <div className="flex items-center gap-2">
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
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">In Stock</p>
            <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: '#10b98120', color: '#10b981' }}>
              <Package size={18} />
            </div>
          </div>
          <p className="text-2xl font-bold text-slate-100 tabular-nums">{inStockItems.length}</p>
          <p className="text-2xs text-slate-500 mt-2">Items with positive stock</p>
        </div>

        <div className="kpi-card">
          <div className="flex items-start justify-between mb-3">
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">Low Stock</p>
            <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: '#f59e0b20', color: '#f59e0b' }}>
              <TrendingDown size={18} />
            </div>
          </div>
          <p className="text-2xl font-bold text-slate-100 tabular-nums">{lowStockItems.length}</p>
          <p className="text-2xs text-slate-500 mt-2">{'Items with < 10 units'}</p>
        </div>

        <div className="kpi-card">
          <div className="flex items-start justify-between mb-3">
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">Out of Stock</p>
            <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: '#ef444420', color: '#ef4444' }}>
              <AlertTriangle size={18} />
            </div>
          </div>
          <p className="text-2xl font-bold text-slate-100 tabular-nums">{outOfStockItems.length}</p>
          <p className="text-2xs text-slate-500 mt-2">Items with zero or negative stock</p>
        </div>

        <div className="kpi-card">
          <div className="flex items-start justify-between mb-3">
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">Total Units</p>
            <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: '#6366f120', color: '#6366f1' }}>
              <TrendingUp size={18} />
            </div>
          </div>
          <p className="text-2xl font-bold text-slate-100 tabular-nums">{fmtQty(totalStock)}</p>
          <p className="text-2xs text-slate-500 mt-2">Across all items</p>
        </div>
      </div>

      {/* Search bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 bg-slate-800/60 rounded-xl border border-slate-700">
        <Search size={16} className="text-slate-500 shrink-0" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search inventory items..."
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

      {/* Inventory table */}
      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="text-left text-2xs font-medium text-slate-500 uppercase tracking-wider px-4 py-3">Item</th>
                <th className="text-right text-2xs font-medium text-slate-500 uppercase tracking-wider px-4 py-3">Material</th>
                <th className="text-right text-2xs font-medium text-slate-500 uppercase tracking-wider px-4 py-3">Purchased</th>
                <th className="text-right text-2xs font-medium text-slate-500 uppercase tracking-wider px-4 py-3">Sold</th>
                <th className="text-right text-2xs font-medium text-slate-500 uppercase tracking-wider px-4 py-3">Unit</th>
                <th className="text-right text-2xs font-medium text-slate-500 uppercase tracking-wider px-4 py-3">Current Stock</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">
                    {search ? 'No items match your search.' : 'No inventory data available yet — upload purchase and sales CSVs to populate.'}
                  </td>
                </tr>
              )}
              {filtered.map((item) => {
                const stockStatus = item.current_stock <= 0
                  ? 'out'
                  : item.current_stock < 10
                    ? 'low'
                    : 'ok';

                const statusColor = stockStatus === 'out'
                  ? 'text-red-400'
                  : stockStatus === 'low'
                    ? 'text-amber-400'
                    : 'text-emerald-400';

                const statusBg = stockStatus === 'out'
                  ? 'bg-red-950/30'
                  : stockStatus === 'low'
                    ? 'bg-amber-950/30'
                    : 'bg-emerald-950/30';

                const statusBorder = stockStatus === 'out'
                  ? 'border-red-800/40'
                  : stockStatus === 'low'
                    ? 'border-amber-800/40'
                    : 'border-emerald-800/40';

                return (
                  <tr key={item.item_name} className="hover:bg-slate-800/40 transition-colors">
                    <td className="px-4 py-3">
                      <p className="text-xs font-medium text-slate-200 truncate max-w-xs">{item.item_name}</p>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span
                        className="text-2xs px-1.5 py-0.5 rounded font-medium"
                        style={{
                          backgroundColor: item.material_type === 'SS' ? '#6366f120' : '#06b6d420',
                          color:           item.material_type === 'SS' ? '#818cf8' : '#22d3ee',
                        }}
                      >
                        {item.material_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-slate-300 tabular-nums">
                      {fmtQty(item.purchased_qty)}
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-slate-300 tabular-nums">
                      {fmtQty(item.sold_qty)}
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-slate-500">
                      {item.unit}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span
                        className={`inline-flex items-center gap-1.5 text-xs font-semibold tabular-nums px-2.5 py-1 rounded-full border ${statusColor} ${statusBg} ${statusBorder}`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${statusColor.replace('text-', 'bg-')}`} />
                        {fmtQty(item.current_stock)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Summary footer */}
      <div className="text-2xs text-slate-600 text-center">
        Inventory calculated as <strong className="text-slate-500">purchased quantity - sold quantity</strong> from ingested data.
        {selectedYear ? ` Showing data for ${periodLabel}.` : ' Select a year above to view period-specific inventory.'}
      </div>
    </div>
  );
}