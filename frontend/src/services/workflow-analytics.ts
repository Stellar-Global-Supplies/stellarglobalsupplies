import type { WorkflowAnalyticsData } from '@/types';

export interface DashboardData {
  leads: {
    total: number;
    by_status: Record<string, number>;
  };
  social_posts: {
    total: number;
    by_status: Record<string, number>;
  };
  blogs: {
    total: number;
    by_status: Record<string, number>;
  };
  pending_approvals: number;
  cost: {
    total_usd: number;
    by_type: Record<string, number>;
  };
  workflow_runs: Array<{
    id: string;
    workflow_type: string;
    status: string;
    started_at: string;
    completed_at?: string;
    cost_usd?: string;
  }>;
}

export async function fetchDashboard(): Promise<DashboardData> {
  const base = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';
  const res = await fetch(`${base}/data/dashboard`, {
    headers: { 'Content-Type': 'application/json' },
  });

  if (!res.ok) {
    throw new Error(`Dashboard API failed: ${res.status} ${res.statusText}`);
  }

  return res.json() as Promise<DashboardData>;
}

export async function fetchWorkflowAnalytics(
  _range: number,
): Promise<WorkflowAnalyticsData> {
  // Fetch from the single /data/dashboard endpoint
  const dashboard = await fetchDashboard();

  // Transform dashboard data to WorkflowAnalyticsData format
  const leadList = dashboard.leads;
  const socialList = dashboard.social_posts;
  const blogList = dashboard.blogs;
  const pendingApprovals = dashboard.pending_approvals;
  const runs = dashboard.workflow_runs;

  // Lead stats
  const totalLeads = leadList.total || 0;
  const byStatus = leadList.by_status || {};
  const conversionRate = byStatus.converted && totalLeads > 0
    ? (byStatus.converted / totalLeads) * 100
    : 0;

  // Social post stats
  const totalPosts = socialList.total || 0;
  const postByStatus = socialList.by_status || {};
  const publishedWeek = postByStatus.posted || 0;
  const readyToPublish = postByStatus.approved_manual || 0;
  const inPipeline = (postByStatus.pending_approval || 0) + (postByStatus.publishing || 0);

  // Blog stats
  const totalBlogs = blogList.total || 0;
  const blogByStatus = blogList.by_status || {};
  const publishedBlogs = blogByStatus.published || 0;
  const blogPublishedRate = totalBlogs > 0 ? (publishedBlogs / totalBlogs) * 100 : 0;

  // Workflow run stats
  const succeededRuns = runs.filter((r) => r.status === 'succeeded').length;
  const failedRuns = runs.filter((r) => r.status === 'failed').length;
  const runningRuns = runs.filter((r) => r.status === 'running').length;
  const totalRuns = runs.length;

  // Success rate by type
  const successRateMap: Record<string, { succeeded: number; total: number }> = {};
  for (const r of runs) {
    if (!successRateMap[r.workflow_type]) {
      successRateMap[r.workflow_type] = { succeeded: 0, total: 0 };
    }
    successRateMap[r.workflow_type].total++;
    if (r.status === 'succeeded') successRateMap[r.workflow_type].succeeded++;
  }
  const successRateByType = Object.entries(successRateMap).map(([workflow_type, data]) => ({
    workflow_type,
    ...data,
    rate: data.total > 0 ? (data.succeeded / data.total) * 100 : 0,
  }));

  // Average duration
  const completedRuns = runs.filter((r) => r.completed_at && r.started_at);
  const durations = completedRuns.map((r) =>
    new Date(r.completed_at!).getTime() - new Date(r.started_at).getTime()
  );
  const avgDurationMs = durations.length > 0
    ? durations.reduce((s, d) => s + d, 0) / durations.length
    : 0;
  const avgDurationMin = avgDurationMs / 1000 / 60;

  // Active and recent failed runs
  const activeRuns = runs
    .filter((r) => r.status === 'running')
    .map((r) => ({ workflow_type: r.workflow_type, started_at: r.started_at }));

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const recentFailed = runs
    .filter((r) => r.status === 'failed' && new Date(r.started_at) >= new Date(weekAgo))
    .map((r) => ({ workflow_type: r.workflow_type, started_at: r.started_at }));

  // Daily run volume (last 30 days)
  const dailyRunMap: Record<string, { succeeded: number; failed: number; running: number }> = {};
  for (const r of runs) {
    const day = r.started_at?.slice(0, 10);
    if (!day) continue;
    if (!dailyRunMap[day]) dailyRunMap[day] = { succeeded: 0, failed: 0, running: 0 };
    if (r.status === 'succeeded') dailyRunMap[day].succeeded++;
    if (r.status === 'failed') dailyRunMap[day].failed++;
    if (r.status === 'running') dailyRunMap[day].running++;
  }
  const runDaily30: { date: string; succeeded: number; failed: number; running: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    const entry = dailyRunMap[key] || { succeeded: 0, failed: 0, running: 0 };
    runDaily30.push({ date: key, ...entry });
  }

  // Approval stats (from pending_approvals count and workflow runs)
  const approvalRate = totalRuns > 0 ? (succeededRuns / totalRuns) * 100 : 0;

  // AI Cost data from dashboard
  const totalCost = dashboard.cost?.total_usd || 0;
  const costByType = dashboard.cost?.by_type || {};

  // Build empty schedules (not provided by /data/dashboard endpoint)
  const schedules = {
    total: 0,
    active: 0,
    paused: 0,
    by_frequency: {},
    by_type: {},
    list: [],
  };

  return {
    leads: {
      total: totalLeads,
      recent30: totalLeads, // Dashboard doesn't provide recent30, use total
      by_status: byStatus,
      conversion_rate: conversionRate,
      by_industry: [],
      daily_30: [],
      emails_sent: 0,
      follow_ups: 0,
      initial_emails: 0,
    },
    social_posts: {
      total: totalPosts,
      by_status: postByStatus,
      by_type: {},
      platform_counts: {},
      published_week: publishedWeek,
      in_pipeline: inPipeline,
      ready_to_publish: readyToPublish,
      weekly_8: [],
    },
    blog_posts: {
      total: totalBlogs,
      by_status: blogByStatus,
      published_rate: blogPublishedRate,
      top_tags: [],
      monthly_6: [],
    },
    approvals: {
      pending: pendingApprovals,
      approval_rate: approvalRate,
      avg_review_hours: 0,
      expired: 0,
      by_workflow_type: {},
      daily_30: [],
    },
    cost: {
      total_usd: totalCost,
      by_type: costByType,
    },
    workflow_runs: {
      total: totalRuns,
      succeeded: succeededRuns,
      failed: failedRuns,
      running: runningRuns,
      success_rate_by_type: successRateByType,
      avg_duration_min: avgDurationMin,
      active_runs: activeRuns,
      recent_failed: recentFailed,
      daily_30: runDaily30,
      recent: dashboard.workflow_runs.slice(0, 20),
    },
    schedules,
  };
}