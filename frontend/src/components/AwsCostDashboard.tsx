import React, { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { fetchAwsCosts } from '@/services/aws';

type AwsCost = { service: string; cost: number };

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
        setData(res);
      } catch (err: any) {
        console.error('Failed to load AWS costs', err);
        if (mounted) setError(err?.message ?? 'Failed to load AWS costs');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const monthLabel = new Date().toLocaleString(undefined, { month: 'long', year: 'numeric' });

  if (loading) return <div className="agent-card p-4">Loading cloud cost data...</div>;
  if (error) return <div className="agent-card p-4 text-red-300">Error: {error}</div>;
  if (!data || data.length === 0) return <div className="agent-card p-4">No cost data available for {monthLabel}.</div>;

  const total = data.reduce((s, d) => s + d.cost, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Cloud Costs — {monthLabel}</h2>
        <div className="text-sm text-slate-300">Total: ${total.toFixed(2)}</div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="agent-card p-4">
          <h3 className="text-sm font-medium mb-3">Cost by AWS Service (table)</h3>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-400 text-left">
                  <th className="pb-2">Service</th>
                  <th className="pb-2">Cost (USD)</th>
                  <th className="pb-2">% of total</th>
                </tr>
              </thead>
              <tbody>
                {data.map((row) => (
                  <tr key={row.service} className="border-t border-white/5">
                    <td className="py-2 pr-4">{row.service}</td>
                    <td className="py-2 pr-4">${row.cost.toFixed(2)}</td>
                    <td className="py-2">{((row.cost / total) * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="agent-card p-4">
          <h3 className="text-sm font-medium mb-3">Cost by AWS Service (chart)</h3>
          <div style={{ width: '100%', height: 320 }}>
            <ResponsiveContainer>
              <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
                <XAxis dataKey="service" tick={{ fontSize: 12 }} />
                <YAxis tickFormatter={(v) => `$${Number(v).toFixed(0)}`} />
                <Tooltip formatter={(v: any) => `$${Number(v).toFixed(2)}`} />
                <Bar dataKey="cost" fill="#00B98E" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

    </div>
  );
}
