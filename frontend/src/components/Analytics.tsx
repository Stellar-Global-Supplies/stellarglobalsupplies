import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import {
  RefreshCw,
  AlertCircle,
  TrendingUp,
  Package,
  Users,
  Filter,
} from 'lucide-react';
import { fetchAnalyticsSummarySupabase } from '@/services/analytics';
import type { AnalyticsSummary, FinancialYear } from '@/types';
import { format, parseISO } from 'date-fns';

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────
function fmt(n: number): string {
  if (n >= 1_000_000) return `₹${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `₹${(n / 1_000).toFixed(1)}K`;
  return `₹${n.toFixed(0)}`;
}

function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      className={`rounded-lg bg-slate-800 ${className}`}
      style={{
        backgroundImage: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.04) 50%, transparent 100%)',
        backgroundSize: '200% 100%',
        animation: 'shimmer 2s linear infinite',
      }}
      aria-hidden="true"
    />
  );
}

const CHART_TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: '#1e293b',
    border:          '1px solid #334155',
    borderRadius:    '8px',
    fontSize:        '12px',
    color:           '#e2e8f0',
  },
  labelStyle: { color: '#94a3b8' },
  cursor:     { fill: 'rgba(99,102,241,0.08)' },
};

// ────────────────────────────────────────────────────────────────────────────
// Section header
// ────────────────────────────────────────────────────────────────────────────
function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4">
      <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
      {subtitle && <p className="text-2xs text-slate-500 mt-0.5">{subtitle}</p>}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Revenue vs Invoices combo chart
// ────────────────────────────────────────────────────────────────────────────
function RevenueVsInvoices({ data }: { data: AnalyticsSummary['revenue_by_month'] }) {
  const chartData = data.map((d) => ({
    month:    format(parseISO(`${d.month}-01`), 'MMM yy'),
    revenue:  d.revenue,
    invoices: d.invoices,
  }));

  return (
    <div className="glass-card p-5">
      <SectionHeader
        title="Revenue & Invoice Volume"
        subtitle="Monthly trend with dual axis"
      />
      {chartData.length === 0 ? (
        <EmptyChart />
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={chartData} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="areaRev" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="areaInv" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#06b6d4" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis
              yAxisId="left"
              tickFormatter={(v: number) => fmt(v)}
              tick={{ fill: '#64748b', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={60}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fill: '#64748b', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={36}
            />
            <Tooltip
              {...CHART_TOOLTIP_STYLE}
              formatter={(v: number, name: string) => [
                name === 'revenue' ? fmt(v) : v.toLocaleString(),
                name === 'revenue' ? 'Revenue' : 'Invoices',
              ]}
            />
            <Legend
              wrapperStyle={{ fontSize: '12px', paddingTop: '12px' }}
              formatter={(value: string) => (
                <span style={{ color: '#94a3b8' }}>
                  {value === 'revenue' ? 'Revenue' : 'Invoice Count'}
                </span>
              )}
            />
            <Area yAxisId="left"  type="monotone" dataKey="revenue"  stroke="#6366f1" strokeWidth={2} fill="url(#areaRev)" />
            <Area yAxisId="right" type="monotone" dataKey="invoices" stroke="#06b6d4" strokeWidth={2} fill="url(#areaInv)" />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Top customers bar chart
// ────────────────────────────────────────────────────────────────────────────
function TopCustomersChart({ customers }: { customers: AnalyticsSummary['top_customers'] }) {
  const data = customers.slice(0, 8).map((c) => ({
    name:    c.customer_name.length > 18 ? c.customer_name.slice(0, 17) + '…' : c.customer_name,
    revenue: c.total_revenue,
    orders:  c.invoice_count,
  }));

  return (
    <div className="glass-card p-5">
      <SectionHeader
        title="Top Customers by Revenue"
        subtitle="Top 8 contributors"
      />
      {data.length === 0 ? (
        <EmptyChart />
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
            <XAxis
              type="number"
              tickFormatter={(v: number) => fmt(v)}
              tick={{ fill: '#64748b', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fill: '#94a3b8', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={110}
            />
            <Tooltip
              {...CHART_TOOLTIP_STYLE}
              formatter={(v: number, name: string) => [
                name === 'revenue' ? fmt(v) : v.toLocaleString(),
                name === 'revenue' ? 'Revenue' : 'Orders',
              ]}
            />
            <Bar dataKey="revenue" fill="#6366f1" radius={[0, 4, 4, 0]} maxBarSize={20} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// SKU performance chart
// ────────────────────────────────────────────────────────────────────────────
function SKUPerformanceChart({ skus }: { skus: AnalyticsSummary['top_skus'] }) {
  const data = (skus ?? []).slice(0, 8).map((s: any) => {
    const skuName = s.sku ?? s.item_name ?? s.product_name ?? 'Unknown SKU';

    return {
      sku:
        skuName.length > 20
          ? skuName.slice(0, 19) + '…'
          : skuName,
      revenue: s.total_revenue ?? 0,
      qty: s.total_qty ?? 0,
      material: s.material_type ?? 'SS',
    };
  });

  if (data.length === 0 || data.every(d => d.revenue === 0)) {
    return (
      <div className="glass-card p-5">
        <SectionHeader
          title="SKU Performance"
          subtitle="Revenue by product SKU"
        />
        <EmptyChart />
      </div>
    );
  }

  return (
    <div className="glass-card p-5">
      <SectionHeader
        title="SKU Performance"
        subtitle="Revenue by product SKU"
      />
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis
            dataKey="sku"
            tick={{ fill: '#64748b', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            interval={0}
            angle={-30}
            textAnchor="end"
            height={50}
          />
          <YAxis
            tickFormatter={(v: number) => fmt(v)}
            tick={{ fill: '#64748b', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={60}
          />
          <Tooltip
            {...CHART_TOOLTIP_STYLE}
            formatter={(v: number, name: string) => [
              name === 'revenue' ? fmt(v) : v.toLocaleString() + ' units',
              name === 'revenue' ? 'Revenue' : 'Quantity',
            ]}
          />
          <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }} />
          <Bar
            dataKey="revenue"
            radius={[4, 4, 0, 0]}
            maxBarSize={32}
          >
            {data.map((entry, i) => (
              <Cell
                key={i}
                fill={entry.material === 'SS' ? '#6366f1' : '#06b6d4'}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Material split detail
// ────────────────────────────────────────────────────────────────────────────
function MaterialSplitDetail({ split }: { split: AnalyticsSummary['material_split'] }) {
  const total = split.SS + split.MS + (split.SERVICE ?? 0) + (split.OTHER ?? 0);
  const data = [
    { name: 'SS', value: split.SS, color: '#10b981', label: 'Stainless Steel' },
    { name: 'MS', value: split.MS, color: '#f59e0b', label: 'Mild Steel'      },
    { name: 'SERVICE', value: split.SERVICE ?? 0, color: '#38bdf8', label: 'Service' },
    { name: 'OTHER', value: split.OTHER ?? 0, color: '#94a3b8', label: 'Other' },
  ].filter((entry) => entry.value > 0);

  if (total === 0) {
    return (
      <div className="glass-card p-5">
        <SectionHeader
          title="Material Type Breakdown"
          subtitle="Revenue distribution by material"
        />
        <EmptyChart />
      </div>
    );
  }

  return (
    <div className="glass-card p-5">
      <SectionHeader
        title="Material Type Breakdown"
        subtitle="Revenue distribution by material"
      />
      <div className="flex items-center gap-6">
        <div className="w-36 h-36 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={44}
                outerRadius={64}
                strokeWidth={2}
                stroke="#0f172a"
                dataKey="value"
                paddingAngle={3}
              >
                {data.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Pie>
              <Tooltip
                {...CHART_TOOLTIP_STYLE}
                formatter={(v: number) => [fmt(v), 'Revenue']}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="flex-1 space-y-4">
          {data.map((d) => (
            <div key={d.name}>
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: d.color }} />
                  <span className="text-xs font-medium text-slate-300">{d.label}</span>
                  <span className="text-2xs font-mono text-slate-500">({d.name})</span>
                </div>
                <div className="text-right">
                  <span className="text-xs font-bold text-slate-200">{fmt(d.value)}</span>
                  <span className="text-2xs text-slate-500 ml-1">
                    {total > 0 ? `(${((d.value / total) * 100).toFixed(1)}%)` : ''}
                  </span>
                </div>
              </div>
              <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width:           total > 0 ? `${(d.value / total) * 100}%` : '0%',
                    backgroundColor: d.color,
                  }}
                />
              </div>
            </div>
          ))}

          <div className="pt-2 border-t border-slate-800">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">Total Revenue</span>
              <span className="text-sm font-bold text-slate-200">{fmt(total)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Full customer table
// ────────────────────────────────────────────────────────────────────────────
function CustomerTable({ customers }: { customers: AnalyticsSummary['top_customers'] }) {
  const [sortBy, setSortBy] = useState<'revenue' | 'invoices'>('revenue');

  const sorted = [...customers].sort((a, b) =>
    sortBy === 'revenue'
      ? b.total_revenue - a.total_revenue
      : b.invoice_count - a.invoice_count,
  );

  const grandTotal = customers.reduce((s, c) => s + c.total_revenue, 0);

  return (
    <div className="glass-card p-5">
      <div className="flex items-center justify-between mb-4">
        <SectionHeader title="Customer Revenue Table" />
        <div className="flex items-center gap-2">
          <Filter size={12} className="text-slate-500" />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'revenue' | 'invoices')}
            className="text-2xs bg-slate-800 border border-slate-700 text-slate-300 rounded-lg px-2 py-1 outline-none"
          >
            <option value="revenue">Sort by Revenue</option>
            <option value="invoices">Sort by Invoices</option>
          </select>
        </div>
      </div>

      {customers.length === 0 ? (
        <p className="text-xs text-slate-500 py-6 text-center">No customer data available. Upload a sales CSV to populate this table.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-700">
                <th className="text-left text-2xs text-slate-500 uppercase tracking-wide pb-2 pr-4">#</th>
                <th className="text-left text-2xs text-slate-500 uppercase tracking-wide pb-2 pr-4">Customer</th>
                <th className="text-right text-2xs text-slate-500 uppercase tracking-wide pb-2 pr-4">Revenue</th>
                <th className="text-right text-2xs text-slate-500 uppercase tracking-wide pb-2 pr-4">Invoices</th>
                <th className="text-right text-2xs text-slate-500 uppercase tracking-wide pb-2 pr-4">Avg Order</th>
                <th className="text-right text-2xs text-slate-500 uppercase tracking-wide pb-2">Share</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {sorted.map((c, i) => {
                const share    = grandTotal > 0 ? (c.total_revenue / grandTotal) * 100 : 0;
                const avgOrder = c.invoice_count > 0 ? c.total_revenue / c.invoice_count : 0;
                return (
                  <tr key={c.customer_name} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-2.5 pr-4 text-slate-600 font-medium">{i + 1}</td>
                    <td className="py-2.5 pr-4">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-indigo-900/40 flex items-center justify-center shrink-0">
                          <span className="text-2xs font-bold text-indigo-400">
                            {c.customer_name.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <span className="text-slate-200 font-medium truncate max-w-[160px]">
                          {c.customer_name}
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 pr-4 text-right font-semibold text-emerald-400 tabular-nums">
                      {fmt(c.total_revenue)}
                    </td>
                    <td className="py-2.5 pr-4 text-right text-slate-300 tabular-nums">
                      {c.invoice_count.toLocaleString()}
                    </td>
                    <td className="py-2.5 pr-4 text-right text-slate-400 tabular-nums">
                      {fmt(avgOrder)}
                    </td>
                    <td className="py-2.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-indigo-500 rounded-full"
                            style={{ width: `${share}%` }}
                          />
                        </div>
                        <span className="text-slate-400 tabular-nums w-10 text-right">
                          {share.toFixed(1)}%
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-700">
                <td colSpan={2} className="pt-2.5 text-slate-400 font-medium text-xs">
                  Total ({customers.length} customers)
                </td>
                <td className="pt-2.5 text-right font-bold text-slate-200 text-xs tabular-nums">
                  {fmt(grandTotal)}
                </td>
                <td className="pt-2.5 text-right font-bold text-slate-200 text-xs tabular-nums">
                  {customers.reduce((s, c) => s + c.invoice_count, 0).toLocaleString()}
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Empty state for charts
// ────────────────────────────────────────────────────────────────────────────
function EmptyChart() {
  return (
    <div className="h-48 flex items-center justify-center text-slate-600 text-xs">
      No data available — upload a sales CSV to populate this chart.
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Summary stat row
// ────────────────────────────────────────────────────────────────────────────
function SummaryStats({ summary }: { summary: AnalyticsSummary }) {
  const stats = [
    { label: 'Total Revenue',      value: fmt(summary.total_revenue),              icon: <TrendingUp size={14} />,  color: '#6366f1' },
    { label: 'Total Invoices',     value: summary.total_invoices.toLocaleString(), icon: <Package size={14} />,     color: '#8b5cf6' },
    { label: 'Avg Invoice Value',  value: fmt(summary.avg_invoice_value),          icon: <TrendingUp size={14} />,  color: '#06b6d4' },
    { label: 'Active Customers',   value: summary.top_customers.length.toString(), icon: <Users size={14} />,       color: '#10b981' },
  ];

  return (
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-6">
      {stats.map((s) => (
        <div key={s.label} className="glass-card p-4 flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
            style={{ backgroundColor: `${s.color}20`, color: s.color }}
          >
            {s.icon}
          </div>
          <div>
            <p className="text-xs text-slate-500">{s.label}</p>
            <p className="text-lg font-bold text-slate-100 tabular-nums">{s.value}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Period selector
// ────────────────────────────────────────────────────────────────────────────
const PERIODS = [
  { label: '3M',  value: 3  },
  { label: '6M',  value: 6  },
  { label: '12M', value: 12 },
];

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
  { label: 'All Years', value: '' },
  { label: '2026', value: '2026' },
  { label: '2025', value: '2025' },
];

const FINANCIAL_YEAR_OPTIONS: FinancialYear[] = [
  { startYear: 2026, label: 'FY 2026-27' },
  { startYear: 2025, label: 'FY 2025-26' },
  { startYear: 2024, label: 'FY 2024-25' },
];

// ────────────────────────────────────────────────────────────────────────────
// Analytics main
// ────────────────────────────────────────────────────────────────────────────
export default function Analytics() {
  const [months, setMonths] = useState(6);
  const [selectedYear, setSelectedYear] = useState('');
  const [selectedMonth, setSelectedMonth] = useState('');
  const [selectedFY, setSelectedFY] = useState<FinancialYear | null>(null);

  // Reset month/year filter when FY is selected/cleared
  const handleFYChange = (fy: FinancialYear | null) => {
    setSelectedFY(fy);
    if (fy) {
      setSelectedYear('');
      setSelectedMonth('');
    }
  };

  const handleYearChange = (year: string) => {
    setSelectedYear(year);
    if (!year) setSelectedMonth('');
    if (selectedFY) setSelectedFY(null);
  };

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['analytics-summary', months, selectedYear, selectedMonth, selectedFY?.startYear],
    queryFn:  () => fetchAnalyticsSummarySupabase(months, selectedYear || undefined, selectedMonth || undefined, selectedFY || undefined),
    staleTime: 5 * 60 * 1000,
  });

  const summary: AnalyticsSummary = data ?? {
    period:            `Last ${months} months`,
    total_revenue:     0,
    total_purchase:    0,
    gross_profit:      0,
    gross_margin_pct:  0,
    total_invoices:    0,
    avg_invoice_value: 0,
    customer_count:    0,
    supplier_count:    0,
    top_customers:     [],
    top_suppliers:     [],
    top_skus:          [],
    revenue_by_month:  [],
    business_by_month: [],
    gst_by_month:      [],
    item_margin:       [],
    material_split:    { SS: 0, MS: 0 },
    growth_rate:       0,
  };

  return (
    <div className="max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-100">Sales Analytics</h2>
          <p className="text-sm text-slate-400 mt-0.5">{summary.period}</p>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
          {/* Financial Year filter */}
          <div className="flex items-center gap-1 bg-slate-800 border border-slate-700 rounded-lg p-1">
            <select
              value={selectedFY?.label ?? ''}
              onChange={(e) => {
                const fy = FINANCIAL_YEAR_OPTIONS.find(f => f.label === e.target.value) || null;
                handleFYChange(fy);
              }}
              className="text-2xs bg-transparent text-slate-300 outline-none px-1 py-0.5 cursor-pointer"
            >
              <option value="">All Years</option>
              {FINANCIAL_YEAR_OPTIONS.map((fy) => (
                <option key={fy.label} value={fy.label}>{fy.label}</option>
              ))}
            </select>
          </div>

          {/* Year / Month filters */}
          <div className="flex items-center gap-1 bg-slate-800 border border-slate-700 rounded-lg p-1">
            <select
              value={selectedYear}
              onChange={(e) => handleYearChange(e.target.value)}
              disabled={!!selectedFY}
              className="text-2xs bg-transparent text-slate-300 outline-none px-1 py-0.5 cursor-pointer disabled:opacity-40"
            >
              {YEAR_OPTIONS.map((y) => (
                <option key={y.value} value={y.value}>{y.label}</option>
              ))}
            </select>
            <span className="text-slate-600 text-2xs">/</span>
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              disabled={!selectedYear || !!selectedFY}
              className="text-2xs bg-transparent text-slate-300 outline-none px-1 py-0.5 cursor-pointer disabled:opacity-40"
            >
              {MONTH_NAMES.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>

          {/* Period selector */}
          <div className="flex items-center bg-slate-800 border border-slate-700 rounded-lg p-1 gap-1">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                onClick={() => setMonths(p.value)}
                className={`
                  px-3 py-1 rounded-md text-xs font-medium transition-all duration-150
                  ${months === p.value
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                  }
                `}
              >
                {p.label}
              </button>
            ))}
          </div>

          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-2 px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* Error state */}
      {isError && (
        <div className="glass-card p-6 flex items-center gap-4">
          <AlertCircle size={24} className="text-red-400 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-slate-200">Failed to load analytics</p>
            <p className="text-xs text-slate-500 mt-0.5">{(error as Error)?.message}</p>
          </div>
          <button
            onClick={() => refetch()}
            className="ml-auto px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading */}
      {isLoading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Skeleton className="h-72 rounded-xl" />
            <Skeleton className="h-72 rounded-xl" />
          </div>
        </div>
      ) : (
        <>
          {/* Summary stat row */}
          <SummaryStats summary={summary} />

          {/* Charts row 1 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <RevenueVsInvoices data={summary.revenue_by_month} />
            <MaterialSplitDetail split={summary.material_split} />
          </div>

          {/* Charts row 2 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <TopCustomersChart customers={summary.top_customers} />
            <SKUPerformanceChart skus={summary.top_skus} />
          </div>

          {/* Full customer table */}
          <CustomerTable customers={summary.top_customers} />
        </>
      )}
    </div>
  );
}
