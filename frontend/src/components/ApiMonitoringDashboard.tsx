import { useState, useEffect } from 'react';
import { Activity, TrendingUp, AlertCircle, CheckCircle, XCircle } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { fetchApiMetrics } from '@/api/client';

interface ApiMetric {
  route: string;
  method: string;
  totalCalls: number;
  successCount: number;
  errorCount: number;
  successRate: number;
  avgLatency: number;
  p99Latency: number;
}

interface TimeSeriesData {
  timestamp: string;
  calls: number;
  successes: number;
  errors: number;
}

export default function ApiMonitoringDashboard() {
  const [metrics, setMetrics] = useState<ApiMetric[]>([]);
  const [timeSeries, setTimeSeries] = useState<TimeSeriesData[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<'1h' | '24h' | '7d'>('24h');

  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 60000); // Refresh every minute
    return () => clearInterval(interval);
  }, [period]);

  const fetchMetrics = async () => {
    try {
      const data = await fetchApiMetrics(period);
      setMetrics(data.routes || []);
      setTimeSeries(data.timeSeries || []);
    } catch (error) {
      // Endpoint not deployed yet or other error - show placeholder
      setMetrics([]);
      setTimeSeries([]);
    } finally {
      setLoading(false);
    }
  };

  const totalCalls = metrics.reduce((sum, m) => sum + m.totalCalls, 0);
  const totalSuccess = metrics.reduce((sum, m) => sum + m.successCount, 0);
  const totalErrors = metrics.reduce((sum, m) => sum + m.errorCount, 0);
  const overallSuccessRate = totalCalls > 0 ? ((totalSuccess / totalCalls) * 100).toFixed(2) : '0.00';

  if (loading) {
    return (
      <div className="agent-card p-6">
        <div className="flex items-center justify-center py-12">
          <div className="text-slate-400">Loading API metrics...</div>
        </div>
      </div>
    );
  }

  // Show placeholder if endpoint not deployed
  if (metrics.length === 0 && timeSeries.length === 0) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="agent-card p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xs text-slate-400">Total API Calls</p>
                <p className="text-2xl font-bold text-slate-200">0</p>
              </div>
              <Activity className="text-blue-400" size={24} />
            </div>
          </div>
          <div className="agent-card p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xs text-slate-400">Success Rate</p>
                <p className="text-2xl font-bold text-slate-500">N/A</p>
              </div>
              <CheckCircle className="text-slate-600" size={24} />
            </div>
          </div>
          <div className="agent-card p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xs text-slate-400">Successful Calls</p>
                <p className="text-2xl font-bold text-slate-200">0</p>
              </div>
              <TrendingUp className="text-slate-600" size={24} />
            </div>
          </div>
          <div className="agent-card p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xs text-slate-400">Failed Calls</p>
                <p className="text-2xl font-bold text-slate-200">0</p>
              </div>
              <XCircle className="text-slate-600" size={24} />
            </div>
          </div>
        </div>

        <div className="agent-card p-12">
          <div className="text-center">
            <Activity className="mx-auto text-slate-600 mb-4" size={48} />
            <h3 className="text-lg font-semibold text-slate-400 mb-2">API Monitoring Not Yet Available</h3>
            <p className="text-sm text-slate-500 max-w-md mx-auto">
              The API monitoring Lambda is being deployed. This dashboard will automatically show metrics once deployment is complete.
            </p>
            <div className="mt-4 p-3 bg-amber-900/20 border border-amber-700/50 rounded-lg inline-block">
              <p className="text-xs text-amber-300">
                <strong>Note:</strong> Push to main to trigger deployment of the api-metrics Lambda.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
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

      {/* Time Series Chart */}
      <div className="agent-card p-6">
        <h3 className="text-lg font-semibold text-slate-200 mb-4">API Calls Over Time</h3>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={timeSeries}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis 
              dataKey="timestamp" 
              stroke="#94a3b8"
              style={{ fontSize: '12px' }}
            />
            <YAxis 
              stroke="#94a3b8"
              style={{ fontSize: '12px' }}
            />
            <Tooltip 
              contentStyle={{ 
                backgroundColor: '#1e293b', 
                border: '1px solid #334155',
                borderRadius: '8px'
              }}
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
            onChange={(e) => setPeriod(e.target.value as any)}
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
                      metric.method === 'GET' ? 'bg-blue-900/30 text-blue-400' :
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

      {/* Deployment Notice */}
      {metrics.length === 0 && (
        <div className="mt-4 bg-amber-900/20 border border-amber-700/50 rounded-lg p-4">
          <p className="text-sm text-amber-300">
            <strong>Note:</strong> API monitoring requires deployment of the api-metrics Lambda. 
            Push to main to deploy, or check the deployment status.
          </p>
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
              No additional charges for basic API monitoring. Data refreshes every 60 seconds.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}