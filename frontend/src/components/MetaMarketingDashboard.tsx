import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';
import {
  RefreshCw, AlertCircle, Info, Clock, MapPin,
  Users, Target, Megaphone, Send,
} from 'lucide-react';
import { fetchMetaAnalytics } from '@/api/client';
import type { MetaAnalyticsData, AnalyticsPeriod } from '@/types';
import { format, parseISO } from 'date-fns';
import { useNavStore } from '@/store';

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────
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

const GEO_COLORS = ['#6366f1', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444'];

// ────────────────────────────────────────────────────────────────────────────
// Period toggle
// ────────────────────────────────────────────────────────────────────────────
function PeriodToggle({ value, onChange }: { value: AnalyticsPeriod; onChange: (p: AnalyticsPeriod) => void }) {
  return (
    <div className="flex items-center bg-slate-800 border border-slate-700 rounded-lg p-1 gap-1">
      {(['weekly', 'monthly'] as AnalyticsPeriod[]).map((p) => (
        <button
          key={p}
          onClick={() => onChange(p)}
          className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${value === p ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
        >
          {p === 'weekly' ? 'Last 7 days' : 'Last 30 days'}
        </button>
      ))}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Meta integration notice
// ────────────────────────────────────────────────────────────────────────────
function IntegrationNotice() {
  return (
    <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-indigo-950/30 border border-indigo-800/30 mb-4">
      <Info size={16} className="text-indigo-400 shrink-0 mt-0.5" />
      <div>
        <p className="text-sm font-semibold text-indigo-300 mb-1">Meta ads pipeline uses website audience data</p>
        <p className="text-xs text-indigo-300/70">
          The current pipeline derives targeting recommendations from website visitor behaviour. Once Facebook Ads Manager and Instagram Insights are connected, this dashboard will also show paid reach, impressions, CPM, CTR, and organic post engagement separately from the website data.
        </p>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// KPI cards
// ────────────────────────────────────────────────────────────────────────────
function KPIs({ data }: { data: MetaAnalyticsData }) {
  const cards = [
    {
      label: 'Warm audience',
      value: data.meta_insights.warm_audience_size.toLocaleString(),
      sub:   'retargetable visitors',
      icon:  <Users size={16} />,
      color: '#6366f1',
    },
    {
      label: 'High-intent sessions',
      value: data.meta_insights.high_intent_visits.toLocaleString(),
      sub:   'full site load',
      icon:  <Target size={16} />,
      color: '#10b981',
    },
    {
      label: 'Recommended objective',
      value: data.meta_insights.recommended_objective,
      sub:   'for Meta campaigns',
      icon:  <Megaphone size={16} />,
      color: '#8b5cf6',
    },
    {
      label: 'Best ad time',
      value: data.meta_insights.best_ad_time,
      sub:   '05:30–08:30 IST',
      icon:  <Clock size={16} />,
      color: '#f59e0b',
    },
    {
      label: 'Best placement',
      value: data.meta_insights.best_placement,
      sub:   'Meta platform',
      icon:  <Send size={16} />,
      color: '#06b6d4',
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3 mb-4">
      {cards.map((c) => (
        <div key={c.label} className="bg-slate-800/60 rounded-lg p-3.5">
          <div className="flex items-center gap-2 mb-2">
            <span style={{ color: c.color }}>{c.icon}</span>
            <p className="text-2xs text-slate-500 uppercase tracking-wide">{c.label}</p>
          </div>
          <p className="text-sm font-bold text-slate-100 leading-tight">{c.value}</p>
          <p className="text-2xs text-slate-600 mt-0.5">{c.sub}</p>
        </div>
      ))}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Audience geography chart
// ────────────────────────────────────────────────────────────────────────────
function AudienceGeo({ data }: { data: MetaAnalyticsData }) {
  const geoData = data.geo_distribution.slice(0, 6);

  return (
    <div className="glass-card p-5 mb-4">
      <div className="flex items-center gap-2 mb-3">
        <MapPin size={14} className="text-indigo-400" />
        <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">Audience geography — target these locations on Meta</p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-center">
        <div style={{ height: 200 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={geoData}
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={80}
                dataKey="requests"
                paddingAngle={3}
                strokeWidth={2}
                stroke="#0f172a"
              >
                {geoData.map((_, i) => (
                  <Cell key={i} fill={GEO_COLORS[i % GEO_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
  {...TOOLTIP_STYLE}
  formatter={(v: number, _: string, ctx: any) => [
    `${v.toLocaleString()} (${ctx?.payload?.pct ?? 0}%)`,
    'Requests'
  ]}
/>
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="space-y-2">
          {geoData.map((g, i) => (
            <div key={g.country}>
              <div className="flex items-center justify-between text-xs mb-1">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: GEO_COLORS[i % GEO_COLORS.length] }} />
                  <span className="text-slate-300">{g.country}</span>
                </div>
                <span className="text-slate-400 tabular-nums">{g.pct}%</span>
              </div>
              <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${g.pct}%`, backgroundColor: GEO_COLORS[i % GEO_COLORS.length] }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Audience trend
// ────────────────────────────────────────────────────────────────────────────
function AudienceTrend({ data }: { data: MetaAnalyticsData }) {
  const chartData = data.traffic_over_time.map((d) => ({
    date:     format(parseISO(d.date), 'MMM d'),
    audience: d.requests,
  }));

  return (
    <div className="glass-card p-5 mb-4">
      <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-3">Audience reach trend</p>
      <ResponsiveContainer width="100%" height={160}>
        <AreaChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="metaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#8b5cf6" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
          <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} width={42} />
          <Tooltip {...TOOLTIP_STYLE} formatter={(v: number) => [v.toLocaleString(), 'Audience reach']} />
          <Area type="monotone" dataKey="audience" stroke="#8b5cf6" strokeWidth={2} fill="url(#metaGrad)" dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Campaign recommendations
// ────────────────────────────────────────────────────────────────────────────
function CampaignRecommendations({ data, period }: { data: MetaAnalyticsData; period: AnalyticsPeriod }) {
  const setSection = useNavStore((s) => s.setSection);
  const topLocations = data.meta_insights.top_locations;
  const warm = data.meta_insights.warm_audience_size;
  const hint = data.meta_insights.high_intent_visits;

  const campaigns = [
    {
      title: 'B2B retargeting — warm audience',
      desc:  `${warm.toLocaleString()} visitors already browsed your site. Run a retargeting campaign on Meta targeting this custom audience with SS/MS product showcases.`,
      cta:   `Draft retargeting campaign for ${warm.toLocaleString()} warm audience visitors`,
      color: '#6366f1',
    },
    {
      title: `${topLocations[0]} — top traffic source`,
      desc:  `${topLocations[0]} drives the most sessions (${period === 'weekly' ? '42%' : '34%'}). Run a B2B awareness campaign targeting manufacturing/industrial buyers in this market.`,
      cta:   `Create a Meta ad campaign for the ${topLocations[0]} B2B steel market`,
      color: '#8b5cf6',
    },
    {
      title: 'India local campaign — Pune/Maharashtra',
      desc:  'India represents 5% of monthly traffic — your home market. A Hindi+English campaign targeting Pune MIDC industrial zone can drive high-quality local leads.',
      cta:   'Draft a Pune and Maharashtra B2B Meta campaign for Stellar Global Supplies in Hindi and English',
      color: '#10b981',
    },
    {
      title: 'High-intent conversion campaign',
      desc:  `${hint} visitors loaded the full site — they are your hottest prospects. Create a conversion campaign targeting lookalike audiences based on these ${hint} users.`,
      cta:   `Design a Meta conversion campaign based on ${hint} high-intent visitors to stellarglobalsupplies.com`,
      color: '#06b6d4',
    },
  ];

  return (
    <div className="glass-card p-5 mb-4">
      <div className="flex items-center gap-2 mb-4">
        <Megaphone size={14} className="text-purple-400" />
        <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">Campaign recommendations — click to brief Marketing Manager agent</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {campaigns.map((c) => (
          <div
            key={c.title}
            className="p-4 rounded-xl border border-slate-700 bg-slate-800/40 hover:bg-slate-800/70 transition-all"
          >
            <div className="flex items-start gap-2 mb-2">
              <span className="w-2 h-2 rounded-full shrink-0 mt-1.5" style={{ backgroundColor: c.color }} />
              <p className="text-xs font-semibold text-slate-200">{c.title}</p>
            </div>
            <p className="text-xs text-slate-400 mb-3 leading-relaxed">{c.desc}</p>
            <button
              onClick={() => {
                setSection('agents');
                setTimeout(() => {
                  const event = new CustomEvent('prefill-agent', { detail: { agentId: 'marketing-manager', message: c.cta } });
                  window.dispatchEvent(event);
                }, 100);
              }}
              className="text-xs px-3 py-1.5 rounded-lg border border-slate-600 hover:border-slate-400 text-slate-300 transition-colors"
              style={{ borderColor: `${c.color}40`, color: c.color }}
            >
              Brief Marketing Manager ↗
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Meta Marketing Dashboard main
// ────────────────────────────────────────────────────────────────────────────
export default function MetaMarketingDashboard() {
  const [period, setPeriod] = useState<AnalyticsPeriod>('weekly');

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['meta-analytics', period],
    queryFn:  () => fetchMetaAnalytics(period),
    staleTime: 30 * 60 * 1000,
    retry: 2,
  });

  return (
    <div className="max-w-7xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div>
          <h2 className="text-xl font-bold text-slate-100">Meta Marketing Intelligence</h2>
          <p className="text-sm text-slate-400 mt-0.5">
            Facebook · Instagram · {data ? `generated ${format(parseISO(data.generated_at), 'MMM d, yyyy')}` : 'refreshes daily from analytics pipeline'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PeriodToggle value={period} onChange={setPeriod} />
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 border border-slate-700 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <IntegrationNotice />

      {isLoading && (
        <div className="space-y-3">
          <div className="grid grid-cols-5 gap-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
          <Skeleton className="h-52 rounded-xl" />
          <Skeleton className="h-52 rounded-xl" />
        </div>
      )}

      {isError && (
        <div className="glass-card p-6 flex items-center gap-4">
          <AlertCircle size={24} className="text-red-400 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-slate-200">Could not load Meta analytics</p>
            <p className="text-xs text-slate-500 mt-0.5">{(error as Error)?.message}</p>
          </div>
          <button onClick={() => refetch()} className="ml-auto px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg">Retry</button>
        </div>
      )}

      {data && (
        <>
          <KPIs data={data} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            <AudienceTrend data={data} />
            <div className="glass-card p-5">
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-3">Ad scheduling — best times (UTC)</p>
              <div className="space-y-2">
                {[
                  { label: 'Primary window',   time: '00:00 – 03:00 UTC',  ist: '05:30 – 08:30 IST', score: 100 },
                  { label: 'Secondary window', time: '04:00 – 07:00 UTC',  ist: '09:30 – 12:30 IST', score: 60  },
                  { label: 'Tertiary window',  time: '10:00 – 13:00 UTC',  ist: '15:30 – 18:30 IST', score: 35  },
                ].map((t) => (
                  <div key={t.label} className="p-3 rounded-lg bg-slate-800/40 border border-slate-700">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-medium text-slate-300">{t.label}</span>
                      <span className="text-2xs text-slate-500">{t.ist}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                        <div className="h-full bg-purple-500 rounded-full" style={{ width: `${t.score}%` }} />
                      </div>
                      <span className="text-2xs text-slate-500 tabular-nums w-6 text-right">{t.score}%</span>
                    </div>
                    <p className="text-2xs text-slate-600 mt-1">{t.time}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <AudienceGeo data={data} />
          <CampaignRecommendations data={data} period={period} />
        </>
      )}
    </div>
  );
}
