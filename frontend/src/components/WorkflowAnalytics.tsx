import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import {
  RefreshCw,
  AlertCircle,
  Users,
  TrendingUp,
  FileText,
  CheckSquare,
  Clock,
  Activity,
  Zap,
  AlertTriangle,
} from 'lucide-react';
import { fetchWorkflowAnalytics } from '@/services/workflow-analytics';
import type { WorkflowAnalyticsData } from '@/types';

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

const COLOURS = {
  navy:      '#0A2547',
  royal:     '#1565C0',
  amber:     '#F59E0B',
  emerald:   '#10B981',
  red:       '#EF4444',
  slate:     '#94A3B8',
  linkedin:  '#0A66C2',
  facebook:  '#1877F2',
  instagram: '#E1306C',
};

const STATUS_COLOURS: Record<string, string> = {
  pending_approval: '#F59E0B',
  approved_manual:  '#10B981',
  published:        '#0A2547',
  rejected:         '#EF4444',
  publish_failed:   '#EF4444',
  publishing:       '#1565C0',
  pending:          '#F59E0B',
  approved:         '#10B981',
  expired:          '#94A3B8',
  running:          '#1565C0',
  succeeded:        '#10B981',
  failed:           '#EF4444',
  draft:            '#94A3B8',
};

const RANGES = [
  { label: '7d',  value: 7   },
  { label: '30d', value: 30  },
  { label: '90d', value: 90  },
  { label: 'All', value: 0   },
];

const CHART_TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: '#1e293b',
    border:          '1px solid #334155',
    borderRadius:    '8px',
    fontSize:        '12px',
    color:           '#e2e8f0',
  },
  labelStyle: { color: '#94a3b8' },
};

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      className={`rounded-lg bg-slate-800 ${className}`}
      style={{
        backgroundImage: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.04) 50%, transparent 100%)',
        backgroundSize: '200% 100%',
        animation: 'shimmer 2s linear infinite',
      }}
      aria-hidden="true"
    />
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4">
      <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
      {subtitle && <p className="text-2xs text-slate-500 mt-0.5">{subtitle}</p>}
    </div>
  );
}

