import { useQuery } from '@tanstack/react-query';
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  FileText,
  Package,
  Users,
  Activity,
  Layers,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { fetchAnalyticsSummarySupabase } from '@/services/analytics';
import type { AnalyticsSummary } from '@/types';
import { format, parseISO } from 'date-fns';
import { useNavStore } from '@/store';

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────
function fmt(n: number): string {
  if (n >= 1_000_000) return `₹${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `₹${(n / 1_000).toFixed(1)}K`;
  return `₹${n.toFixed(0)}`;
}

function fmtPct(n: number): string {
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}%`;
}

// ────────────────────────────────────────────────────────────────────────────
// Skeleton loader
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

function KPISkeleton() {
  return (
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="glass-card p-5 space-y-3">
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-8 rounded-lg" />
          </div>
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-3 w-20" />
        </div>
      ))}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// KPI Card
// ────────────────────────────────────────────────────────────────────────────
interface KPICardProps {
  title:   string;
  value:   string;
  change:  number;
  icon:    React.ReactNode;
  color:   string;
}

function KPICard({ title, value, change, icon, color }: KPICardProps) {
  const positive = change >= 0;
  return (
    <div className="kpi-card group">
      <div className="flex items-start justify-between mb-3">
        <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">{title}</p>
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
          style={{ backgroundColor: `${color}20`, color }}
        >
          {icon}
        </div>
      </div>
      <p className="text-2xl font-bold text-slate-100 tabular-nums">{value}</p>
      <div className="flex items-center gap-1 mt-2">
        {positive ? (
          <TrendingUp size={13} className="text-emerald-400" />
        ) : (
          <TrendingDown size={13} className="text-red-400" />
        )}
        <span className={`text-xs font-medium ${positive ? 'text-emerald-400' : 'text-red-400'}`}>
          {fmtPct(change)}
        </span>
        <span className="text-2xs text-slate-500">vs last period</span>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Revenue trend chart
// ────────────────────────────────────────────────────────────────────────────
function RevenueChart({ data }: { data: AnalyticsSummary['revenue_by_month'] }) {
  const chartData = data.map((d) => ({
    month:    format(parseISO(`${d.month}-01`), 'MMM yy'),
    revenue:  d.revenue,
    invoices: d.invoices,
  }));

  return (
    <div className="glass-card p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">Revenue Trend</h3>
          <p className="text-2xs text-slate-500 mt-0.5">Last 6 months</p>
        </div>
        <Activity size={16} className="text-slate-500" />
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis
            dataKey="month"
            tick={{ fill: '#64748b', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tickFormatter={(v: number) => fmt(v)}
            tick={{ fill: '#64748b', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={56}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#1e293b',
              border: '1px solid #334155',
              borderRadius: '8px',
              fontSize: '12px',
            }}
            labelStyle={{ color: '#94a3b8' }}
            formatter={(v: number) => [fmt(v), 'Revenue']}
          />
          <Area
            type="monotone"
            dataKey="revenue"
            stroke="#6366f1"
            strokeWidth={2}
            fill="url(#revGrad)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Material split donut
// ────────────────────────────────────────────────────────────────────────────
function MaterialDonut({ split }: { split: AnalyticsSummary['material_split'] }) {
  const total = split.SS + split.MS;
  const data = [
    { name: 'Stainless Steel (SS)', value: split.SS, color: '#6366f1' },
    { name: 'Mild Steel (MS)',      value: split.MS, color: '#06b6d4' },
  ];

  return (
    <div className="glass-card p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">Material Split</h3>
          <p className="text-2xs text-slate-500 mt-0.5">By revenue share</p>
        </div>
        <Layers size={16} className="text-slate-500" />
      </div>

      <div className="flex items-center gap-6">
        <div className="relative w-28 h-28 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={36}
                outerRadius={52}
                strokeWidth={0}
                dataKey="value"
              >
                {data.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-2xs text-slate-400 text-center leading-tight">Revenue<br/>split</span>
          </div>
        </div>

        <div className="space-y-3 flex-1">
          {data.map((d) => (
            <div key={d.name}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                  <span className="text-xs text-slate-300">{d.name}</span>
                </div>
                <span className="text-xs font-semibold text-slate-200">
                  {total > 0 ? ((d.value / total) * 100).toFixed(1) : 0}%
                </span>
              </div>
              <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width:           `${total > 0 ? (d.value / total) * 100 : 0}%`,
                    backgroundColor: d.color,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Top Customers table
// ────────────────────────────────────────────────────────────────────────────
function TopCustomers({ customers }: { customers: AnalyticsSummary['top_customers'] }) {
  return (
    <div className="glass-card p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">Top Customers</h3>
          <p className="text-2xs text-slate-500 mt-0.5">By revenue contribution</p>
        </div>
        <Users size={16} className="text-slate-500" />
      </div>

      <div className="space-y-2">
        {customers.length === 0 && (
          <p className="text-xs text-slate-500 py-4 text-center">No customer data yet — upload a sales CSV to get started.</p>
        )}
        {customers.slice(0, 5).map((c, i) => (
          <div key={c.customer_name} className="flex items-center gap-3 py-2 border-b border-slate-800 last:border-0">
            <span className="text-2xs font-bold text-slate-500 w-5 text-right shrink-0">
              #{i + 1}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-slate-200 truncate">{c.customer_name}</p>
              <p className="text-2xs text-slate-500">{c.invoice_count} invoice{c.invoice_count !== 1 ? 's' : ''}</p>
            </div>
            <span className="text-xs font-semibold text-emerald-400 tabular-nums shrink-0">
              {fmt(c.total_revenue)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Top SKUs table
// ────────────────────────────────────────────────────────────────────────────
function TopSKUs({ skus }: { skus: AnalyticsSummary['top_skus'] }) {
  return (
    <div className="glass-card p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">Top SKUs</h3>
          <p className="text-2xs text-slate-500 mt-0.5">By revenue</p>
        </div>
        <Package size={16} className="text-slate-500" />
      </div>

      <div className="space-y-2">
        {skus.length === 0 && (
          <p className="text-xs text-slate-500 py-4 text-center">No SKU data available yet.</p>
        )}
        {skus.slice(0, 5).map((s, i) => (
          <div key={s.sku} className="flex items-center gap-3 py-2 border-b border-slate-800 last:border-0">
            <span className="text-2xs font-bold text-slate-500 w-5 text-right shrink-0">
              #{i + 1}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-slate-200 truncate font-mono">{s.sku}</p>
              <div className="flex items-center gap-2">
                <span
                  className="text-2xs px-1.5 py-0.5 rounded font-medium"
                  style={{
                    backgroundColor: s.material_type === 'SS' ? '#6366f120' : '#06b6d420',
                    color:           s.material_type === 'SS' ? '#818cf8' : '#22d3ee',
                  }}
                >
                  {s.material_type}
                </span>
                <span className="text-2xs text-slate-500">{s.total_qty.toLocaleString()} units</span>
              </div>
            </div>
            <span className="text-xs font-semibold text-indigo-400 tabular-nums shrink-0">
              {fmt(s.total_revenue)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Quick action card
// ────────────────────────────────────────────────────────────────────────────
function QuickActions() {
  const setSection = useNavStore((s) => s.setSection);

  const actions = [
    {
      label: 'Talk to Sales Analyst',
      desc:  'Get revenue insights from AI',
      color: '#6366f1',
      onClick: () => setSection('agents'),
    },
    {
      label: 'Upload Sales Data',
      desc:  'Ingest CSV or JSON file',
      color: '#06b6d4',
      onClick: () => setSection('ingest'),
    },
    {
      label: 'View Full Analytics',
      desc:  'Drill into historical data',
      color: '#10b981',
      onClick: () => setSection('analytics'),
    },
  ];

  return (
    <div className="glass-card p-5">
      <h3 className="text-sm font-semibold text-slate-200 mb-3">Quick Actions</h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {actions.map((a) => (
          <button
            key={a.label}
            onClick={a.onClick}
            className="flex flex-col items-start gap-1 p-3 rounded-lg border border-slate-700 hover:border-slate-500 bg-slate-800/40 hover:bg-slate-800 transition-all duration-150 text-left group"
          >
            <span
              className="text-xs font-semibold group-hover:underline transition-colors"
              style={{ color: a.color }}
            >
              {a.label}
            </span>
            <span className="text-2xs text-slate-500">{a.desc}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Error state
// ────────────────────────────────────────────────────────────────────────────
function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="glass-card p-8 flex flex-col items-center justify-center gap-4 text-center">
      <AlertCircle size={32} className="text-red-400" />
      <div>
        <p className="text-sm font-semibold text-slate-200">Failed to load analytics</p>
        <p className="text-xs text-slate-500 mt-1">{message}</p>
      </div>
      <button
        onClick={onRetry}
        className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-medium rounded-lg transition-colors"
      >
        <RefreshCw size={12} />
        Retry
      </button>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Dashboard main
// ────────────────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['analytics-summary'],
    queryFn:  () => fetchAnalyticsSummarySupabase(6),
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-7xl">
        <div>
          <Skeleton className="h-7 w-48 mb-1" />
          <Skeleton className="h-4 w-64" />
        </div>
        <KPISkeleton />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2"><Skeleton className="h-72 rounded-xl" /></div>
          <Skeleton className="h-72 rounded-xl" />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="max-w-lg">
        <ErrorCard
          message={(error as Error)?.message ?? 'Unknown error'}
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  // Fallback empty state when no data ingested yet
  const summary: AnalyticsSummary = data ?? {
    period:            'No data',
    total_revenue:     0,
    total_invoices:    0,
    avg_invoice_value: 0,
    top_customers:     [],
    top_skus:          [],
    revenue_by_month:  [],
    material_split:    { SS: 0, MS: 0 },
    growth_rate:       0,
  };

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Page header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-100">Operations Dashboard</h2>
          <p className="text-sm text-slate-400 mt-0.5">
            Stellar Global Supplies · {summary.period}
          </p>
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-2 px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 transition-colors"
        >
          <RefreshCw size={12} />
          Refresh
        </button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <KPICard
          title="Total Revenue"
          value={fmt(summary.total_revenue)}
          change={summary.growth_rate}
          icon={<DollarSign size={18} />}
          color="#6366f1"
        />
        <KPICard
          title="Total Invoices"
          value={summary.total_invoices.toLocaleString()}
          change={summary.growth_rate * 0.8}
          icon={<FileText size={18} />}
          color="#8b5cf6"
        />
        <KPICard
          title="Avg Invoice Value"
          value={fmt(summary.avg_invoice_value)}
          change={summary.growth_rate * 0.5}
          icon={<TrendingUp size={18} />}
          color="#06b6d4"
        />
        <KPICard
          title="Active Customers"
          value={summary.top_customers.length.toString()}
          change={2.1}
          icon={<Users size={18} />}
          color="#10b981"
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <RevenueChart data={summary.revenue_by_month} />
        </div>
        <MaterialDonut split={summary.material_split} />
      </div>

      {/* Tables row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TopCustomers customers={summary.top_customers} />
        <TopSKUs      skus={summary.top_skus} />
      </div>

      {/* Quick actions */}
      <QuickActions />
    </div>
  );
}
