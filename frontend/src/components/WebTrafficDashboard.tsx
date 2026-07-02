import { useQuery } from '@tanstack/react-query';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  ShieldOff, Bot, RefreshCw,
  AlertCircle, Info,
} from 'lucide-react';
import { fetchWebAnalytics } from '@/api/client';
import type { WebAnalyticsData } from '@/types';
import { format, parseISO } from 'date-fns';
import DataFlowVisualization from './DataFlowVisualization';

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────
const PAGE_CLASSIFICATION: Record<string, { label: string; type: 'ok' | 'bot' | 'security' | 'neutral' }> = {
  '/':              { label: 'Real — homepage',       type: 'ok'       },
  '/index.html':    { label: 'Real — homepage alt',   type: 'ok'       },
  '/robots.txt':    { label: 'Bot — crawler check',   type: 'bot'      },
  '/.env':          { label: '🔴 Security scan',      type: 'security' },
  '/.git/config':   { label: '🔴 Security scan',      type: 'security' },
  '/.git/HEAD':     { label: '🔴 Security scan',      type: 'security' },
  '/wp-admin':      { label: '🔴 Security scan',      type: 'security' },
};

function classifyPage(page: string): { label: string; type: 'ok' | 'bot' | 'security' | 'neutral' } {
  if (PAGE_CLASSIFICATION[page]) return PAGE_CLASSIFICATION[page];
  if (page.startsWith('/lib/') || page.startsWith('/js/') || page.endsWith('.css') || page.endsWith('.js')) {
    return { label: 'Bot — asset scan', type: 'bot' };
  }
  if (page.startsWith('/.') || page.includes('..')) return { label: '🔴 Security scan', type: 'security' };
  return { label: 'Neutral', type: 'neutral' };
}

const TYPE_PILL: Record<string, string> = {
  ok:       'bg-emerald-900/30 text-emerald-400',
  bot:      'bg-slate-700/50 text-slate-400',
  security: 'bg-red-900/30 text-red-400',
  neutral:  'bg-slate-800 text-slate-500',
};

function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      className={`rounded-lg bg-slate-800 ${className}`}
      style={{ backgroundImage: 'linear-gradient(90deg,transparent 0%,rgba(255,255,255,0.04) 50%,transparent 100%)', backgroundSize: '200% 100%', animation: 'shimmer 2s linear infinite' }}
      aria-hidden="true"
    />
  );
}

