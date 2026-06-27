import { useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
  PieChart, Pie, Legend, AreaChart, Area,
} from 'recharts';
import { fetchAwsCosts, type AwsCostResponse } from '@/services/aws';
import { RefreshCw, TrendingUp, TrendingDown, Calendar } from 'lucide-react';

const COLOURS = [
  '#00B98E', '#3B82F6', '#F59E0B', '#EF4444',
  '#8B5CF6', '#EC4899', '#14B8A6', '#F97316',
];

const fmt      = (v: number) => `$${v.toFixed(4)}`;
const fmtMonth = (m: string) => new Date(m + '-01').toLocaleDateString(undefined, { month: 'short', year: '2-digit' });

/** Prefer the human-readable serviceName returned by the lambda, fall back to the code. */
const label = (service: string, serviceName?: string) => serviceName || service;

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

export default function AwsCostDashboard() {
  const [response, setResponse]       = useState<AwsCostResponse | null>(null);
  const now = new Date();
  const [selectedYear,  setSelectedYear]  = useState(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const loadData = async (year: number, month: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchAwsCosts(year, month);
      setResponse(res);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load AWS costs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(selectedYear, selectedMonth); }, [selectedYear, selectedMonth]);

  const allData       = response?.services      ?? [];
  const monthlyTotals = response?.monthly_totals ?? [];
  const forecasts     = response?.forecasts;
  const monthLabel    = `${MONTHS[selectedMonth - 1]} ${selectedYear}`;
  const currentYear   = now.getFullYear();
  const yearOptions   = Array.from({ length: 7 }, (_, i) => currentYear - 3 + i);

  if (loading) return <div className="agent-card p-4 animate-pulse">Loading cloud cost data…</div>;
  if (error)   return <div className="agent-card p-4 text-red-300">Error: {error}</div>;
  if (allData.length === 0)
    return <div className="agent-card p-4">No cost data available for {monthLabel}.</div>;

  // Only show services that have actual cost > 0 in charts/KPIs; keep full list for table
  const data    = allData.filter((d) => d.cost > 0);
  const total   = allData.reduce((s, d) => s + d.cost, 0);
  const top4    = data.slice(0, 4);
  const top5    = data.slice(0, 5);

  // When the lambda only has 1 month of history, linear regression returns $0.
  // Fall back to a daily-average projection in that case.
  const inferForecast = (months: number): number => {
    const fcArr = months === 1 ? forecasts?.next_month
                : months === 3 ? forecasts?.three_months
                : months === 6 ? forecasts?.six_months
                : forecasts?.twelve_months;
    const avg = fcArr && fcArr.length > 0
      ? fcArr.reduce((s, f) => s + f.forecastCost, 0) / fcArr.length
      : 0;
    if (avg > 0) return avg;
    // Fallback: daily avg × 30
    if (total > 0) {
      const daysElapsed = new Date().getDate();
      const dailyAvg = total / daysElapsed;
      return dailyAvg * 30 * months;
    }
    return 0;
  };
  const others  = data.slice(5).reduce((s, d) => s + d.cost, 0);

  const pieData = [
    ...top5.map((d) => ({ name: label(d.service, d.serviceName), value: d.cost })),
    ...(others > 0 ? [{ name: 'Other', value: others }] : []),
  ];

  const shareData = data.map((d) => ({
    service: label(d.service, d.serviceName),
    pct: parseFloat(((d.cost / total) * 100).toFixed(1)),
  }));

  // Trend + forecast chart
  const trendData = monthlyTotals.map((m) => ({
    month:    fmtMonth(m.month),
    actual:   m.total,
    forecast: null as number | null,
  }));
  const fc12 = forecasts?.twelve_months ?? [];
  const combinedData: { month: string; actual: number | null; forecast: number | null }[] = [...trendData];
  if (fc12.length > 0 && combinedData.length > 0) {
    fc12.forEach((f) => combinedData.push({ month: fmtMonth(f.forecastMonth), actual: null, forecast: f.forecastCost }));
  }

  const fcNext = forecasts?.next_month?.[0];
  const fc3    = forecasts?.three_months;
  const fc6    = forecasts?.six_months;
  const fc12m  = forecasts?.twelve_months;

  const lastActual = monthlyTotals.length >= 2 ? monthlyTotals[monthlyTotals.length - 1].total : total;
  const prevActual = monthlyTotals.length >= 2 ? monthlyTotals[monthlyTotals.length - 2].total : total;
  const trend = lastActual - prevActual;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            Cloud Costs
            <span className="text-xs text-slate-400 font-normal">{monthLabel}</span>
          </h2>
          <p className="text-xs text-slate-500">Total: {fmt(total)}</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(parseInt(e.target.value, 10))}
            className="px-3 py-1.5 text-xs rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-500 transition-colors outline-none focus:border-emerald-400/60"
          >
            {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(parseInt(e.target.value, 10))}
            className="px-3 py-1.5 text-xs rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-500 transition-colors outline-none focus:border-emerald-400/60"
          >
            {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
          </select>
          <button
            onClick={() => loadData(selectedYear, selectedMonth)}
            className="p-1.5 text-slate-400 hover:text-slate-200 transition-colors"
            title="Refresh"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Forecast KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {([
          { label: 'Next Month',   value: inferForecast(1),  color: '#00B98E' },
          { label: '3 Month Avg',  value: inferForecast(3),  color: '#3B82F6' },
          { label: '6 Month Avg',  value: inferForecast(6),  color: '#F59E0B' },
          { label: '12 Month Avg', value: inferForecast(12), color: '#8B5CF6' },
        ] as const).map((kpi) => (
          <div key={kpi.label} className="agent-card p-3 card-glow">
            <div className="text-xs text-slate-400 mb-1">{kpi.label}</div>
            <div className="text-lg font-semibold number-glow" style={{ color: kpi.color }}>{fmt(kpi.value)}</div>
            <div className="flex items-center gap-1 mt-1">
              <Calendar size={10} className="text-slate-500" />
              <span className="text-2xs text-slate-500">Forecasted</span>
            </div>
          </div>
        ))}
      </div>

      {/* Top-4 service KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {top4.map((d, i) => (
          <div key={d.service} className="agent-card p-3 card-glow">
            <div className="text-xs text-slate-400 mb-1">{label(d.service, d.serviceName)}</div>
            <div className="text-lg font-semibold" style={{ color: COLOURS[i] }}>{fmt(d.cost)}</div>
            <div className="flex items-center gap-1 mt-1">
              <span className="text-2xs text-slate-500">{((d.cost / total) * 100).toFixed(1)}% of total</span>
              {i === 0 && trend !== 0 && (
                <div className={`flex items-center gap-0.5 text-2xs ${trend > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                  {trend > 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                  {Math.abs(trend).toFixed(4)}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Trend + Forecast Chart */}
      {combinedData.length > 0 && (
        <div className="agent-card p-4 chart-glow">
          <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
            Cost Trend & Forecast
            <span className="text-2xs text-slate-500 font-normal">Actual + Projected</span>
          </h3>
          <div style={{ width: '100%', height: 220 }}>
            <ResponsiveContainer>
              <AreaChart data={combinedData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(v: number) => `$${v.toFixed(2)}`} tick={{ fontSize: 11 }} width={60} />
                <Tooltip
                  formatter={(v: number, name: string) =>
                    [fmt(v), name === 'actual' ? 'Actual' : 'Forecast']
                  }
                />
                <Area type="monotone" dataKey="actual"   stroke="#00B98E" strokeWidth={2} fill="rgba(0,185,142,0.12)"    name="actual"   connectNulls />
                <Area type="monotone" dataKey="forecast" stroke="#8B5CF6" strokeWidth={2} fill="rgba(139,92,246,0.08)"   name="forecast" connectNulls strokeDasharray="5 5" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Bar + Pie */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="agent-card p-4 chart-glow">
          <h3 className="text-sm font-medium mb-3">Cost by Service</h3>
          <div style={{ width: '100%', height: 280 }}>
            <ResponsiveContainer>
              <BarChart
                data={data.map((d) => ({ ...d, name: label(d.service, d.serviceName) }))}
                margin={{ top: 8, right: 16, left: 0, bottom: 40 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-30} textAnchor="end" interval={0} />
                <YAxis tickFormatter={(v: number) => `$${v.toFixed(2)}`} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => fmt(v)} />
                <Bar dataKey="cost" radius={[4, 4, 0, 0]}>
                  {data.map((_, i) => <Cell key={i} fill={COLOURS[i % COLOURS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="agent-card p-4 chart-glow">
          <h3 className="text-sm font-medium mb-3">Cost Distribution</h3>
          <div style={{ width: '100%', height: 280 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="45%"
                  outerRadius={90}
                  label={({ name, percent }: { name: string; percent: number }) =>
                    percent > 0.04 ? `${name} ${(percent * 100).toFixed(0)}%` : ''
                  }
                  labelLine={false}
                >
                  {pieData.map((_, i) => <Cell key={i} fill={COLOURS[i % COLOURS.length]} />)}
                </Pie>
                <Tooltip formatter={(v: number) => fmt(v)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* % Share + Table */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="agent-card p-4 chart-glow">
          <h3 className="text-sm font-medium mb-3">% Share by Service</h3>
          <div style={{ width: '100%', height: 280 }}>
            <ResponsiveContainer>
              <BarChart layout="vertical" data={shareData} margin={{ top: 4, right: 40, left: 80, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                <XAxis type="number" tickFormatter={(v: number) => `${v}%`} tick={{ fontSize: 11 }} domain={[0, 100]} />
                <YAxis type="category" dataKey="service" tick={{ fontSize: 11 }} width={74} />
                <Tooltip formatter={(v: number) => `${v}%`} />
                <Bar dataKey="pct" radius={[0, 4, 4, 0]}>
                  {shareData.map((_, i) => <Cell key={i} fill={COLOURS[i % COLOURS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="agent-card p-4">
          <h3 className="text-sm font-medium mb-3">Breakdown Table</h3>
          <div className="overflow-auto max-h-[280px]">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-400 text-left">
                  <th className="pb-2 pr-4">Service</th>
                  <th className="pb-2 pr-4">Cost (USD)</th>
                  <th className="pb-2">% of Total</th>
                </tr>
              </thead>
              <tbody>
                {allData.map((row, i) => (
                  <tr key={row.service} className="border-t border-white/5">
                    <td className="py-1.5 pr-4 flex items-center gap-2">
                      <span className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: COLOURS[i % COLOURS.length] }} />
                      {label(row.service, row.serviceName)}
                    </td>
                    <td className="py-1.5 pr-4">{fmt(row.cost)}</td>
                    <td className="py-1.5">{((row.cost / total) * 100).toFixed(1)}%</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-white/20 font-semibold">
                  <td className="py-2 pr-4">Total</td>
                  <td className="py-2 pr-4">{fmt(total)}</td>
                  <td className="py-2">100%</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}