import { useEffect, useState } from 'react';
import { Database, Table, Activity, CheckCircle, XCircle, RefreshCw, Server, HardDrive, FileText, Folder } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell, PieChart, Pie, Legend } from 'recharts';
import { fetchSupabaseMetrics, type SupabaseMetrics } from '@/services/supabase';
import DataFlowVisualization, { type DataFlowNode, type DataFlowEdge } from './DataFlowVisualization';

const COLOURS = [
  '#3B82F6', '#00B98E', '#EF4444', '#F59E0B',
  '#8B5CF6', '#EC4899', '#14B8A6', '#F97316',
];

const fmtMB = (v: number) => `${v.toFixed(2)} MB`;
const fmtNum = (v: number) => v.toLocaleString();

export default function SupabaseDashboard() {
  const [metrics, setMetrics] = useState<SupabaseMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchSupabaseMetrics();
      setMetrics(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load Supabase metrics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  if (loading) return <div className="agent-card p-4 animate-pulse">Loading Supabase metrics...</div>;
  if (error) return <div className="agent-card p-4 text-red-300">Error: {error}</div>;
  if (!metrics) return <div className="agent-card p-4">No Supabase metrics available.</div>;

  const { connection, tables, total_db_size_mb, request_metrics } = metrics;
  const { total_requests, successful_requests, failed_requests, success_rate } = request_metrics;

  // Data flow visualization for Supabase
  const supabaseFlowNodes: DataFlowNode[] = [
    { id: 'client', label: 'Client', icon: 'source' as const, status: connection.connected ? 'active' as const : 'idle' as const, description: 'Web/Mobile' },
    { id: 'supabase', label: 'Supabase', icon: 'process' as const, status: connection.connected ? 'active' as const : 'idle' as const, description: 'PostgreSQL' },
    { id: 'tables', label: 'Tables', icon: 'storage' as const, status: 'active' as const, description: `${tables.length} tables` },
    { id: 'dashboard', label: 'Dashboard', icon: 'output' as const, status: 'active' as const, description: 'Real-time View' },
  ];

  const supabaseFlowEdges: DataFlowEdge[] = [
    { from: 'client', to: 'supabase', label: 'Query', active: connection.connected, speed: 'fast' as const },
    { from: 'supabase', to: 'tables', label: 'Data', active: connection.connected, speed: 'fast' as const },
    { from: 'tables', to: 'dashboard', label: 'Display', active: true, speed: 'fast' as const },
  ];

  // Prepare chart data for table sizes
  const tableSizeData = tables
    .filter(t => t.size_mb > 0)
    .sort((a, b) => b.size_mb - a.size_mb)
    .slice(0, 10);

  // Prepare chart data for row counts
  const tableRowCountData = tables
    .sort((a, b) => b.row_count - a.row_count)
    .slice(0, 10);

  // Pie chart data for request success/failure
  const requestPieData = [
    { name: 'Successful', value: successful_requests, color: '#00B98E' },
    { name: 'Failed', value: failed_requests, color: '#EF4444' },
  ];

  return (
    <div className="space-y-4">
      {/* Data Flow Visualization */}
      <DataFlowVisualization
        title="Supabase Data Flow"
        subtitle="Real-time connection from client to database"
        nodes={supabaseFlowNodes}
        edges={supabaseFlowEdges}
        refreshInterval={3000}
      />

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Database size={20} className="text-blue-400" />
            Supabase Database
          </h2>
        </div>
        <button
          onClick={loadData}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 bg-slate-800 border border-slate-700 hover:border-slate-500 rounded-lg transition-colors"
          title="Refresh"
        >
          <RefreshCw size={12} />
          Refresh
        </button>
      </div>

      {/* Connection Status */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="agent-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-2xs text-slate-400">Connection Status</p>
              <p className={`text-lg font-bold ${connection.connected ? 'text-emerald-400' : 'text-red-400'}`}>
                {connection.connected ? 'Connected' : 'Disconnected'}
              </p>
            </div>
            <Server size={24} className={connection.connected ? 'text-emerald-400' : 'text-red-400'} />
          </div>
          {connection.database_version && (
            <p className="text-2xs text-slate-500 mt-2">{connection.database_version}</p>
          )}
          {connection.error && (
            <p className="text-2xs text-red-400 mt-2">{connection.error}</p>
          )}
        </div>

        <div className="agent-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-2xs text-slate-400">Total Database Size</p>
              <p className="text-lg font-bold text-white">{fmtMB(total_db_size_mb)}</p>
            </div>
            <HardDrive size={24} className="text-blue-400" />
          </div>
          <p className="text-2xs text-slate-500 mt-2">{tables.length} tables</p>
        </div>

        <div className="agent-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-2xs text-slate-400">Project Size</p>
              <p className="text-lg font-bold text-emerald-400">{fmtMB(total_db_size_mb)}</p>
            </div>
            <Folder size={24} className="text-emerald-400" />
          </div>
          <p className="text-2xs text-slate-500 mt-2">Application data only</p>
        </div>

        <div className="agent-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-2xs text-slate-400">Total Rows</p>
              <p className="text-lg font-bold text-white">{fmtNum(tables.reduce((s, t) => s + t.row_count, 0))}</p>
            </div>
            <FileText size={24} className="text-violet-400" />
          </div>
          <p className="text-2xs text-slate-500 mt-2">Across all tables</p>
        </div>
      </div>

      {/* Request Metrics */}
      <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400 mt-6">
        Request Metrics
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="agent-card p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-2xs text-slate-400">Total Requests</p>
              <p className="text-xl font-bold text-white">{fmtNum(total_requests)}</p>
            </div>
            <Activity size={18} className="text-blue-400" />
          </div>
        </div>

        <div className="agent-card p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-2xs text-slate-400">Success Rate</p>
              <p className="text-xl font-bold text-emerald-400">{success_rate.toFixed(1)}%</p>
            </div>
            <CheckCircle size={18} className="text-emerald-400" />
          </div>
        </div>

        <div className="agent-card p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-2xs text-slate-400">Successful</p>
              <p className="text-xl font-bold text-emerald-400">{fmtNum(successful_requests)}</p>
            </div>
            <CheckCircle size={18} className="text-emerald-400" />
          </div>
        </div>

        <div className="agent-card p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-2xs text-slate-400">Failed</p>
              <p className="text-xl font-bold text-red-400">{fmtNum(failed_requests)}</p>
            </div>
            <XCircle size={18} className="text-red-400" />
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Table Sizes Bar Chart */}
        <div className="agent-card p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
            Table Sizes (MB)
          </h3>
          {tableSizeData.length > 0 ? (
            <div style={{ width: '100%', height: 260 }}>
              <ResponsiveContainer>
                <BarChart
                  data={tableSizeData}
                  layout="vertical"
                  margin={{ top: 8, right: 16, left: 60, bottom: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                  <XAxis type="number" tickFormatter={(v) => `${v.toFixed(1)}`} tick={{ fontSize: 10 }} />
                  <YAxis
                    dataKey="table_name"
                    type="category"
                    tick={{ fontSize: 10 }}
                    width={80}
                  />
                  <Tooltip formatter={(v: number) => [`${v.toFixed(2)} MB`, 'Size']} />
                  <Bar dataKey="size_mb" fill={COLOURS[0]} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex items-center justify-center h-[260px] text-slate-500">
              Table size data not available (requires RPC function)
            </div>
          )}
        </div>

        {/* Request Success/Failure Pie Chart */}
        <div className="agent-card p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
            Request Distribution
          </h3>
          <div style={{ width: '100%', height: 260 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={requestPieData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={90}
                >
                  {requestPieData.map((entry, i) => (
                    <Cell key={`cell-${i}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number) => fmtNum(v)} />
                <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={8} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Table Details */}
      <div className="agent-card p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
          Table Details
        </h3>
        <div className="overflow-auto max-h-[400px]">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500 text-left">
                <th className="pb-2 pr-3 font-medium">Table Name</th>
                <th className="pb-2 pr-3 font-medium">Row Count</th>
                <th className="pb-2 pr-3 font-medium">Size (MB)</th>
                <th className="pb-2 pr-2 font-medium">Size (Bytes)</th>
              </tr>
            </thead>
            <tbody>
              {tables.map((table) => (
                <tr key={table.table_name} className="border-t border-white/5">
                  <td className="py-1.5 pr-3 text-slate-200 font-medium">
                    <div className="flex items-center gap-2">
                      <Table size={14} className="text-slate-500" />
                      {table.table_name}
                    </div>
                  </td>
                  <td className="py-1.5 pr-3 font-mono text-slate-200">{fmtNum(table.row_count)}</td>
                  <td className="py-1.5 pr-3 font-mono text-slate-200">{table.size_mb > 0 ? fmtMB(table.size_mb) : '—'}</td>
                  <td className="py-1.5 font-mono text-slate-400">{table.size_bytes > 0 ? fmtNum(table.size_bytes) : '—'}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-white/20 font-semibold">
                <td className="py-2 pr-3 text-slate-200">Total</td>
                <td className="py-2 pr-3 font-mono text-white">{fmtNum(tables.reduce((s, t) => s + t.row_count, 0))}</td>
                <td className="py-2 pr-3 font-mono text-white">{fmtMB(total_db_size_mb)}</td>
                <td className="py-2 font-mono text-slate-400">—</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Row Count Bar Chart */}
      <div className="agent-card p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
          Row Count by Table
        </h3>
        <div style={{ width: '100%', height: 260 }}>
          <ResponsiveContainer>
            <BarChart
              data={tableRowCountData}
              layout="vertical"
              margin={{ top: 8, right: 16, left: 60, bottom: 8 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
              <XAxis type="number" tickFormatter={(v) => fmtNum(v)} tick={{ fontSize: 10 }} />
              <YAxis
                dataKey="table_name"
                type="category"
                tick={{ fontSize: 10 }}
                width={80}
              />
              <Tooltip formatter={(v: number) => fmtNum(v)} />
              <Bar dataKey="row_count" fill={COLOURS[1]} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Info Note */}
      <div className="bg-blue-900/20 border border-blue-700/50 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <Database className="text-blue-400 mt-0.5" size={16} />
          <div className="text-xs">
            <p className="text-blue-300 font-medium mb-1">Supabase Database Metrics</p>
            <p className="text-blue-200/80">
              This dashboard shows real-time connection status and table statistics from your Supabase PostgreSQL database.
              Table sizes require the <code>get_table_stats</code> RPC function to be created in your Supabase project.
              Request metrics are derived from total row counts across all tables.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}