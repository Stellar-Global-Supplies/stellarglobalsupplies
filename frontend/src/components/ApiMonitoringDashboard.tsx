import { useState, useEffect } from 'react';
import { Activity, TrendingUp, AlertCircle, CheckCircle, XCircle, Terminal } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Legend } from 'recharts';
import { fetchApiMetrics, type ApiMetricsPeriod, type ApiRouteMetric, type ApiTimeSeriesPoint, type ApiLambdaMetric, type ApiLambdaTimeSeriesPoint } from '@/api/client';
import DataFlowVisualization from './DataFlowVisualization';

interface TimeSeriesData extends ApiTimeSeriesPoint {
  label: string;
}

interface LambdaTimeSeriesData extends ApiLambdaTimeSeriesPoint {
  label: string;
}

function formatTimestamp(iso: string, period: string): string {
  const d = new Date(iso);
  if (period === '1h') {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (period === '7d') {
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
  // 24h
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function ApiMonitoringDashboard() {
  const [metrics, setMetrics] = useState<ApiRouteMetric[]>([]);
  const [timeSeries, setTimeSeries] = useState<TimeSeriesData[]>([]);
  const [lambdaMetrics, setLambdaMetrics] = useState<ApiLambdaMetric[]>([]);
  const [lambdaTimeSeries, setLambdaTimeSeries] = useState<LambdaTimeSeriesData[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<ApiMetricsPeriod>('24h');
  const [isWaiting, setIsWaiting] = useState(false);
  const [waitMessage, setWaitMessage] = useState('');

  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 60_000); // refresh every minute
    return () => clearInterval(interval);
  }, [period]);

  const fetchMetrics = async () => {
    try {
      const data = await fetchApiMetrics(period);
      console.log('API Metrics received:', data);

      // Check if the processor hasn't run yet (message field indicates no cache)
      if ((data as any).message && (data.routes ?? []).length === 0) {
        setIsWaiting(true);
        setWaitMessage((data as any).message);
        setMetrics([]);
        setTimeSeries([]);
        setLambdaMetrics([]);
        setLambdaTimeSeries([]);
      } else {
        setIsWaiting(false);
        setWaitMessage('');
        setMetrics(data.routes ?? []);
        setTimeSeries(
          (data.timeSeries ?? []).map((pt) => ({
            ...pt,
            label: formatTimestamp(pt.timestamp, period),
          })),
        );
        setLambdaMetrics(data.lambdaMetrics ?? []);
        setLambdaTimeSeries(
          (data.lambdaTimeSeries ?? []).map((pt) => ({
            ...pt,
            label: formatTimestamp(pt.timestamp, period),
          })),
        );
      }
    } catch (error) {
      // Silently handle — endpoint may not be deployed yet
      console.error('Failed to fetch API metrics:', error);
      setIsWaiting(false);
      setMetrics([]);
      setTimeSeries([]);
      setLambdaMetrics([]);
      setLambdaTimeSeries([]);
    } finally {
      setLoading(false);
    }
  };

  const totalCalls        = metrics.reduce((sum, m) => sum + m.totalCalls, 0);
  const totalSuccess      = metrics.reduce((sum, m) => sum + m.successCount, 0);
  const totalErrors       = metrics.reduce((sum, m) => sum + m.errorCount, 0);
  const overallSuccessRate = totalCalls > 0 ? ((totalSuccess / totalCalls) * 100).toFixed(2) : '0.00';

  const totalInvocations = lambdaMetrics.reduce((sum, m) => sum + m.invocations, 0);
  const totalLambdaErrors = lambdaMetrics.reduce((sum, m) => sum + m.errors, 0);
  const totalLambdaSuccess = lambdaMetrics.reduce((sum, m) => sum + m.successCount, 0);
  const overallLambdaSuccessRate = totalInvocations > 0 ? ((totalLambdaSuccess / totalInvocations) * 100).toFixed(2) : '0.00';

  if (loading) {
    return (
      <div className="agent-card p-6">
        <div className="flex items-center justify-center py-12">
          <div className="text-slate-400">Loading metrics...</div>
        </div>
      </div>
    );
  }

  // Data flow visualization
  const apiFlowNodes = [
    { id: 'client', label: 'Client', icon: 'source' as const, status: 'active' as const, description: 'HTTP Requests' },
    { id: 'apigw', label: 'API Gateway', icon: 'process' as const, status: 'active' as const, description: 'Route & Auth' },
    { id: 'lambda', label: 'Lambda', icon: 'process' as const, status: 'active' as const, description: 'Business Logic' },
    { id: 'cloudwatch', label: 'CloudWatch', icon: 'storage' as const, status: 'active' as const, description: 'Metrics & Logs' },
    { id: 'processor', label: 'Processor', icon: 'process' as const, status: isWaiting ? 'idle' as const : 'active' as const, description: '4x Daily' },
    { id: 's3', label: 'S3 Cache', icon: 'storage' as const, status: isWaiting ? 'idle' as const : 'active' as const, description: 'Cached Data' },
    { id: 'dashboard', label: 'Dashboard', icon: 'output' as const, status: 'active' as const, description: 'Real-time View' },
  ];

  const apiFlowEdges = [
    { from: 'client', to: 'apigw', label: 'HTTPS', active: true, speed: 'fast' as const },
    { from: 'apigw', to: 'lambda', label: 'Proxy', active: true, speed: 'fast' as const },
    { from: 'lambda', to: 'cloudwatch', label: 'Metrics', active: true, speed: 'medium' as const },
    { from: 'cloudwatch', to: 'processor', label: 'Fetch', active: !isWaiting, speed: 'medium' as const },
    { from: 'processor', to: 's3', label: 'Cache', active: !isWaiting, speed: 'medium' as const },
    { from: 's3', to: 'dashboard', label: 'Display', active: !isWaiting, speed: 'fast' as const },
  ];

  // Data flow visualization (always show)
  const showDataFlow = true;

  // Waiting for processor to run and cache data
  if (isWaiting) {
    return (
      <div className="space-y-6">
        <DataFlowVisualization
          title="API Metrics Data Flow"
          subtitle="Real-time data pipeline from API Gateway to Dashboard"
          nodes={apiFlowNodes}
          edges={apiFlowEdges}
          refreshInterval={2000}
        />

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[
            { label: 'Total API Calls',   value: '—',   icon: <Activity className="text-slate-600" size={24} /> },
            { label: 'Success Rate',      value: 'N/A', icon: <CheckCircle className="text-slate-600" size={24} /> },
            { label: 'Successful Calls',  value: '—',   icon: <TrendingUp className="text-slate-600" size={24} /> },
            { label: 'Errors',            value: '—',   icon: <XCircle className="text-slate-600" size={24} /> },
          ].map(({ label, value, icon }) => (
            <div key={label} className="agent-card p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-2xs text-slate-400">{label}</p>
                  <p className="text-2xl font-bold text-slate-500">{value}</p>
                </div>
                {icon}
              </div>
            </div>
          ))}
        </div>

        <div className="agent-card p-12">
          <div className="text-center">
            <div className="flex items-center justify-center mb-4">
              <div className="w-16 h-16 rounded-full bg-amber-900/20 flex items-center justify-center">
                <Activity className="text-amber-400 animate-pulse" size={32} />
              </div>
            </div>
            <h3 className="text-lg font-semibold text-slate-300 mb-2">Waiting for Metrics Processing</h3>
            <p className="text-sm text-slate-400 max-w-lg mx-auto mb-4">
              {waitMessage || 'The api-metrics-processor Lambda has not yet run. Metrics will be collected and cached automatically.'}
            </p>
            <div className="text-xs text-slate-500 space-y-1">
              <p>The processor runs 4 times daily:</p>
              <p className="font-mono">9:00 AM | 12:00 PM | 3:00 PM | 6:00 PM (IST)</p>
              <p className="mt-2">Next refresh will happen automatically...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Placeholder when endpoint is not yet deployed / returns no data
  if (metrics.length === 0 && timeSeries.length === 0 && lambdaMetrics.length === 0) {
    console.log('Showing placeholder - no metrics data');
    return (
      <div className="space-y-6">
        <DataFlowVisualization
          title="API Metrics Data Flow"
          subtitle="Real-time data pipeline from API Gateway to Dashboard"
          nodes={apiFlowNodes}
          edges={apiFlowEdges}
          refreshInterval={2000}
        />

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[
            { label: 'Total API Calls',   value: '0',   icon: <Activity className="text-blue-400" size={24} /> },
            { label: 'Success Rate',      value: 'N/A', icon: <CheckCircle className="text-slate-600" size={24} /> },
            { label: 'Successful Calls',  value: '0',   icon: <TrendingUp className="text-slate-600" size={24} /> },
            { label: 'Errors',            value: '0',   icon: <XCircle className="text-slate-600" size={24} /> },
          ].map(({ label, value, icon }) => (
            <div key={label} className="agent-card p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-2xs text-slate-400">{label}</p>
                  <p className="text-2xl font-bold text-slate-500">{value}</p>
                </div>
                {icon}
              </div>
            </div>
          ))}
        </div>

        <div className="agent-card p-12">
          <div className="text-center">
            <Activity className="mx-auto text-slate-600 mb-4" size={48} />
            <h3 className="text-lg font-semibold text-slate-400 mb-2">API Monitoring Not Yet Available</h3>
            <p className="text-sm text-slate-500 max-w-md mx-auto">
              The API monitoring Lambda is being deployed. This dashboard will automatically show
              metrics once deployment is complete.
            </p>
            <div className="mt-4 p-3 bg-amber-900/20 border border-amber-700/50 rounded-lg inline-block">
              <p className="text-xs text-amber-300">
                <strong>Note:</strong> Push to main to trigger deployment of the api-metrics Lambda.
                Also verify the <code>API_NAME</code> environment variable is set on the Lambda.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Data Flow Visualization */}
      <DataFlowVisualization
        title="API Metrics Data Flow"
        subtitle="Real-time data pipeline from API Gateway to Dashboard"
        nodes={apiFlowNodes}
        edges={apiFlowEdges}
        refreshInterval={2000}
      />

      {/* API Summary Cards */}
      <h2 className="text-xl font-semibold text-slate-200">API Gateway Metrics</h2>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="agent-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-2xs text-slate-400">Total API Calls</p>
              <p className="text-2xl font-bold text-slate-200">{totalCalls.toLocaleString()}</p>
            </div>
            <Activity className="text-blue-400" size={24} />
          </div>
        </div>

        <div className="agent-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-2xs text-slate-400">Success Rate</p>
              <p className="text-2xl font-bold text-emerald-400">{overallSuccessRate}%</p>
            </div>
            <CheckCircle className="text-emerald-400" size={24} />
          </div>
        </div>

        <div className="agent-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-2xs text-slate-400">Successful Calls</p>
              <p className="text-2xl font-bold text-emerald-400">{totalSuccess.toLocaleString()}</p>
            </div>
            <TrendingUp className="text-emerald-400" size={24} />
          </div>
        </div>

        <div className="agent-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-2xs text-slate-400">Failed Calls</p>
              <p className="text-2xl font-bold text-red-400">{totalErrors.toLocaleString()}</p>
            </div>
            <XCircle className="text-red-400" size={24} />
          </div>
        </div>
      </div>

      {/* API Time Series Chart */}
      <div className="agent-card p-6">
        <h3 className="text-lg font-semibold text-slate-200 mb-4">API Calls Over Time</h3>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={timeSeries}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis
              dataKey="label"
              stroke="#94a3b8"
              style={{ fontSize: '12px' }}
              tick={{ fill: '#94a3b8' }}
            />
            <YAxis
              stroke="#94a3b8"
              style={{ fontSize: '12px' }}
              tick={{ fill: '#94a3b8' }}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1e293b',
                border: '1px solid #334155',
                borderRadius: '8px',
              }}
              labelStyle={{ color: '#94a3b8' }}
            />
            <Area
              type="monotone"
              dataKey="calls"
              stackId="1"
              stroke="#3b82f6"
              fill="#3b82f6"
              fillOpacity={0.6}
              name="Total Calls"
            />
            <Area
              type="monotone"
              dataKey="errors"
              stackId="2"
              stroke="#ef4444"
              fill="#ef4444"
              fillOpacity={0.6}
              name="Errors"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Route Details Table */}
      <div className="agent-card p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-slate-200">Route Performance</h3>
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as ApiMetricsPeriod)}
            className="px-3 py-1 bg-slate-800 border border-slate-700 rounded text-sm text-slate-200"
          >
            <option value="1h">Last 1 Hour</option>
            <option value="24h">Last 24 Hours</option>
            <option value="7d">Last 7 Days</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700">
                <th className="text-left py-2 px-4 text-slate-400 font-medium">Route</th>
                <th className="text-left py-2 px-4 text-slate-400 font-medium">Method</th>
                <th className="text-right py-2 px-4 text-slate-400 font-medium">Total Calls</th>
                <th className="text-right py-2 px-4 text-slate-400 font-medium">Success</th>
                <th className="text-right py-2 px-4 text-slate-400 font-medium">Errors</th>
                <th className="text-right py-2 px-4 text-slate-400 font-medium">Success Rate</th>
                <th className="text-right py-2 px-4 text-slate-400 font-medium">Avg Latency</th>
                <th className="text-right py-2 px-4 text-slate-400 font-medium">P99 Latency</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map((metric, idx) => (
                <tr key={idx} className="border-b border-slate-800 hover:bg-slate-800/30">
                  <td className="py-2 px-4 text-slate-200 font-mono text-xs">{metric.route}</td>
                  <td className="py-2 px-4">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                      metric.method === 'GET'  ? 'bg-blue-900/30 text-blue-400' :
                      metric.method === 'POST' ? 'bg-emerald-900/30 text-emerald-400' :
                      'bg-slate-700 text-slate-300'
                    }`}>
                      {metric.method}
                    </span>
                  </td>
                  <td className="py-2 px-4 text-right text-slate-300">{metric.totalCalls.toLocaleString()}</td>
                  <td className="py-2 px-4 text-right text-emerald-400">{metric.successCount.toLocaleString()}</td>
                  <td className="py-2 px-4 text-right text-red-400">{metric.errorCount.toLocaleString()}</td>
                  <td className="py-2 px-4 text-right">
                    <span className={`font-medium ${
                      metric.successRate >= 99 ? 'text-emerald-400' :
                      metric.successRate >= 95 ? 'text-amber-400' :
                      'text-red-400'
                    }`}>
                      {metric.successRate.toFixed(2)}%
                    </span>
                  </td>
                  <td className="py-2 px-4 text-right text-slate-300">{metric.avgLatency}ms</td>
                  <td className="py-2 px-4 text-right text-slate-300">{metric.p99Latency}ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {metrics.length === 0 && (
          <div className="text-center py-8 text-slate-400">
            No API calls recorded in this period
          </div>
        )}
      </div>

      {/* ── Lambda Metrics Section ── */}
      {lambdaMetrics.length > 0 && (
        <>
          <div className="border-t border-slate-700 my-8"></div>
          <h2 className="text-xl font-semibold text-slate-200 flex items-center gap-2">
            <Terminal size={22} className="text-orange-400" />
            Lambda Function Metrics
          </h2>

          {/* Lambda Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="agent-card p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-2xs text-slate-400">Total Invocations</p>
                  <p className="text-2xl font-bold text-slate-200">{totalInvocations.toLocaleString()}</p>
                </div>
                <Terminal className="text-orange-400" size={24} />
              </div>
            </div>

            <div className="agent-card p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-2xs text-slate-400">Lambda Success Rate</p>
                  <p className="text-2xl font-bold text-emerald-400">{overallLambdaSuccessRate}%</p>
                </div>
                <CheckCircle className="text-emerald-400" size={24} />
              </div>
            </div>

            <div className="agent-card p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-2xs text-slate-400">Successful Invocations</p>
                  <p className="text-2xl font-bold text-emerald-400">{totalLambdaSuccess.toLocaleString()}</p>
                </div>
                <TrendingUp className="text-emerald-400" size={24} />
              </div>
            </div>

            <div className="agent-card p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-2xs text-slate-400">Lambda Errors</p>
                  <p className="text-2xl font-bold text-red-400">{totalLambdaErrors.toLocaleString()}</p>
                </div>
                <XCircle className="text-red-400" size={24} />
              </div>
            </div>
          </div>

          {/* Lambda Time Series Chart */}
          {lambdaTimeSeries.length > 0 && (
            <div className="agent-card p-6">
              <h3 className="text-lg font-semibold text-slate-200 mb-4">Lambda Invocations Over Time</h3>
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={lambdaTimeSeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis
                    dataKey="label"
                    stroke="#94a3b8"
                    style={{ fontSize: '12px' }}
                    tick={{ fill: '#94a3b8' }}
                  />
                  <YAxis
                    stroke="#94a3b8"
                    style={{ fontSize: '12px' }}
                    tick={{ fill: '#94a3b8' }}
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1e293b',
                      border: '1px solid #334155',
                      borderRadius: '8px',
                    }}
                    labelStyle={{ color: '#94a3b8' }}
                  />
                  <Area
                    type="monotone"
                    dataKey="invocations"
                    stackId="1"
                    stroke="#f97316"
                    fill="#f97316"
                    fillOpacity={0.6}
                    name="Total Invocations"
                  />
                  <Area
                    type="monotone"
                    dataKey="errors"
                    stackId="2"
                    stroke="#ef4444"
                    fill="#ef4444"
                    fillOpacity={0.6}
                    name="Errors"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Lambda Per-Function Bar Chart */}
          <div className="agent-card p-6">
            <h3 className="text-lg font-semibold text-slate-200 mb-4">Per-Function Invocations vs Errors</h3>
            <ResponsiveContainer width="100%" height={lambdaMetrics.length > 20 ? 600 : 300}>
              <BarChart
                data={lambdaMetrics}
                layout="vertical"
                margin={{ left: lambdaMetrics.some(m => m.functionName.length > 40) ? 80 : 60 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis type="number" stroke="#94a3b8" style={{ fontSize: '12px' }} tick={{ fill: '#94a3b8' }} />
                <YAxis
                  type="category"
                  dataKey="functionName"
                  stroke="#94a3b8"
                  style={{ fontSize: '11px' }}
                  tick={{ fill: '#94a3b8' }}
                  width={lambdaMetrics.some(m => m.functionName.length > 40) ? 200 : 150}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1e293b',
                    border: '1px solid #334155',
                    borderRadius: '8px',
                  }}
                  labelStyle={{ color: '#94a3b8' }}
                />
                <Legend />
                <Bar dataKey="invocations" fill="#f97316" name="Invocations" radius={[0, 4, 4, 0]} />
                <Bar dataKey="errors" fill="#ef4444" name="Errors" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Lambda Details Table */}
          <div className="agent-card p-6">
            <h3 className="text-lg font-semibold text-slate-200 mb-4">Lambda Function Details</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700">
                    <th className="text-left py-2 px-4 text-slate-400 font-medium">Function Name</th>
                    <th className="text-right py-2 px-4 text-slate-400 font-medium">Invocations</th>
                    <th className="text-right py-2 px-4 text-slate-400 font-medium">Success</th>
                    <th className="text-right py-2 px-4 text-slate-400 font-medium">Errors</th>
                    <th className="text-right py-2 px-4 text-slate-400 font-medium">Throttles</th>
                    <th className="text-right py-2 px-4 text-slate-400 font-medium">Success Rate</th>
                    <th className="text-right py-2 px-4 text-slate-400 font-medium">Avg Duration</th>
                    <th className="text-right py-2 px-4 text-slate-400 font-medium">P99 Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {lambdaMetrics.map((metric, idx) => (
                    <tr key={idx} className="border-b border-slate-800 hover:bg-slate-800/30">
                      <td className="py-2 px-4 text-slate-200 font-mono text-xs max-w-[200px] truncate" title={metric.functionName}>
                        {metric.functionName}
                      </td>
                      <td className="py-2 px-4 text-right text-slate-300">{metric.invocations.toLocaleString()}</td>
                      <td className="py-2 px-4 text-right text-emerald-400">{metric.successCount.toLocaleString()}</td>
                      <td className="py-2 px-4 text-right text-red-400">{metric.errors.toLocaleString()}</td>
                      <td className="py-2 px-4 text-right text-amber-400">{metric.throttles.toLocaleString()}</td>
                      <td className="py-2 px-4 text-right">
                        <span className={`font-medium ${
                          metric.successRate >= 99 ? 'text-emerald-400' :
                          metric.successRate >= 95 ? 'text-amber-400' :
                          'text-red-400'
                        }`}>
                          {metric.successRate.toFixed(2)}%
                        </span>
                      </td>
                      <td className="py-2 px-4 text-right text-slate-300">{metric.avgDuration.toFixed(2)}ms</td>
                      <td className="py-2 px-4 text-right text-slate-300">{metric.p99Duration.toFixed(2)}ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {lambdaMetrics.length === 0 && (
              <div className="text-center py-8 text-slate-400">
                No Lambda invocations recorded in this period
              </div>
            )}
          </div>

          {/* Cost Notice */}
          <div className="bg-blue-900/20 border border-blue-700/50 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="text-blue-400 mt-0.5" size={20} />
              <div className="text-sm">
                <p className="text-blue-300 font-medium mb-1">Free CloudWatch Metrics</p>
                <p className="text-blue-200/80">
                  This dashboard uses AWS CloudWatch standard metrics (free tier includes 10 custom metrics).
                  No additional charges for basic Lambda & API monitoring. Data refreshes every minute via scheduled EventBridge rules.
                </p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}