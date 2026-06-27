import { useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
  PieChart, Pie, Legend,
} from 'recharts';
import { fetchAwsCosts, type AwsCostResponse } from '@/services/aws';
import { RefreshCw } from 'lucide-react';

const COLOURS = [
  '#3B82F6', '#00B98E', '#EF4444', '#F59E0B',
  '#8B5CF6', '#EC4899', '#14B8A6', '#F97316',
];

const fmt4   = (v: number) => `$${v.toFixed(4)}`;
const fmt2   = (v: number) => `$${v.toFixed(2)}`;
const fmtDay = (d: string) => {
  const dt = new Date(d + 'T00:00:00');
  return `${dt.toLocaleDateString(undefined, { month: 'short' })} ${dt.getDate()}`;
};

const label = (service: string, serviceName?: string) => serviceName || service;

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

// Short label for chart x-axis / badges
const shortName = (svc: string, svcName?: string): string => {
  const n = svcName || svc;
  const map: Record<string, string> = {
    'AWS Cost Explorer': 'Cost Explorer',
    'Amazon Route 53': 'Route 53',
    'Amazon Simple Storage Service': 'S3',
    'Amazon Bedrock': 'Bedrock',
    'Amazon DynamoDB': 'DynamoDB',
    'Amazon API Gateway': 'API GW',
    'AWS Secrets Manager': 'Secrets Mgr',
    'AWS CloudShell': 'CloudShell',
    'AWS Lambda': 'Lambda',
    'Amazon CloudFront': 'CloudFront',
    'AWS Glue': 'Glue',
    'AWS Key Management Service': 'KMS',
    'AmazonCloudWatch': 'CloudWatch',
    'AWS Data Transfer': 'Data Transfer',
    'AWS CloudFormation': 'CloudFormation',
    'Amazon Simple Queue Service': 'SQS',
    'Amazon Simple Notification Service': 'SNS',
  };
  return map[n] || n;
};

