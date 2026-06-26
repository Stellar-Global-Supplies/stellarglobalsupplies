import { useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
  PieChart, Pie, Legend,
} from 'recharts';
import { fetchAwsCosts } from '@/services/aws';

type AwsCost = { service: string; cost: number };

// Colour palette for pie / bar cells
const COLOURS = [
  '#00B98E', '#3B82F6', '#F59E0B', '#EF4444',
  '#8B5CF6', '#EC4899', '#14B8A6', '#F97316',
];

const fmt = (v: number) => `$${v.toFixed(2)}`;

export default function AwsCostDashboard() {
  const [data, setData] = useState<AwsCost[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        const res = await fetchAwsCosts();
        if (!mounted) return;
        // Sort descending by cost so charts are naturally ordered
        setData([...res].sort((a, b) => b.cost - a.cost));
      } catch (err: any) {
        if (mounted) setError(err?.message ?? 'Failed to load AWS costs');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const monthLabel = new Date().toLocaleString(undefined, { month: 'long', year: 'numeric' });

  if (loading) return <div className="agent-card p-4">Loading cloud cost data…</div>;
  if (error)   return <div className="agent-card p-4 text-red-300">Error: {error}</div>;
  if (!data || data.length === 0)
    return <div className="agent-card p-4">No cost data available for {monthLabel}.</div>;

  const total     = data.reduce((s, d) => s + d.cost, 0);
  const top5      = data.slice(0, 5);
  const others    = data.slice(5).reduce((s, d) => s + d.cost, 0);
  const pieData   = [
    ...top5.map((d) => ({ name: d.service, value: d.cost })),
    ...(others > 0 ? [{ name: 'Other', value: others }] : []),
  ];
  const shareData = data.map((d) => ({
    service: d.service,
    pct: parseFloat(((d.cost / total) * 100).toFixed(1)),
  }));

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Cloud Costs — {monthLabel}</h2>
        <div className="text-sm text-slate-300">Total: {fmt(total)}</div>
      </div>

      {/* Summary KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {top5.slice(0, 4).map((d, i) => (
          <div key={d.service} className="agent-card p-3">
            <div className="text-xs text-slate-400 mb-1">{d.service}</div>
            <div className="text-lg font-semibold" style={{ color: COLOURS[i] }}>{fmt(d.cost)}</div>
            <div className="text-xs text-slate-500">{((d.cost / total) * 100).toFixed(1)}% of total</div>
          </div>
        ))}
      </div>

      {/* Row 1: Bar chart (all services) + Pie chart */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Bar chart — cost by service */}
        <div className="agent-card p-4">
          <h3 className="text-sm font-medium mb-3">Cost by Service</h3>
          <div style={{ width: '100%', height: 280 }}>
            <ResponsiveContainer>
              <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="service" tick={{ fontSize: 11 }} angle={-30} textAnchor="end" interval={0} />
                <YAxis tickFormatter={(v) => `$${Number(v).toFixed(0)}`} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: any) => fmt(Number(v))} />
                <Bar dataKey="cost" radius={[4, 4, 0, 0]}>
                  {data.map((_, i) => (
                    <Cell key={i} fill={COLOURS[i % COLOURS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Pie chart — top 5 + other */}
        <div className="agent-card p-4">
          <h3 className="text-sm font-medium mb-3">Cost Distribution (Top 5)</h3>
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
                  label={({ name, percent }) =>
                    percent > 0.04 ? `${name} ${(percent * 100).toFixed(0)}%` : ''
                  }
                  labelLine={false}
                >
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={COLOURS[i % COLOURS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: any) => fmt(Number(v))} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Row 2: % share bar + data table */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* % share horizontal bar */}
        <div className="agent-card p-4">
          <h3 className="text-sm font-medium mb-3">% Share by Service</h3>
          <div style={{ width: '100%', height: 280 }}>
            <ResponsiveContainer>
              <BarChart
                layout="vertical"
                data={shareData}
                margin={{ top: 4, right: 40, left: 80, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                <XAxis type="number" tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11 }} domain={[0, 100]} />
                <YAxis type="category" dataKey="service" tick={{ fontSize: 11 }} width={74} />
                <Tooltip formatter={(v: any) => `${v}%`} />
                <Bar dataKey="pct" radius={[0, 4, 4, 0]}>
                  {shareData.map((_, i) => (
                    <Cell key={i} fill={COLOURS[i % COLOURS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Detailed table */}
        <div className="agent-card p-4">
          <h3 className="text-sm font-medium mb-3">Breakdown Table</h3>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-400 text-left">
                  <th className="pb-2 pr-4">Service</th>
                  <th className="pb-2 pr-4">Cost (USD)</th>
                  <th className="pb-2">% of Total</th>
                </tr>
              </thead>
              <tbody>
                {data.map((row, i) => (
                  <tr key={row.service} className="border-t border-white/5">
                    <td className="py-1.5 pr-4 flex items-center gap-2">
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ background: COLOURS[i % COLOURS.length] }}
                      />
                      {row.service}
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