function EmptyState({ message = 'No data available' }: { message?: string }) {
  return (
    <div className="h-48 flex items-center justify-center text-slate-600 text-xs">
      {message}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// KPI Card
// ────────────────────────────────────────────────────────────────────────────

function KPICard({
  label,
  value,
  subtext,
  icon,
  color,
  warning,
  alert,
}: {
  label: string;
  value: string;
  subtext?: string;
  icon: React.ReactNode;
  color: string;
  warning?: boolean;
  alert?: boolean;
}) {
  return (
    <div className="glass-card p-4 flex items-center gap-3">
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
        style={{
          backgroundColor: warning ? 'rgba(239,68,68,0.15)' : alert ? 'rgba(245,158,11,0.15)' : `${color}20`,
          color: warning ? '#EF4444' : alert ? '#F59E0B' : color,
        }}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-2xs text-slate-500 uppercase tracking-wider">{label}</p>
        <p
          className={`text-lg font-bold tabular-nums ${
            warning ? 'text-red-400' : alert ? 'text-amber-400' : 'text-slate-100'
          }`}
        >
          {value}
        </p>
        {subtext && <p className="text-2xs text-slate-500 mt-0.5">{subtext}</p>}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Lead Funnel
// ────────────────────────────────────────────────────────────────────────────

function LeadFunnel({ data }: { data: WorkflowAnalyticsData['leads'] }) {
  const stages = ['pending', 'emailed', 'followed_up', 'converted'];
  const colours = ['#94A3B8', '#1565C0', '#F59E0B', '#10B981'];
  const maxVal = Math.max(...stages.map(s => data.by_status[s] || 0), 1);

  return (
    <div className="glass-card p-5">
      <SectionHeader title="Lead Funnel" subtitle="Pending → Emailed → Followed Up → Converted" />
      <div className="space-y-3">
        {stages.map((stage, i) => {
          const count = data.by_status[stage] || 0;
          const pct = (count / maxVal) * 100;
          return (
            <div key={stage}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-slate-300 capitalize">
                  {stage.replace(/_/g, ' ')}
                </span>
                <span className="text-xs font-bold text-slate-100 tabular-nums">{count}</span>
              </div>
              <div className="h-3 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${pct}%`, backgroundColor: colours[i] }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-4 pt-3 border-t border-slate-800 flex justify-between text-2xs text-slate-500">
        <span>Conversion rate</span>
        <span className="font-bold text-emerald-400">{data.conversion_rate.toFixed(1)}%</span>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Leads Over Time
// ────────────────────────────────────────────────────────────────────────────

function LeadsOverTime({ data }: { data: WorkflowAnalyticsData['leads'] }) {
  const chartData = data.daily_30.map(d => ({
    date: d.date.slice(5),
    leads: d.count,
  }));

  return (
    <div className="glass-card p-5">
      <SectionHeader title="Leads Over Time" subtitle="Daily count — last 30 days" />
      {chartData.every(d => d.leads === 0) ? (
        <EmptyState />
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} interval={4} />
            <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} width={30} />
            <Tooltip {...CHART_TOOLTIP_STYLE} />
            <Line type="monotone" dataKey="leads" stroke={COLOURS.royal} strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Social Post Status Donut
// ────────────────────────────────────────────────────────────────────────────

function PostStatusDonut({ data }: { data: WorkflowAnalyticsData['social_posts'] }) {
  const entries = Object.entries(data.by_status).map(([status, count]) => ({
    name: status.replace(/_/g, ' '),
    value: count,
    color: STATUS_COLOURS[status] || COLOURS.slate,
  }));

  const total = entries.reduce((s, e) => s + e.value, 0);
  if (total === 0) return null;

  return (
    <div className="glass-card p-5">
      <SectionHeader title="Post Status" subtitle="Breakdown by status" />
      <div className="flex items-center gap-4">
        <div className="w-28 h-28 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={entries}
                cx="50%" cy="50%"
                innerRadius={32}
                outerRadius={50}
                strokeWidth={2}
                stroke="#0f172a"
                dataKey="value"
                paddingAngle={2}
              >
                {entries.map((e, i) => <Cell key={i} fill={e.color} />)}
              </Pie>
              <Tooltip {...CHART_TOOLTIP_STYLE} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="flex-1 space-y-1.5">
          {entries.map(e => (
            <div key={e.name} className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: e.color }} />
                <span className="text-slate-400 capitalize">{e.name}</span>
              </div>
              <span className="font-medium text-slate-200 tabular-nums">{e.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Platform Distribution Bar
// ────────────────────────────────────────────────────────────────────────────

function PlatformDistribution({ data }: { data: WorkflowAnalyticsData['social_posts'] }) {
  const chartData = [
    { platform: 'LinkedIn',  count: data.platform_counts.linkedin  || 0, color: COLOURS.linkedin },
    { platform: 'Facebook',  count: data.platform_counts.facebook  || 0, color: COLOURS.facebook },
    { platform: 'Instagram', count: data.platform_counts.instagram || 0, color: COLOURS.instagram },
  ];

  return (
    <div className="glass-card p-5">
      <SectionHeader title="Platform Distribution" subtitle="Posts by platform" />
      {chartData.every(d => d.count === 0) ? (
        <EmptyState />
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="platform" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} width={30} />
            <Tooltip {...CHART_TOOLTIP_STYLE} />
            <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={48}>
              {chartData.map((d, i) => <Cell key={i} fill={d.color} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Posts Per Week Bar
// ────────────────────────────────────────────────────────────────────────────

function PostsPerWeek({ data }: { data: WorkflowAnalyticsData['social_posts'] }) {
  const chartData = data.weekly_8.map(w => ({
    week: w.week.slice(5),
    count: w.count,
  }));

  return (
    <div className="glass-card p-5">
      <SectionHeader title="Posts Per Week" subtitle="Last 8 weeks" />
      {chartData.every(d => d.count === 0) ? (
        <EmptyState />
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="week" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} width={25} />
            <Tooltip {...CHART_TOOLTIP_STYLE} />
            <Bar dataKey="count" fill={COLOURS.royal} radius={[4, 4, 0, 0]} maxBarSize={32} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Blog Status Donut
// ────────────────────────────────────────────────────────────────────────────

function BlogStatusDonut({ data }: { data: WorkflowAnalyticsData['blog_posts'] }) {
  const entries = Object.entries(data.by_status).map(([status, count]) => ({
    name: status.replace(/_/g, ' '),
    value: count,
    color: STATUS_COLOURS[status] || COLOURS.slate,
  }));

  const total = entries.reduce((s, e) => s + e.value, 0);
  if (total === 0) return null;

  return (
    <div className="glass-card p-5">
      <SectionHeader title="Blog Status" subtitle="Breakdown by status" />
      <div className="flex items-center gap-4">
        <div className="w-24 h-24 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={entries}
                cx="50%" cy="50%"
                innerRadius={28}
                outerRadius={44}
                strokeWidth={2}
                stroke="#0f172a"
                dataKey="value"
                paddingAngle={2}
              >
                {entries.map((e, i) => <Cell key={i} fill={e.color} />)}
              </Pie>
              <Tooltip {...CHART_TOOLTIP_STYLE} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="flex-1 space-y-1">
          {entries.map(e => (
            <div key={e.name} className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: e.color }} />
                <span className="text-slate-400 capitalize">{e.name}</span>
              </div>
              <span className="font-medium text-slate-200 tabular-nums">{e.value}</span>
            </div>
          ))}
          <div className="pt-2 border-t border-slate-800 flex justify-between text-2xs text-slate-500">
            <span>Published rate</span>
            <span className="font-bold text-emerald-400">{data.published_rate.toFixed(1)}%</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Top Tags Bar
// ────────────────────────────────────────────────────────────────────────────

function TopTagsBar({ data }: { data: WorkflowAnalyticsData['blog_posts'] }) {
  const chartData = data.top_tags.map(t => ({
    tag: t.tag.length > 16 ? t.tag.slice(0, 15) + '…' : t.tag,
    count: t.count,
  }));

  return (
    <div className="glass-card p-5">
      <SectionHeader title="Top Tags" subtitle="Most used blog tags" />
      {chartData.length === 0 ? (
        <EmptyState />
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
            <XAxis type="number" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis
              type="category"
              dataKey="tag"
              tick={{ fill: '#94a3b8', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              width={90}
            />
            <Tooltip {...CHART_TOOLTIP_STYLE} />
            <Bar dataKey="count" fill={COLOURS.royal} radius={[0, 4, 4, 0]} maxBarSize={16} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Approval Queue Health
// ────────────────────────────────────────────────────────────────────────────

function ApprovalHealth({ data }: { data: WorkflowAnalyticsData['approvals'] }) {
  const chartData = Object.entries(data.by_workflow_type).map(([type, count]) => ({
    name: type.replace(/_/g, ' '),
    value: count,
    color: STATUS_COLOURS[type] || COLOURS.royal,
  }));

  return (
    <div className="glass-card p-5">
      <SectionHeader title="Approval Queue Health" subtitle="Pending, rate, and review time" />
      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="text-center">
          <p className={`text-2xl font-bold tabular-nums ${data.pending > 0 ? 'text-amber-400' : 'text-slate-100'}`}>
            {data.pending}
          </p>
          <p className="text-2xs text-slate-500 mt-1">Pending</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold tabular-nums text-emerald-400">
            {data.approval_rate.toFixed(1)}%
          </p>
          <p className="text-2xs text-slate-500 mt-1">Approval Rate</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold tabular-nums text-slate-100">
            {data.avg_review_hours.toFixed(1)}h
          </p>
          <p className="text-2xs text-slate-500 mt-1">Avg Review</p>
        </div>
      </div>
      {data.expired > 0 && (
        <div className="flex items-center gap-2 p-2 rounded-lg mb-3" style={{ background: 'rgba(239,68,68,0.1)' }}>
          <AlertTriangle size={14} className="text-red-400 shrink-0" />
          <span className="text-2xs text-red-400">{data.expired} expired approvals</span>
        </div>
      )}
      {chartData.length > 0 && (
        <div className="pt-3 border-t border-slate-800">
          <p className="text-2xs text-slate-500 mb-2">By Workflow Type</p>
          <div className="flex items-center gap-3">
            <div className="w-20 h-20 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={chartData}
                    cx="50%" cy="50%"
                    innerRadius={22}
                    outerRadius={36}
                    strokeWidth={2}
                    stroke="#0f172a"
                    dataKey="value"
                    paddingAngle={2}
                  >
                    {chartData.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex-1 space-y-1">
              {chartData.map(d => (
                <div key={d.name} className="flex items-center justify-between text-2xs">
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: d.color }} />
                    <span className="text-slate-400 capitalize">{d.name}</span>
                  </div>
                  <span className="text-slate-200 tabular-nums">{d.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Success Rate by Type (Grouped Bar)
// ────────────────────────────────────────────────────────────────────────────

function SuccessRateByType({ data }: { data: WorkflowAnalyticsData['workflow_runs'] }) {
  const chartData = data.success_rate_by_type.map(s => ({
    type: s.workflow_type.replace(/_/g, ' '),
    succeeded: s.succeeded,
    failed: s.total - s.succeeded,
    rate: s.rate,
  }));

  return (
    <div className="glass-card p-5">
      <SectionHeader title="Success Rate by Workflow Type" subtitle="Succeeded vs failed" />
      {chartData.length === 0 ? (
        <EmptyState />
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="type" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} width={30} />
            <Tooltip {...CHART_TOOLTIP_STYLE} />
            <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
            <Bar dataKey="succeeded" name="Succeeded" fill={COLOURS.emerald} radius={[4, 4, 0, 0]} maxBarSize={24} />
            <Bar dataKey="failed" name="Failed" fill={COLOURS.red} radius={[4, 4, 0, 0]} maxBarSize={24} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Run Volume Over Time
// ────────────────────────────────────────────────────────────────────────────

function RunVolumeOverTime({ data }: { data: WorkflowAnalyticsData['workflow_runs'] }) {
  const chartData = data.daily_30.map(d => ({
    date: d.date.slice(5),
    succeeded: d.succeeded,
    failed: d.failed,
  }));

  return (
    <div className="glass-card p-5">
      <SectionHeader title="Run Volume Over Time" subtitle="Last 30 days" />
      {chartData.every(d => d.succeeded === 0 && d.failed === 0) ? (
        <EmptyState />
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} interval={4} />
            <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} width={25} />
            <Tooltip {...CHART_TOOLTIP_STYLE} />
            <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
            <Line type="monotone" dataKey="succeeded" name="Succeeded" stroke={COLOURS.emerald} strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="failed" name="Failed" stroke={COLOURS.red} strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Schedules Table
// ────────────────────────────────────────────────────────────────────────────

function SchedulesTable({ data }: { data: WorkflowAnalyticsData['schedules'] }) {
  const freqColours: Record<string, string> = {
    daily: '#1565C0',
    weekly: '#10B981',
    monthly: '#F59E0B',
  };

  return (
    <div className="glass-card p-5">
      <div className="flex items-center justify-between mb-4">
        <SectionHeader title="Workflow Schedules" subtitle={`${data.active} active, ${data.paused} paused`} />
        <div className="flex items-center gap-3 text-2xs text-slate-500">
          <span>Active: <span className="text-emerald-400 font-bold">{data.active}</span></span>
          <span>Paused: <span className="text-slate-400 font-bold">{data.paused}</span></span>
        </div>
      </div>

      {data.list.length === 0 ? (
        <EmptyState message="No schedules configured" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-700">
                <th className="text-left text-2xs text-slate-500 uppercase tracking-wide pb-2 pr-3">Label</th>
                <th className="text-left text-2xs text-slate-500 uppercase tracking-wide pb-2 pr-3">Type</th>
                <th className="text-left text-2xs text-slate-500 uppercase tracking-wide pb-2 pr-3">Frequency</th>
                <th className="text-left text-2xs text-slate-500 uppercase tracking-wide pb-2 pr-3">Run Time</th>
                <th className="text-right text-2xs text-slate-500 uppercase tracking-wide pb-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {data.list.map(s => (
                <tr key={s.id} className="hover:bg-slate-800/30 transition-colors">
                  <td className="py-2.5 pr-3">
                    <span className="text-slate-200 font-medium">{s.label}</span>
                  </td>
                  <td className="py-2.5 pr-3 text-slate-400 capitalize">
                    {s.workflow_type.replace(/-/g, ' ')}
                  </td>
                  <td className="py-2.5 pr-3">
                    <span
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-2xs font-medium"
                      style={{
                        backgroundColor: `${freqColours[s.frequency] || '#64748b'}20`,
                        color: freqColours[s.frequency] || '#64748b',
                      }}
                    >
                      {s.frequency}
                    </span>
                  </td>
                  <td className="py-2.5 pr-3 text-slate-400 font-mono">{s.run_time}</td>
                  <td className="py-2.5 text-right">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-2xs font-medium ${
                        s.enabled
                          ? 'text-emerald-400'
                          : 'text-slate-500'
                      }`}
                      style={{
                        backgroundColor: s.enabled ? 'rgba(16,185,129,0.12)' : 'rgba(100,116,139,0.12)',
                      }}
                    >
                      {s.enabled ? 'Active' : 'Paused'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Blog Monthly Timeline
// ────────────────────────────────────────────────────────────────────────────

function BlogMonthlyTimeline({ data }: { data: WorkflowAnalyticsData['blog_posts'] }) {
  const chartData = data.monthly_6.map(m => ({
    month: m.month.slice(5) + '/' + m.month.slice(2, 4),
    count: m.count,
  }));

  return (
    <div className="glass-card p-5">
      <SectionHeader title="Blogs Per Month" subtitle="Last 6 months" />
      {chartData.every(d => d.count === 0) ? (
        <EmptyState />
      ) : (
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} width={25} />
            <Tooltip {...CHART_TOOLTIP_STYLE} />
            <Bar dataKey="count" fill={COLOURS.royal} radius={[4, 4, 0, 0]} maxBarSize={32} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// AI Cost Breakdown
// ────────────────────────────────────────────────────────────────────────────

const WF_LABELS: Record<string, string> = {
  lead_generation:      'Lead Generation',
  lead_email_existing:  'Lead Re-email',
  social_product:       'Product Post',
  social_tech:          'Tech Post',
  blog:                 'Blog Post',
};

function AICostPanel({ data }: { data: WorkflowAnalyticsData['cost'] }) {
  const totalCost = data.total_usd || 0;
  const costByType = data.by_type || {};
  const entries = Object.entries(costByType)
    .sort(([, a], [, b]) => b - a);

  return (
    <div className="glass-card p-5">
      <SectionHeader
        title="AI Costs"
        subtitle="Nova Pro · all time"
      />
      {totalCost > 0 ? (
        <>
          <div className="text-3xl font-bold text-emerald-400 mb-4 tabular-nums">
            ${totalCost.toFixed(4)}
          </div>
          <div className="space-y-2.5">
            {entries.map(([type, cost]) => {
              const pct = (cost / totalCost) * 100;
              return (
                <div key={type}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-slate-400">{WF_LABELS[type] || type}</span>
                    <span className="text-xs font-medium text-slate-200 tabular-nums">${cost.toFixed(4)}</span>
                  </div>
                  <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${pct}%`, backgroundColor: COLOURS.royal }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-2xs text-slate-500 mt-4">FLUX images via Gradio = free</p>
        </>
      ) : (
        <div className="text-sm text-slate-500 text-center py-6">
          No cost data yet — run a workflow first
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Recent Workflow Runs List
// ────────────────────────────────────────────────────────────────────────────

const RUN_STATUS_COLOR: Record<string, string> = {
  succeeded: '#22c55e',
  running:   '#3b82f6',
  failed:    '#ef4444',
  stopped:   '#94a3b8',
  timed_out: '#f59e0b',
};

function RecentWorkflowRuns({ data }: { data: WorkflowAnalyticsData['workflow_runs']['recent'] }) {
  if (!data || data.length === 0) return null;

  return (
    <div className="glass-card p-5">
      <SectionHeader title="Recent Workflow Runs" />
      <div className="space-y-0 divide-y divide-slate-800/60">
        {data.map((run) => {
          const dotColor = RUN_STATUS_COLOR[run.status] || '#94a3b8';
          const duration = run.completed_at
            ? `${Math.round((new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()) / 1000)}s`
            : 'running…';
          const cost = parseFloat(run.cost_usd || '0');

          return (
            <div key={run.id} className="flex items-center gap-3 py-3">
              <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: dotColor }} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-slate-200">
                  {WF_LABELS[run.workflow_type] || run.workflow_type}
                </p>
                <p className="text-2xs text-slate-500 mt-0.5">
                  {new Date(run.started_at).toLocaleString('en-IN')} · {duration}
                  {cost > 0 && ` · $${cost.toFixed(4)}`}
                </p>
              </div>
              <span
                className="text-2xs font-medium px-2 py-0.5 rounded-full capitalize"
                style={{
                  backgroundColor:
                    run.status === 'succeeded' ? 'rgba(34,197,94,0.12)' :
                    run.status === 'failed' ? 'rgba(239,68,68,0.12)' :
                    'rgba(100,116,139,0.12)',
                  color:
                    run.status === 'succeeded' ? '#22c55e' :
                    run.status === 'failed' ? '#ef4444' :
                    '#94a3b8',
                  border: `1px solid ${
                    run.status === 'succeeded' ? 'rgba(34,197,94,0.25)' :
                    run.status === 'failed' ? 'rgba(239,68,68,0.25)' :
                    'rgba(100,116,139,0.25)'
                  }`,
                }}
              >
                {run.status}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Main Component
// ────────────────────────────────────────────────────────────────────────────

export default function WorkflowAnalytics() {
  const [range, setRange] = useState(30);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['workflow-analytics', range],
    queryFn: () => fetchWorkflowAnalytics(range),
    staleTime: 5 * 60 * 1000,
  });

  const wf: WorkflowAnalyticsData = data ?? {
    leads: {
      total: 0, recent30: 0, by_status: {}, conversion_rate: 0,
      by_industry: [], daily_30: [], emails_sent: 0, follow_ups: 0, initial_emails: 0,
    },
    social_posts: {
      total: 0, by_status: {}, by_type: {}, platform_counts: {},
      published_week: 0, in_pipeline: 0, ready_to_publish: 0, weekly_8: [],
    },
    blog_posts: {
      total: 0, by_status: {}, published_rate: 0, top_tags: [], monthly_6: [],
    },
    approvals: {
      pending: 0, approval_rate: 0, avg_review_hours: 0, expired: 0,
      by_workflow_type: {}, daily_30: [],
    },
    cost: {
      total_usd: 0, by_type: {},
    },
    workflow_runs: {
      total: 0, succeeded: 0, failed: 0, running: 0,
      success_rate_by_type: [], avg_duration_min: 0,
      active_runs: [], recent_failed: [], daily_30: [], recent: [],
    },
    schedules: {
      total: 0, active: 0, paused: 0, by_frequency: {}, by_type: {}, list: [],
    },
  };

  return (
    <div className="max-w-7xl space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-slate-100">Workflow Analytics</h2>
          <p className="text-xs sm:text-sm text-slate-400 mt-0.5">
            Leads, social posts, blogs, approvals, runs & schedules
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center bg-slate-800 border border-slate-700 rounded-lg p-1 gap-1">
            {RANGES.map(r => (
              <button
                key={r.value}
                onClick={() => setRange(r.value)}
                className={`
                  px-3 py-1 rounded-md text-xs font-medium transition-all duration-150 touch-manipulation
                  ${range === r.value
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                  }
                `}
              >
                {r.label}
              </button>
            ))}
          </div>

          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="touch-target flex items-center justify-center gap-2 px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {/* Error state */}
      {isError && (
        <div className="glass-card p-6 flex items-center gap-4">
          <AlertCircle size={24} className="text-red-400 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-slate-200">Failed to load workflow analytics</p>
            <p className="text-xs text-slate-500 mt-0.5">{(error as Error)?.message}</p>
          </div>
          <button
            onClick={() => refetch()}
            className="ml-auto px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading */}
      {isLoading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Skeleton className="h-64 rounded-xl" />
            <Skeleton className="h-64 rounded-xl" />
          </div>
        </div>
      ) : (
        <>
          {/* Row 1 — KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <KPICard
              label="Total Leads"
              value={wf.leads.total.toString()}
              subtext={`${wf.leads.recent30} in 30d`}
              icon={<Users size={16} />}
              color={COLOURS.royal}
            />
            <KPICard
              label="Conversion Rate"
              value={`${wf.leads.conversion_rate.toFixed(1)}%`}
              icon={<TrendingUp size={16} />}
              color={COLOURS.emerald}
            />
            <KPICard
              label="Posts Published"
              value={wf.social_posts.by_status.published?.toString() || '0'}
              subtext={wf.social_posts.ready_to_publish > 0 ? `${wf.social_posts.ready_to_publish} ready` : undefined}
              icon={<Activity size={16} />}
              color={COLOURS.linkedin}
              alert={wf.social_posts.ready_to_publish > 0}
            />
            <KPICard
              label="Blogs Published"
              value={wf.blog_posts.by_status.published?.toString() || '0'}
              subtext={`${wf.blog_posts.published_rate.toFixed(1)}% rate`}
              icon={<FileText size={16} />}
              color={COLOURS.amber}
            />
            <KPICard
              label="Approval Rate"
              value={`${wf.approvals.approval_rate.toFixed(1)}%`}
              subtext={wf.approvals.pending > 0 ? `${wf.approvals.pending} pending` : undefined}
              icon={<CheckSquare size={16} />}
              color={wf.approvals.pending > 0 ? COLOURS.amber : COLOURS.emerald}
              alert={wf.approvals.pending > 0}
            />
            <KPICard
              label="Active Schedules"
              value={wf.schedules.active.toString()}
              subtext={`${wf.schedules.total} total`}
              icon={<Clock size={16} />}
              color={COLOURS.royal}
            />
          </div>

          {/* Row 2 — Lead Generation */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
            <LeadFunnel data={wf.leads} />
            <LeadsOverTime data={wf.leads} />
          </div>

          {/* Email summary mini-row */}
          <div className="flex flex-wrap gap-3">
            <div className="glass-card px-4 py-3 flex items-center gap-3">
              <Zap size={14} className="text-blue-400" />
              <div>
                <p className="text-2xs text-slate-500">Emails Sent</p>
                <p className="text-sm font-bold text-slate-100 tabular-nums">{wf.leads.emails_sent}</p>
              </div>
            </div>
            <div className="glass-card px-4 py-3 flex items-center gap-3">
              <Zap size={14} className="text-amber-400" />
              <div>
                <p className="text-2xs text-slate-500">Follow-ups</p>
                <p className="text-sm font-bold text-slate-100 tabular-nums">{wf.leads.follow_ups}</p>
              </div>
            </div>
            <div className="glass-card px-4 py-3 flex items-center gap-3">
              <Zap size={14} className="text-emerald-400" />
              <div>
                <p className="text-2xs text-slate-500">Initial Emails</p>
                <p className="text-sm font-bold text-slate-100 tabular-nums">{wf.leads.initial_emails}</p>
              </div>
            </div>
            {wf.social_posts.in_pipeline > 0 && (
              <div className="glass-card px-4 py-3 flex items-center gap-3" style={{ borderColor: 'rgba(245,158,11,0.3)' }}>
                <AlertTriangle size={14} className="text-amber-400" />
                <div>
                  <p className="text-2xs text-slate-500">Posts in Pipeline</p>
                  <p className="text-sm font-bold text-amber-400 tabular-nums">{wf.social_posts.in_pipeline}</p>
                </div>
              </div>
            )}
          </div>

          {/* Row 3 — Social Posts */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4">
            <PostStatusDonut data={wf.social_posts} />
            <PlatformDistribution data={wf.social_posts} />
            <PostsPerWeek data={wf.social_posts} />
          </div>

          {/* Row 4 — AI Costs */}
          <AICostPanel data={wf.cost} />

          {/* Row 5 — Blog + Approval */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
            <div className="space-y-3 sm:space-y-4">
              <BlogStatusDonut data={wf.blog_posts} />
              <BlogMonthlyTimeline data={wf.blog_posts} />
            </div>
            <div className="space-y-3 sm:space-y-4">
              <ApprovalHealth data={wf.approvals} />
              <TopTagsBar data={wf.blog_posts} />
            </div>
          </div>

          {/* Row 6 — Workflow Runs */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
            <SuccessRateByType data={wf.workflow_runs} />
            <RunVolumeOverTime data={wf.workflow_runs} />
          </div>

          {/* Workflow Runs summary bar */}
          <div className="flex flex-wrap gap-3">
            <div className="glass-card px-4 py-3 flex items-center gap-3">
              <Zap size={14} className="text-emerald-400" />
              <div>
                <p className="text-2xs text-slate-500">Succeeded</p>
                <p className="text-sm font-bold text-slate-100 tabular-nums">{wf.workflow_runs.succeeded}</p>
              </div>
            </div>
            <div className="glass-card px-4 py-3 flex items-center gap-3">
              <Zap size={14} className="text-red-400" />
              <div>
                <p className="text-2xs text-slate-500">Failed</p>
                <p className="text-sm font-bold text-slate-100 tabular-nums">{wf.workflow_runs.failed}</p>
              </div>
            </div>
            <div className="glass-card px-4 py-3 flex items-center gap-3">
              <Zap size={14} className="text-blue-400" />
              <div>
                <p className="text-2xs text-slate-500">Avg Duration</p>
                <p className="text-sm font-bold text-slate-100 tabular-nums">{wf.workflow_runs.avg_duration_min.toFixed(1)}m</p>
              </div>
            </div>
            {wf.workflow_runs.active_runs.length > 0 && (
              <div className="glass-card px-4 py-3 flex items-center gap-3" style={{ borderColor: 'rgba(21,101,192,0.3)' }}>
                <Activity size={14} className="text-blue-400" />
                <div>
                  <p className="text-2xs text-slate-500">Active Runs</p>
                  <p className="text-sm font-bold text-blue-400 tabular-nums">{wf.workflow_runs.active_runs.length}</p>
                </div>
              </div>
            )}
            {wf.workflow_runs.recent_failed.length > 0 && (
              <div className="glass-card px-4 py-3 flex items-center gap-3" style={{ borderColor: 'rgba(239,68,68,0.3)' }}>
                <AlertTriangle size={14} className="text-red-400" />
                <div>
                  <p className="text-2xs text-slate-500">Failed this week</p>
                  <p className="text-sm font-bold text-red-400 tabular-nums">{wf.workflow_runs.recent_failed.length}</p>
                </div>
              </div>
            )}
          </div>

          {/* Row 7 — Recent Workflow Runs List */}
          <RecentWorkflowRuns data={wf.workflow_runs.recent} />

          {/* Row 8 — Schedules Table */}
          <SchedulesTable data={wf.schedules} />
        </>
      )}
    </div>
  );
}