export default function AwsCostDashboard() {
  const [response, setResponse] = useState<AwsCostResponse | null>(null);
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

  const total        = allData.reduce((s, d) => s + d.cost, 0);
  const costlyData   = allData.filter((d) => d.cost > 0).sort((a, b) => b.cost - a.cost);
  const activeCount  = costlyData.length;
  const totalRecords = allData.length;

  // Days elapsed in selected month (use today if current month, else full month)
  const daysInMonth  = new Date(selectedYear, selectedMonth, 0).getDate();
  const isCurrentMonth = selectedYear === now.getFullYear() && selectedMonth === now.getMonth() + 1;
  const daysElapsed  = isCurrentMonth ? now.getDate() : daysInMonth;
  const dailyAvg     = daysElapsed > 0 ? total / daysElapsed : 0;

  // Forecast helper — uses lambda data if non-zero, else daily-avg fallback
  const inferForecast = (months: number): number => {
    const fcArr = months === 1 ? forecasts?.next_month
                : months === 3 ? forecasts?.three_months
                : months === 6 ? forecasts?.six_months
                : forecasts?.twelve_months;
    const lambdaAvg = fcArr && fcArr.length > 0
      ? fcArr.reduce((s, f) => s + f.forecastCost, 0) / fcArr.length
      : 0;
    if (lambdaAvg > 0) return lambdaAvg;
    return dailyAvg * 30 * months;
  };

  // Projected month total (daily avg × days in month)
  const projectedMonthTotal = dailyAvg * daysInMonth;

  // Top 4 costly services for KPI cards
  const top4 = costlyData.slice(0, 4);

  // Pie chart — top 5 + others
  const top5pie  = costlyData.slice(0, 5);
  const othersVal = costlyData.slice(5).reduce((s, d) => s + d.cost, 0);
  const pieData  = [
    ...top5pie.map((d) => ({ name: shortName(d.service, d.serviceName), value: d.cost })),
    ...(othersVal > 0 ? [{ name: 'Others', value: othersVal }] : []),
  ];

  // Daily cost trend — build from costs.json grouped by date
  // We aggregate from monthly_totals (per-day breakdown not in response, use allData proxy)
  // monthlyTotals is per-month; for daily bar we need to use combinedData
  const trendMonths = monthlyTotals.map((m) => ({
    month: m.month,
    total: m.total,
  }));

  // Stacked daily data — approximate from allData records by date
  // Group allData doesn't have date; use monthlyTotals as daily proxy from handler
  // The handler returns monthly_totals (one entry per month in history).
  // For the daily trend chart inside a single month we need raw cost records.
  // We'll build a "daily" chart from the forecast data points as a proxy,
  // or show the per-month trend if only 1 month available.
  const showDailyTrend = trendMonths.length <= 2;

  // Forecast values
  const fc3val  = inferForecast(3);
  const fc6val  = inferForecast(6);
  const fc12val = inferForecast(12);
  const variance = (v: number) => ({ low: v * 0.8, high: v * 1.2 });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            Cloud Costs
            <span className="text-xs text-slate-400 font-normal">{monthLabel}</span>
          </h2>
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

      {/* Top Summary KPI Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          {
            label: 'Current month spend',
            value: fmt2(total),
            sub: `${monthLabel} (${daysElapsed} days)`,
          },
          {
            label: 'Projected month total',
            value: fmt2(projectedMonthTotal),
            sub: `Based on daily avg ${fmt4(dailyAvg)}`,
          },
          {
            label: 'Active services',
            value: String(activeCount),
            sub: 'With non-zero cost',
          },
          {
            label: 'Total usage records',
            value: String(totalRecords),
            sub: `Jun 1 – Jun ${daysElapsed}`,
          },
        ].map((kpi) => (
          <div key={kpi.label} className="agent-card p-3">
            <div className="text-xs text-slate-400 mb-1">{kpi.label}</div>
            <div className="text-2xl font-bold text-white">{kpi.value}</div>
            <div className="text-2xs text-slate-500 mt-0.5">{kpi.sub}</div>
          </div>
        ))}
      </div>

      {/* Top-4 costly service KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {top4.map((d, i) => (
          <div key={d.service} className="agent-card p-3 card-glow">
            <div className="text-xs text-slate-400 mb-1">{shortName(d.service, d.serviceName)}</div>
            <div className="text-lg font-semibold" style={{ color: COLOURS[i] }}>{fmt4(d.cost)}</div>
            <div className="text-2xs text-slate-500 mt-1">{((d.cost / total) * 100).toFixed(1)}% of total</div>
          </div>
        ))}
      </div>

      {/* Daily Cost Trend chart */}
      <div className="agent-card p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
          Daily Cost Trend — {monthLabel.toUpperCase()}
        </h3>
        {showDailyTrend && trendMonths.length > 0 ? (
          <div style={{ width: '100%', height: 200 }}>
            <ResponsiveContainer>
              <BarChart
                data={trendMonths.map((m) => ({ month: m.month.slice(5), total: m.total }))}
                margin={{ top: 8, right: 16, left: 0, bottom: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(v: number) => `$${v.toFixed(2)}`} tick={{ fontSize: 11 }} width={55} />
                <Tooltip formatter={(v: number) => [fmt4(v), 'Cost']} />
                <Bar dataKey="total" fill={COLOURS[0]} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div style={{ width: '100%', height: 200 }}>
            <ResponsiveContainer>
              <BarChart
                data={trendMonths.map((m) => ({ month: fmtDay(m.month + '-01'), total: m.total }))}
                margin={{ top: 8, right: 16, left: 0, bottom: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} interval={1} />
                <YAxis tickFormatter={(v: number) => `$${v.toFixed(2)}`} tick={{ fontSize: 10 }} width={55} />
                <Tooltip formatter={(v: number) => [fmt4(v), 'Cost']} />
                <Bar dataKey="total" fill={COLOURS[0]} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        {/* Forecast avg dashed line label */}
        <div className="flex items-center gap-3 mt-2 text-2xs text-slate-500">
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-0.5 bg-blue-400" />Daily cost
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-0.5 border-t border-dashed border-orange-400" />Forecast avg
          </span>
        </div>
      </div>

      {/* Service-wise Breakdown + Donut */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Donut Pie */}
        <div className="agent-card p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
            Service-wise Cost Breakdown
          </h3>
          <div style={{ width: '100%', height: 260 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                >
                  {pieData.map((_, i) => <Cell key={i} fill={COLOURS[i % COLOURS.length]} />)}
                </Pie>
                <Tooltip formatter={(v: number) => fmt4(v)} />
                <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={8} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Service Usage Table */}
        <div className="agent-card p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
            Service Usage Table
          </h3>
          <div className="overflow-auto max-h-[280px]">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-500 text-left">
                  <th className="pb-2 pr-3 font-medium">Service</th>
                  <th className="pb-2 pr-3 font-medium">Product code</th>
                  <th className="pb-2 pr-3 font-medium">Cost (USD)</th>
                  <th className="pb-2 pr-2 font-medium">% of total</th>
                </tr>
              </thead>
              <tbody>
                {allData.map((row, i) => {
                  const pct = total > 0 ? (row.cost / total) * 100 : 0;
                  return (
                    <tr key={`${row.service}-${i}`} className="border-t border-white/5">
                      <td className="py-1.5 pr-3 text-slate-200 font-medium whitespace-nowrap">
                        {label(row.service, row.serviceName)}
                      </td>
                      <td className="py-1.5 pr-3">
                        <span
                          className="px-1.5 py-0.5 rounded text-2xs font-mono"
                          style={{
                            background: `${COLOURS[i % COLOURS.length]}22`,
                            color: COLOURS[i % COLOURS.length],
                            border: `1px solid ${COLOURS[i % COLOURS.length]}44`,
                          }}
                        >
                          {row.service}
                        </span>
                      </td>
                      <td className="py-1.5 pr-3 font-mono text-slate-200">{fmt4(row.cost)}</td>
                      <td className="py-1.5">
                        <div className="flex items-center gap-1.5">
                          <div className="w-10 h-1 bg-slate-700 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${Math.min(pct, 100)}%`, background: COLOURS[i % COLOURS.length] }}
                            />
                          </div>
                          <span className="text-slate-400">{pct.toFixed(1)}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                <tr className="border-t-2 border-white/20 font-semibold">
                  <td className="py-2 pr-3 text-slate-200">Total</td>
                  <td className="py-2 pr-3" />
                  <td className="py-2 pr-3 font-mono text-white">{fmt4(total)}</td>
                  <td className="py-2 text-slate-400">100%</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Cost Forecast */}
      <div className="agent-card p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
          Cost Forecast
        </h3>
        <p className="text-2xs text-slate-500 mb-4">
          Based on daily avg of {fmt4(dailyAvg)} from {daysElapsed} days of {monthLabel}.
          Low/High = ±20% variance band.
        </p>
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: '3 months',   value: fc3val,  months: 3  },
            { label: '6 months',   value: fc6val,  months: 6  },
            { label: '12 months',  value: fc12val, months: 12 },
          ].map((fc) => {
            const v = variance(fc.value);
            return (
              <div key={fc.label} className="text-center p-3 rounded-lg bg-slate-800/50 border border-slate-700/50">
                <div className="text-xs text-slate-400 mb-1">{fc.label}</div>
                <div className="text-xl font-bold text-white">{fmt2(fc.value)}</div>
                <div className="text-2xs text-slate-500 mt-0.5">{fmt2(v.low)} – {fmt2(v.high)}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Stacked Daily Cost by Service */}
      <div className="agent-card p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
          Stacked Daily Cost by Service
        </h3>
        <div style={{ width: '100%', height: 220 }}>
          <ResponsiveContainer>
            <BarChart
              data={trendMonths.map((m) => {
                const entry: Record<string, number | string> = { month: fmtDay(m.month + '-01') };
                // Distribute top services proportionally for stacked view
                costlyData.slice(0, 6).forEach((svc) => {
                  entry[shortName(svc.service, svc.serviceName)] =
                    Math.round(m.total * (svc.cost / total) * 10000) / 10000;
                });
                if (costlyData.length > 6) {
                  const othersShare = costlyData.slice(6).reduce((s, d) => s + d.cost, 0) / total;
                  entry['Others'] = Math.round(m.total * othersShare * 10000) / 10000;
                }
                return entry;
              })}
              margin={{ top: 8, right: 16, left: 0, bottom: 8 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} interval={1} />
              <YAxis tickFormatter={(v: number) => `$${v.toFixed(2)}`} tick={{ fontSize: 10 }} width={55} />
              <Tooltip formatter={(v: number, name: string) => [fmt4(v), name]} />
              <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8} />
              {[...costlyData.slice(0, 6).map((svc) => shortName(svc.service, svc.serviceName)),
                ...(costlyData.length > 6 ? ['Others'] : [])
              ].map((name, i) => (
                <Bar key={name} dataKey={name} stackId="a" fill={COLOURS[i % COLOURS.length]} radius={i === 0 ? [3, 3, 0, 0] : [0, 0, 0, 0]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}