const TOOLTIP_STYLE = {
  contentStyle: { backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', fontSize: '12px', color: '#e2e8f0' },
  labelStyle:   { color: '#94a3b8' },
};

// ────────────────────────────────────────────────────────────────────────────
// Security alert banner — always shown when security probes exist
// ────────────────────────────────────────────────────────────────────────────
function SecurityAlert({ data }: { data: WebAnalyticsData }) {
  const securityPages = data.top_pages.filter((p) => classifyPage(p.page).type === 'security');
  if (securityPages.length === 0) return null;

  return (
    <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-red-950/40 border border-red-800/50 mb-4">
      <ShieldOff size={18} className="text-red-400 shrink-0 mt-0.5" />
      <div className="flex-1">
        <p className="text-sm font-semibold text-red-300 mb-1">Active security probing on your website</p>
        <div className="space-y-0.5">
          {securityPages.map((p) => (
            <p key={p.page} className="text-xs text-red-400/80">
              <code className="font-mono bg-red-900/30 px-1 rounded">{p.page}</code>
              {' '}probed <strong>{p.visits}x</strong>{p.page === '/.env' ? ' — attackers scanning for exposed passwords & API keys' : p.page.includes('.git') ? ' — attackers attempting to download your source code' : ' — active scan'}
            </p>
          ))}
        </div>
        <p className="text-xs text-red-400/60 mt-2">Action required: block these paths in your web server config (nginx/Apache) or via Cloudflare WAF rules.</p>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Bot traffic alert
// ────────────────────────────────────────────────────────────────────────────
function BotAlert({ data }: { data: WebAnalyticsData }) {
  const real  = data.meta_insights.high_intent_visits;
  const total = data.summary.total_requests;
  const botPct = (((total - real) / total) * 100).toFixed(0);

  return (
    <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-amber-950/30 border border-amber-800/40 mb-4">
      <Bot size={18} className="text-amber-400 shrink-0 mt-0.5" />
      <div>
        <p className="text-sm font-semibold text-amber-300 mb-1">~{botPct}% of traffic is automated bots, not customers</p>
        <p className="text-xs text-amber-400/70">
          100% desktop, 0% mobile, zero bounce rate, and all activity concentrated at midnight UTC are hallmarks of automated scanners.
          Your real business audience is the <strong className="text-amber-300">{real} high-intent sessions</strong> who loaded the full site.
          Use this number — not {total.toLocaleString()} — for marketing decisions.
        </p>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// KPI cards row
// ────────────────────────────────────────────────────────────────────────────
function KPIs({ data }: { data: WebAnalyticsData }) {
  const real = data.meta_insights.high_intent_visits;
  const warm = data.meta_insights.warm_audience_size;

  const cards = [
    { label: 'Total requests', value: data.summary.total_requests.toLocaleString(), sub: 'incl. bots', color: '' },
    { label: 'Unique IPs',     value: data.summary.unique_ips.toLocaleString(),     sub: 'many = bot clusters', color: '' },
    { label: 'Real visitors',  value: real.toLocaleString(),                        sub: 'high-intent sessions', color: 'text-emerald-400' },
    { label: 'Warm audience',  value: warm.toLocaleString(),                        sub: 'retargetable on Meta', color: 'text-indigo-400' },
    { label: 'Avg daily',      value: data.summary.avg_daily.toLocaleString(),      sub: `top: ${data.summary.top_country}`, color: '' },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3 mb-4">
      {cards.map((c) => (
        <div key={c.label} className="bg-slate-800/60 rounded-lg p-3.5">
          <p className="text-2xs text-slate-500 uppercase tracking-wide mb-1">{c.label}</p>
          <p className={`text-xl font-bold ${c.color || 'text-slate-100'}`}>{c.value}</p>
          <p className="text-2xs text-slate-600 mt-0.5">{c.sub}</p>
        </div>
      ))}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Traffic trend chart
// ────────────────────────────────────────────────────────────────────────────
function TrafficChart({ data }: { data: WebAnalyticsData }) {
  const chartData = data.traffic_over_time.map((d) => ({
    date:     format(parseISO(d.date), 'MMM d'),
    requests: d.requests,
  }));

  return (
    <div className="glass-card p-5 mb-4">
      <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-3">Traffic over time</p>
      <ResponsiveContainer width="100%" height={180}>
        <AreaChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="trafficGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.25} />
              <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
          <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} width={40} />
          <Tooltip {...TOOLTIP_STYLE} formatter={(v: number) => [v.toLocaleString(), 'Requests']} />
          <Area type="monotone" dataKey="requests" stroke="#6366f1" strokeWidth={2} fill="url(#trafficGrad)" dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Geo + Pages grid
// ────────────────────────────────────────────────────────────────────────────
function GeoAndPages({ data }: { data: WebAnalyticsData }) {
  const geoData = data.geo_distribution.map((g) => ({ country: g.country.length > 16 ? g.country.slice(0, 15) + '…' : g.country, requests: g.requests, pct: g.pct }));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
      <div className="glass-card p-5">
        <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-3">Traffic by country</p>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={geoData} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
            <XAxis type="number" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="country" tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} width={100} />
            <Tooltip
  {...TOOLTIP_STYLE}
  formatter={(v: number, _: string, ctx: any) => [
    `${v.toLocaleString()} (${ctx?.payload?.pct ?? 0}%)`,
    'Requests'
  ]}
/>
            <Bar dataKey="requests" fill="#378add" radius={[0, 3, 3, 0]} maxBarSize={18} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="glass-card p-5">
        <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-3">Top pages — classified</p>
        <div className="space-y-2">
          {data.top_pages.slice(0, 7).map((p) => {
            const cls = classifyPage(p.page);
            return (
              <div key={p.page} className="flex items-center gap-2">
                <span className="font-mono text-xs text-slate-400 truncate flex-1 min-w-0">{p.page}</span>
                <span className="text-xs text-slate-300 tabular-nums shrink-0">{p.visits.toLocaleString()}</span>
                <span className={`text-2xs px-1.5 py-0.5 rounded font-medium shrink-0 ${TYPE_PILL[cls.type]}`}>
                  {cls.type === 'ok' ? 'Real' : cls.type === 'security' ? '⚠ Scan' : 'Bot'}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Main dashboard
// ────────────────────────────────────────────────────────────────────────────
export default function WebTrafficDashboard() {
  const period = 'weekly';

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['web-analytics', period],
    queryFn:  () => fetchWebAnalytics(period),
    staleTime: 30 * 60 * 1000,
    retry: 2,
  });

  return (
    <div className="max-w-7xl space-y-0">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div>
          <h2 className="text-xl font-bold text-slate-100">Website Traffic</h2>
          <p className="text-sm text-slate-400 mt-0.5">
            stellarglobalsupplies.com · {data ? `generated ${format(parseISO(data.generated_at), 'MMM d, yyyy HH:mm')} UTC` : 'refreshes daily'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-400 bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5">Last 7 days</span>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 border border-slate-700 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-20 rounded-xl" />
          <div className="grid grid-cols-5 gap-3"><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
          <Skeleton className="h-52 rounded-xl" />
        </div>
      )}

      {isError && (
        <div className="glass-card p-6 flex items-center gap-4">
          <AlertCircle size={24} className="text-red-400 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-slate-200">Could not load web analytics</p>
            <p className="text-xs text-slate-500 mt-0.5">{(error as Error)?.message}</p>
            <p className="text-xs text-slate-600 mt-1">Ensure the S3 bucket stellar-analytics-reports-471112840461 is accessible from the Lambda IAM role.</p>
          </div>
          <button onClick={() => refetch()} className="ml-auto px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg">Retry</button>
        </div>
      )}

      {data && (
        <>
          <DataFlowVisualization
            title="Web Traffic Data Flow"
            subtitle="CloudFront → S3 → Analytics → Dashboard"
            nodes={[
              { id: 'cloudfront', label: 'CloudFront', icon: 'source', status: 'active', description: 'CDN Logs' },
              { id: 's3', label: 'S3 Bucket', icon: 'storage', status: 'active', description: 'Log Storage' },
              { id: 'processor', label: 'Processor', icon: 'process', status: 'active', description: 'ETL' },
              { id: 'analytics', label: 'Analytics', icon: 'process', status: 'active', description: 'Insights' },
              { id: 'dashboard', label: 'Dashboard', icon: 'output', status: 'active', description: 'Real-time' },
            ]}
            edges={[
              { from: 'cloudfront', to: 's3', label: 'Logs', active: true, speed: 'fast' },
              { from: 's3', to: 'processor', label: 'Process', active: true, speed: 'medium' },
              { from: 'processor', to: 'analytics', label: 'Analyze', active: true, speed: 'medium' },
              { from: 'analytics', to: 'dashboard', label: 'Display', active: true, speed: 'fast' },
            ]}
            refreshInterval={2500}
          />

          <SecurityAlert data={data} />
          <BotAlert data={data} />
          <KPIs data={data} />
          <TrafficChart data={data} />
          <GeoAndPages data={data} />

          <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-indigo-950/30 border border-indigo-800/30">
            <Info size={15} className="text-indigo-400 shrink-0 mt-0.5" />
            <p className="text-xs text-indigo-300/70">
              Ask the Marketing Manager agent to turn this traffic data into a campaign strategy, or ask the Cloud Engineer to set up bot filtering and server-side security rules.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
