import { supabase } from '@/lib/supabase';
import type { WorkflowAnalyticsData } from '@/types';

export async function fetchWorkflowAnalytics(
  range: number, // days: 7, 30, 90, or 0 for all time
): Promise<WorkflowAnalyticsData> {
  const since = range > 0
    ? new Date(Date.now() - range * 24 * 60 * 60 * 1000).toISOString()
    : null;

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Build date-filtered queries
  const baseFilter = (query: any, col: string) =>
    since ? query.gte(col, since) : query;

  const [
    { data: leads },
    { data: recentLeadsRaw },
    { data: emails },
    { data: posts },
    { data: recentPosts },
    { data: blogs },
    { data: blogTimeline },
    { data: approvals },
    { data: runs },
    { data: activeRuns },
    { data: recentFailed },
    { data: schedules },
  ] = await Promise.all([
    baseFilter(supabase.from('leads').select('status, industry, created_at'), 'created_at'),
    supabase.from('leads').select('status, created_at').gte('created_at', thirtyDaysAgo).order('created_at', { ascending: true }),
    baseFilter(supabase.from('email_drafts').select('status, is_followup, sent_at, created_at'), 'created_at'),
    baseFilter(supabase.from('social_posts').select('type, platform, platforms, status, created_at, posted_at'), 'created_at'),
    supabase.from('social_posts').select('type, platform, status, posted_at').gte('created_at', weekAgo),
    baseFilter(supabase.from('blog_posts').select('status, tags, created_at'), 'created_at'),
    supabase.from('blog_posts').select('created_at, status').order('created_at', { ascending: true }),
    baseFilter(supabase.from('approval_queue').select('workflow_type, status, created_at, reviewed_at'), 'created_at'),
    supabase.from('workflow_runs').select('workflow_type, status, started_at, completed_at').order('started_at', { ascending: false }).limit(500),
    supabase.from('workflow_runs').select('workflow_type, started_at').eq('status', 'running'),
    supabase.from('workflow_runs').select('workflow_type, started_at').eq('status', 'failed').gte('started_at', weekAgo),
    supabase.from('workflow_schedules').select('*'),
  ]);

  // ──────────────────────────────────────────────
  // 1. Lead Generation Stats
  // ──────────────────────────────────────────────
  const leadList = leads ?? [];
  const totalLeads = leadList.length;
  const recent30 = (recentLeadsRaw ?? []).length;

  const byStatus: Record<string, number> = {};
  const byIndustry: Record<string, number> = {};
  const dailyMap: Record<string, number> = {};

  for (const l of leadList as any[]) {
    byStatus[l.status] = (byStatus[l.status] || 0) + 1;
    byIndustry[l.industry] = (byIndustry[l.industry] || 0) + 1;
    const day = l.created_at?.slice(0, 10);
    if (day) dailyMap[day] = (dailyMap[day] || 0) + 1;
  }

  const converted = (leadList as any[]).filter((l: any) => l.status === 'converted').length;
  const conversionRate = totalLeads > 0 ? (converted / totalLeads) * 100 : 0;

  const topIndustries = Object.entries(byIndustry)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([industry, count]) => ({ industry, count }));

  // Build daily 30-day array
  const daily30: { date: string; count: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    daily30.push({ date: key, count: dailyMap[key] || 0 });
  }

  // Email performance
  const emailList = (emails ?? []) as any[];
  const sentEmails = emailList.filter((e: any) => e.status === 'sent');
  const followUps = sentEmails.filter((e: any) => e.is_followup);
  const initialEmails = sentEmails.filter((e: any) => !e.is_followup);

  // ──────────────────────────────────────────────
  // 2. Social Post Stats
  // ──────────────────────────────────────────────
  const postList = posts ?? [];
  const postByStatus: Record<string, number> = {};
  const postByType: Record<string, number> = {};
  const platformCounts: Record<string, number> = {};
  const weeklyMap: Record<string, number> = {};

  for (const p of postList as any[]) {
    postByStatus[p.status] = (postByStatus[p.status] || 0) + 1;
    if (p.type) postByType[p.type] = (postByType[p.type] || 0) + 1;
    const plt = p.platforms || {};
    if (plt.linkedin) platformCounts.linkedin = (platformCounts.linkedin || 0) + 1;
    if (plt.facebook) platformCounts.facebook = (platformCounts.facebook || 0) + 1;
    if (plt.instagram) platformCounts.instagram = (platformCounts.instagram || 0) + 1;

    // Weekly grouping
    if (p.created_at) {
      const d = new Date(p.created_at);
      const weekStart = new Date(d);
      weekStart.setDate(d.getDate() - d.getDay());
      const weekKey = weekStart.toISOString().slice(0, 10);
      weeklyMap[weekKey] = (weeklyMap[weekKey] || 0) + 1;
    }
  }

  const publishedWeek = ((recentPosts ?? []) as any[]).filter((p: any) => p.status === 'published').length;
  const inPipeline = (postList as any[]).filter((p: any) =>
    ['pending_approval', 'publishing'].includes(p.status)
  ).length;
  const readyToPublish = (postList as any[]).filter((p: any) => p.status === 'approved_manual').length;

  // Build weekly 8-week array
  const weekly8: { week: string; count: number }[] = [];
  for (let i = 7; i >= 0; i--) {
    const d = new Date(Date.now());
    d.setDate(d.getDate() - d.getDay() - i * 7);
    const key = d.toISOString().slice(0, 10);
    weekly8.push({ week: key, count: weeklyMap[key] || 0 });
  }

  // ──────────────────────────────────────────────
  // 3. Blog Post Stats
  // ──────────────────────────────────────────────
  const blogList = blogs ?? [];
  const blogByStatus: Record<string, number> = {};
  const tagCounts: Record<string, number> = {};

  for (const b of blogList as any[]) {
    blogByStatus[b.status] = (blogByStatus[b.status] || 0) + 1;
    const tags = Array.isArray(b.tags) ? b.tags : [];
    tags.forEach((t: string) => { tagCounts[t] = (tagCounts[t] || 0) + 1; });
  }

  const publishedBlogs = (blogList as any[]).filter((b: any) => b.status === 'published').length;
  const blogPublishedRate = blogList.length > 0 ? (publishedBlogs / blogList.length) * 100 : 0;

  const topTags = Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([tag, count]) => ({ tag, count }));

  // Monthly blog timeline (last 6 months)
  const monthlyBlogMap: Record<string, number> = {};
  const blogTimelineList = (blogTimeline ?? []) as any[];
  for (const b of blogTimelineList) {
    const month = b.created_at?.slice(0, 7);
    if (month) monthlyBlogMap[month] = (monthlyBlogMap[month] || 0) + 1;
  }
  const monthly6: { month: string; count: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    monthly6.push({ month: key, count: monthlyBlogMap[key] || 0 });
  }

  // ──────────────────────────────────────────────
  // 4. Approval Queue Stats
  // ──────────────────────────────────────────────
  const approvalList = (approvals ?? []) as any[];
  const pendingApprovals = approvalList.filter((a: any) => a.status === 'pending').length;
  const reviewed = approvalList.filter((a: any) => ['approved', 'rejected'].includes(a.status));
  const approvedAll = approvalList.filter((a: any) => a.status === 'approved');
  const expiredApprovals = approvalList.filter((a: any) => a.status === 'expired').length;

  const approvalRate = reviewed.length > 0
    ? (approvedAll.length / reviewed.length) * 100
    : 0;

  const reviewTimes = reviewed
    .filter((a: any) => a.reviewed_at)
    .map((a: any) => new Date(a.reviewed_at).getTime() - new Date(a.created_at).getTime());
  const avgReviewMs = reviewTimes.length > 0
    ? reviewTimes.reduce((s: number, t: number) => s + t, 0) / reviewTimes.length
    : 0;
  const avgReviewHours = avgReviewMs / 1000 / 60 / 60;

  const byWorkflowType: Record<string, number> = {};
  for (const a of approvalList as any[]) {
    byWorkflowType[a.workflow_type] = (byWorkflowType[a.workflow_type] || 0) + 1;
  }

  // Approval daily 30-day
  const dailyApprovalMap: Record<string, { approved: number; rejected: number }> = {};
  for (const a of approvalList as any[]) {
    const day = a.created_at?.slice(0, 10);
    if (!day) continue;
    if (!dailyApprovalMap[day]) dailyApprovalMap[day] = { approved: 0, rejected: 0 };
    if (a.status === 'approved') dailyApprovalMap[day].approved++;
    if (a.status === 'rejected') dailyApprovalMap[day].rejected++;
  }
  const approvalDaily30: { date: string; approved: number; rejected: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    const entry = dailyApprovalMap[key] || { approved: 0, rejected: 0 };
    approvalDaily30.push({ date: key, ...entry });
  }

  // ──────────────────────────────────────────────
  // 5. Workflow Run Stats
  // ──────────────────────────────────────────────
  const runsList = (runs ?? []) as any[];
  const succeededRuns = runsList.filter((r: any) => r.status === 'succeeded').length;
  const failedRuns = runsList.filter((r: any) => r.status === 'failed').length;
  const runningRuns = runsList.filter((r: any) => r.status === 'running').length;

  // Success rate by type
  const successRateMap: Record<string, { succeeded: number; total: number }> = {};
  for (const r of runsList as any[]) {
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
  const completedRuns = runsList.filter((r: any) => r.completed_at && r.started_at);
  const durations = completedRuns.map((r: any) =>
    new Date(r.completed_at).getTime() - new Date(r.started_at).getTime()
  );
  const avgDurationMs = durations.length > 0
    ? durations.reduce((s: number, d: number) => s + d, 0) / durations.length
    : 0;
  const avgDurationMin = avgDurationMs / 1000 / 60;

  // Run volume daily 30-day
  const dailyRunMap: Record<string, { succeeded: number; failed: number; running: number }> = {};
  for (const r of runsList as any[]) {
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

  // ──────────────────────────────────────────────
  // 6. Schedule Stats
  // ──────────────────────────────────────────────
  const scheduleList = (schedules ?? []) as any[];
  const activeSchedules = scheduleList.filter((s: any) => s.enabled).length;
  const pausedSchedules = scheduleList.filter((s: any) => !s.enabled).length;

  const byFrequency: Record<string, number> = {};
  const schedulesByType: Record<string, number> = {};
  for (const s of scheduleList as any[]) {
    byFrequency[s.frequency] = (byFrequency[s.frequency] || 0) + 1;
    schedulesByType[s.workflow_type] = (schedulesByType[s.workflow_type] || 0) + 1;
  }

  // ──────────────────────────────────────────────
  return {
    leads: {
      total: totalLeads,
      recent30,
      by_status: byStatus,
      conversion_rate: conversionRate,
      by_industry: topIndustries,
      daily_30: daily30,
      emails_sent: sentEmails.length,
      follow_ups: followUps.length,
      initial_emails: initialEmails.length,
    },
    social_posts: {
      total: postList.length,
      by_status: postByStatus,
      by_type: postByType,
      platform_counts: platformCounts,
      published_week: publishedWeek,
      in_pipeline: inPipeline,
      ready_to_publish: readyToPublish,
      weekly_8: weekly8,
    },
    blog_posts: {
      total: blogList.length,
      by_status: blogByStatus,
      published_rate: blogPublishedRate,
      top_tags: topTags,
      monthly_6: monthly6,
    },
    approvals: {
      pending: pendingApprovals,
      approval_rate: approvalRate,
      avg_review_hours: avgReviewHours,
      expired: expiredApprovals,
      by_workflow_type: byWorkflowType,
      daily_30: approvalDaily30,
    },
    workflow_runs: {
      total: runsList.length,
      succeeded: succeededRuns,
      failed: failedRuns,
      running: runningRuns,
      success_rate_by_type: successRateByType,
      avg_duration_min: avgDurationMin,
      active_runs: ((activeRuns ?? []) as any[]).map((r: any) => ({
        workflow_type: r.workflow_type,
        started_at: r.started_at,
      })),
      recent_failed: ((recentFailed ?? []) as any[]).map((r: any) => ({
        workflow_type: r.workflow_type,
        started_at: r.started_at,
      })),
      daily_30: runDaily30,
    },
    schedules: {
      total: scheduleList.length,
      active: activeSchedules,
      paused: pausedSchedules,
      by_frequency: byFrequency,
      by_type: schedulesByType,
      list: (scheduleList as any[]).map((s: any) => ({
        id: s.id,
        label: s.label,
        workflow_type: s.workflow_type,
        frequency: s.frequency,
        enabled: s.enabled,
        run_time: s.run_time,
        days_of_week: s.days_of_week,
        day_of_month: s.day_of_month,
        created_at: s.created_at,
      })),
    },
  };
}