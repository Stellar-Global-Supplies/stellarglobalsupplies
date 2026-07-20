import { supabase } from '@/lib/supabase';
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
  // Fetch all data in parallel from Supabase
  const [
    leadsResult,
    socialPostsResult,
    blogsResult,
    approvalsResult,
    workflowRunsResult,
  ] = await Promise.all([
    // Leads
    supabase
      .from('leads')
      .select('status, created_at'),

    // Social posts
    supabase
      .from('ops_social_posts')
      .select('type, platform, platforms, status, created_at, posted_at, video_url, media_type'),

    // Blogs
    supabase
      .from('blog_posts')
      .select('status, tags, created_at'),

    // Approvals
    supabase
      .from('approval_queue')
      .select('workflow_type, status, created_at, reviewed_at'),

    // Workflow runs
    supabase
      .from('workflow_runs')
      .select('id, workflow_type, status, started_at, completed_at, cost_usd')
      .order('started_at', { ascending: false })
      .limit(500),
  ]);

  if (leadsResult.error) throw new Error(`Leads query failed: ${leadsResult.error.message}`);
  if (socialPostsResult.error) throw new Error(`Social posts query failed: ${socialPostsResult.error.message}`);
  if (blogsResult.error) throw new Error(`Blogs query failed: ${blogsResult.error.message}`);
  if (approvalsResult.error) throw new Error(`Approvals query failed: ${approvalsResult.error.message}`);
  if (workflowRunsResult.error) throw new Error(`Workflow runs query failed: ${workflowRunsResult.error.message}`);

  const leads = leadsResult.data || [];
  const socialPosts = socialPostsResult.data || [];
  const blogs = blogsResult.data || [];
  const approvals = approvalsResult.data || [];
  const workflowRuns = workflowRunsResult.data || [];

  // Lead stats
  const totalLeads = leads.length;
  const byStatus = leads.reduce((acc, l) => {
    acc[l.status] = (acc[l.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // Social post stats
  const totalPosts = socialPosts.length;
  const postByStatus = socialPosts.reduce((acc, p) => {
    acc[p.status] = (acc[p.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // Blog stats
  const totalBlogs = blogs.length;
  const blogByStatus = blogs.reduce((acc, b) => {
    acc[b.status] = (acc[b.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // Approval stats
  const pendingApprovals = approvals.filter(a => a.status === 'pending').length;

  // Transform workflow runs to match DashboardData type
  const transformedWorkflowRuns = workflowRuns.slice(0, 20).map((run) => ({
    id: run.id,
    workflow_type: run.workflow_type,
    status: run.status,
    started_at: run.started_at,
    completed_at: run.completed_at || undefined,
    cost_usd: run.cost_usd || undefined,
  }));

  return {
    leads: {
      total: totalLeads,
      by_status: byStatus,
    },
    social_posts: {
      total: totalPosts,
      by_status: postByStatus,
    },
    blogs: {
      total: totalBlogs,
      by_status: blogByStatus,
    },
    pending_approvals: pendingApprovals,
    cost: {
      total_usd: 0,
      by_type: {},
    },
    workflow_runs: transformedWorkflowRuns,
  };
}

export async function fetchWorkflowAnalytics(
  _range: number,
): Promise<WorkflowAnalyticsData> {
  // Fetch all data directly from Supabase
  const [
    leadsResult,
    socialPostsResult,
    blogsResult,
    approvalsResult,
    workflowRunsResult,
  ] = await Promise.all([
    supabase
      .from('leads')
      .select('status, created_at, industry'),

    supabase
      .from('ops_social_posts')
      .select('type, platform, platforms, status, created_at, posted_at, video_url, media_type'),

    supabase
      .from('blog_posts')
      .select('status, tags, created_at'),

    supabase
      .from('approval_queue')
      .select('workflow_type, status, created_at, reviewed_at'),

    supabase
      .from('workflow_runs')
      .select('id, workflow_type, status, started_at, completed_at, cost_usd')
      .order('started_at', { ascending: false })
      .limit(500),
  ]);

  if (leadsResult.error) throw new Error(`Leads query failed: ${leadsResult.error.message}`);
  if (socialPostsResult.error) throw new Error(`Social posts query failed: ${socialPostsResult.error.message}`);
  if (blogsResult.error) throw new Error(`Blogs query failed: ${blogsResult.error.message}`);
  if (approvalsResult.error) throw new Error(`Approvals query failed: ${approvalsResult.error.message}`);
  if (workflowRunsResult.error) throw new Error(`Workflow runs query failed: ${workflowRunsResult.error.message}`);

  const leads = leadsResult.data || [];
  const socialPosts = socialPostsResult.data || [];
  const blogs = blogsResult.data || [];
  const approvals = approvalsResult.data || [];
  const workflowRuns = workflowRunsResult.data || [];

  // Lead stats
  const totalLeads = leads.length;
  const byStatus = leads.reduce((acc, l) => {
    acc[l.status] = (acc[l.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const conversionRate = totalLeads > 0
    ? (byStatus.converted || 0) / totalLeads * 100
    : 0;

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const recentLeads = leads.filter(l => new Date(l.created_at) >= new Date(thirtyDaysAgo)).length;

  // Email stats (placeholder - would need email_drafts table)
  const emailsSent = 0;
  const followUps = 0;
  const initialEmails = 0;

  // Social post stats
  const totalPosts = socialPosts.length;
  const postByStatus = socialPosts.reduce((acc, p) => {
    acc[p.status] = (acc[p.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const postByType = socialPosts.reduce((acc, p) => {
    acc[p.type] = (acc[p.type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const platformCounts = socialPosts.reduce((acc, p) => {
    const platforms = p.platforms || {};
    if (platforms.linkedin) acc.linkedin = (acc.linkedin || 0) + 1;
    if (platforms.facebook) acc.facebook = (acc.facebook || 0) + 1;
    if (platforms.instagram) acc.instagram = (acc.instagram || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const publishedWeek = socialPosts.filter(p => 
    p.posted_at && new Date(p.posted_at) >= new Date(weekAgo)
  ).length;
  const inPipeline = (postByStatus.pending_approval || 0) + (postByStatus.publishing || 0);
  const readyToPublish = postByStatus.approved_manual || 0;

  // Blog stats
  const totalBlogs = blogs.length;
  const blogByStatus = blogs.reduce((acc, b) => {
    acc[b.status] = (acc[b.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const publishedBlogs = blogByStatus.published || 0;
  const blogPublishedRate = totalBlogs > 0 ? (publishedBlogs / totalBlogs) * 100 : 0;

  const tagCounts = blogs.reduce((acc, b) => {
    const tags = Array.isArray(b.tags) ? b.tags : [];
    tags.forEach(t => { acc[t] = (acc[t] || 0) + 1 });
    return acc;
  }, {} as Record<string, number>);
  const topTags = Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([tag, count]) => ({ tag, count }));

  // Approval stats
  const pending = approvals.filter(a => a.status === 'pending').length;
  const reviewed = approvals.filter(a => ['approved', 'rejected'].includes(a.status));
  const approvedAll = approvals.filter(a => a.status === 'approved');
  const approvalRate = reviewed.length > 0
    ? (approvedAll.length / reviewed.length * 100)
    : 0;

  const reviewTimes = reviewed
    .filter(a => a.reviewed_at)
    .map(a => new Date(a.reviewed_at!).getTime() - new Date(a.created_at).getTime());
  const avgReviewMs = reviewTimes.length > 0
    ? reviewTimes.reduce((s, t) => s + t, 0) / reviewTimes.length
    : 0;
  const avgReviewHrs = avgReviewMs / 1000 / 60 / 60;

  const expired = approvals.filter(a => a.status === 'expired').length;

  const byWorkflowType = approvals.reduce((acc, a) => {
    acc[a.workflow_type] = (acc[a.workflow_type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // Workflow run stats
  const succeededRuns = workflowRuns.filter((r) => r.status === 'succeeded').length;
  const failedRuns = workflowRuns.filter((r) => r.status === 'failed').length;
  const runningRuns = workflowRuns.filter((r) => r.status === 'running').length;
  const totalRuns = workflowRuns.length;

  const successRateMap: Record<string, { succeeded: number; total: number }> = {};
  for (const r of workflowRuns) {
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

  const completedRuns = workflowRuns.filter(r => r.completed_at && r.started_at);
  const durations = completedRuns.map(r =>
    new Date(r.completed_at!).getTime() - new Date(r.started_at).getTime()
  );
  const avgDurationMs = durations.length > 0
    ? durations.reduce((s, d) => s + d, 0) / durations.length
    : 0;
  const avgDurationMin = avgDurationMs / 1000 / 60;

  const activeRuns = workflowRuns
    .filter(r => r.status === 'running')
    .map(r => ({ workflow_type: r.workflow_type, started_at: r.started_at }));

  const recentFailed = workflowRuns
    .filter(r => r.status === 'failed' && new Date(r.started_at) >= new Date(weekAgo))
    .map(r => ({ workflow_type: r.workflow_type, started_at: r.started_at }));

  // Transform workflow runs to match WorkflowAnalyticsData type
  const transformedWorkflowRuns = workflowRuns.slice(0, 20).map((run) => ({
    id: run.id,
    workflow_type: run.workflow_type,
    status: run.status,
    started_at: run.started_at,
    completed_at: run.completed_at || undefined,
    cost_usd: run.cost_usd || undefined,
  }));

  // Daily run volume (last 30 days)
  const dailyRunMap: Record<string, { succeeded: number; failed: number; running: number }> = {};
  for (const r of workflowRuns) {
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
      recent30: recentLeads,
      by_status: byStatus,
      conversion_rate: conversionRate,
      by_industry: [],
      daily_30: [],
      emails_sent: emailsSent,
      follow_ups: followUps,
      initial_emails: initialEmails,
    },
    social_posts: {
      total: totalPosts,
      by_status: postByStatus,
      by_type: postByType,
      platform_counts: platformCounts,
      published_week: publishedWeek,
      in_pipeline: inPipeline,
      ready_to_publish: readyToPublish,
      weekly_8: [],
    },
    blog_posts: {
      total: totalBlogs,
      by_status: blogByStatus,
      published_rate: blogPublishedRate,
      top_tags: topTags,
      monthly_6: [],
    },
    approvals: {
      pending: pending,
      approval_rate: approvalRate,
      avg_review_hours: avgReviewHrs,
      expired: expired,
      by_workflow_type: byWorkflowType,
      daily_30: [],
    },
    cost: {
      total_usd: 0,
      by_type: {},
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
      recent: transformedWorkflowRuns,
    },
    schedules,
  };
}