# Analytics Page — Stellar Global Supplies Ops Dashboard

## Overview

Add an **Analytics** page (`/analytics`) to the ops dashboard that gives a full picture of workflow performance across leads, social posts, blogs, approvals, and schedules.

The page uses the existing **Supabase client** (already set up in `src/lib/supabase.js`) and the existing **API service** (`src/services/api.js`). All queries run directly against Supabase using the `supabase` client — no new backend Lambda needed.

---

## Database Schema Reference

### `leads`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `company_name` | text | |
| `email` | text | unique |
| `industry` | text | |
| `status` | text | `pending \| emailed \| followed_up \| converted \| rejected` |
| `source` | text | `ai_generated` etc |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

### `email_drafts`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `lead_id` | uuid | FK → leads |
| `status` | text | `draft \| approved \| sent \| rejected` |
| `is_followup` | boolean | |
| `sent_at` | timestamptz | |
| `created_at` | timestamptz | |

### `social_posts`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `type` | text | `product \| tech` |
| `platform` | text | `linkedin \| facebook \| instagram` |
| `platforms` | jsonb | `{"facebook":bool, "instagram":bool, "linkedin":bool}` |
| `status` | text | `pending_approval \| approved_manual \| publishing \| published \| rejected \| publish_failed` |
| `caption` | text | |
| `title` | text | |
| `image_url` | text | |
| `posted_at` | timestamptz | |
| `created_at` | timestamptz | |

### `blog_posts`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `title` | text | |
| `status` | text | `draft \| approved \| pr_created \| published \| rejected` |
| `tags` | jsonb | array of strings |
| `pr_url` | text | GitHub PR link |
| `created_at` | timestamptz | |

### `approval_queue`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `workflow_type` | text | `lead_email \| lead_followup \| social_product \| social_tech \| blog` |
| `status` | text | `pending \| approved \| rejected \| expired` |
| `reviewed_at` | timestamptz | |
| `created_at` | timestamptz | |

### `workflow_runs`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `workflow_type` | text | `lead_generation \| lead_email_existing \| social_product \| social_tech \| blog` |
| `status` | text | `running \| succeeded \| failed \| stopped \| timed_out` |
| `started_at` | timestamptz | |
| `completed_at` | timestamptz | |

### `workflow_schedules`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `label` | text | user-defined name |
| `workflow_type` | text | `lead-generation \| social-product \| social-tech \| blog` |
| `frequency` | text | `daily \| weekly \| monthly` |
| `enabled` | boolean | |
| `run_time` | text | `HH:MM` in IST |
| `days_of_week` | text[] | for weekly schedules |
| `day_of_month` | integer | for monthly schedules |
| `created_at` | timestamptz | |

---

## Supabase Queries

Use `supabase` from `src/lib/supabase.js`. All queries use `.from()` with appropriate filters.

### 1. Lead Generation Stats

```js
// Total leads + breakdown by status
const { data: leads } = await supabase
  .from('leads')
  .select('status, created_at')

// Leads created in last 30 days
const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
const { data: recentLeads } = await supabase
  .from('leads')
  .select('status, created_at')
  .gte('created_at', thirtyDaysAgo)
  .order('created_at', { ascending: true })

// Conversion rate
// converted = leads where status = 'converted'
const conversionRate = leads.filter(l => l.status === 'converted').length / leads.length

// Leads by industry
const byIndustry = await supabase
  .from('leads')
  .select('industry')
  // Group client-side: leads.reduce(...)

// Email performance
const { data: emails } = await supabase
  .from('email_drafts')
  .select('status, is_followup, sent_at, created_at')

// Sent emails (both initial + follow-up)
const sentEmails    = emails.filter(e => e.status === 'sent')
const followUps     = emails.filter(e => e.is_followup && e.status === 'sent')
const initialEmails = emails.filter(e => !e.is_followup && e.status === 'sent')
```

**Metrics to display:**
- Total leads generated (all time + last 30 days)
- Status funnel: pending → emailed → followed_up → converted
- Conversion rate % (converted / total)
- Emails sent (initial vs follow-up)
- Top 5 industries by lead count (bar chart)
- Leads over time — daily count for last 30 days (line chart)

---

### 2. Social Post Stats

```js
// All social posts
const { data: posts } = await supabase
  .from('social_posts')
  .select('type, platform, platforms, status, created_at, posted_at')

// Posts by status
const byStatus = posts.reduce((acc, p) => {
  acc[p.status] = (acc[p.status] || 0) + 1
  return acc
}, {})

// Posts by type (product vs tech)
const byType = posts.reduce((acc, p) => {
  acc[p.type] = (acc[p.type] || 0) + 1
  return acc
}, {})

// Platform distribution (from platforms JSONB)
// Count posts where each platform is true
const platformCounts = posts.reduce((acc, p) => {
  const plt = p.platforms || {}
  if (plt.linkedin)  acc.linkedin  = (acc.linkedin  || 0) + 1
  if (plt.facebook)  acc.facebook  = (acc.facebook  || 0) + 1
  if (plt.instagram) acc.instagram = (acc.instagram || 0) + 1
  return acc
}, {})

// Published this week
const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
const { data: recentPosts } = await supabase
  .from('social_posts')
  .select('type, platform, status, posted_at')
  .gte('created_at', weekAgo)

// Posts in pipeline (pending save or pending publish)
const inPipeline = posts.filter(p =>
  ['pending_approval', 'publishing'].includes(p.status)
).length

// Ready to publish
const readyToPublish = posts.filter(p => p.status === 'approved_manual').length
```

**Metrics to display:**
- Total posts: published / approved (ready) / pending / rejected
- Pipeline badge: X posts ready to publish (link to /content)
- Product vs Tech split (donut chart)
- Platform distribution: LinkedIn / Facebook / Instagram (bar chart)
- Posts published per week — last 8 weeks (bar chart)
- Post status funnel: pending_approval → approved_manual → publishing → published

---

### 3. Blog Post Stats

```js
const { data: blogs } = await supabase
  .from('blog_posts')
  .select('status, tags, created_at')

// By status
const blogsByStatus = blogs.reduce((acc, b) => {
  acc[b.status] = (acc[b.status] || 0) + 1
  return acc
}, {})

// Published rate
const publishedRate = blogs.filter(b => b.status === 'published').length / blogs.length

// Top tags — flatten tags JSONB array and count
const tagCounts = blogs.reduce((acc, b) => {
  const tags = Array.isArray(b.tags) ? b.tags : []
  tags.forEach(t => { acc[t] = (acc[t] || 0) + 1 })
  return acc
}, {})
const topTags = Object.entries(tagCounts)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 8)

// Blogs over time
const { data: blogTimeline } = await supabase
  .from('blog_posts')
  .select('created_at, status')
  .order('created_at', { ascending: true })
```

**Metrics to display:**
- Total blogs: draft / approved / PR created / published / rejected
- Published rate %
- Top 8 tags (horizontal bar chart)
- Blogs created per month — last 6 months (bar chart)

---

### 4. Approval Queue Stats

```js
const { data: approvals } = await supabase
  .from('approval_queue')
  .select('workflow_type, status, created_at, reviewed_at')

// Currently pending
const pending = approvals.filter(a => a.status === 'pending')

// Approval rate
const reviewed    = approvals.filter(a => ['approved','rejected'].includes(a.status))
const approvedAll = approvals.filter(a => a.status === 'approved')
const approvalRate = reviewed.length > 0
  ? (approvedAll.length / reviewed.length * 100).toFixed(1)
  : 0

// Average time to review (for approved/rejected items with reviewed_at)
const reviewTimes = reviewed
  .filter(a => a.reviewed_at)
  .map(a => new Date(a.reviewed_at) - new Date(a.created_at))
const avgReviewMs  = reviewTimes.reduce((s, t) => s + t, 0) / reviewTimes.length
const avgReviewHrs = (avgReviewMs / 1000 / 60 / 60).toFixed(1)

// By workflow type
const byWorkflowType = approvals.reduce((acc, a) => {
  acc[a.workflow_type] = (acc[a.workflow_type] || 0) + 1
  return acc
}, {})

// Expired approvals
const expired = approvals.filter(a => a.status === 'expired').length
```

**Metrics to display:**
- Currently pending (with link to /approvals — alert if > 0)
- Approval rate % (approved vs rejected)
- Average time to review (hours)
- Expired approvals count (warning if > 0)
- Approvals by workflow type (donut chart)
- Approval volume over time — last 30 days (line chart)

---

### 5. Workflow Run Stats

```js
const { data: runs } = await supabase
  .from('workflow_runs')
  .select('workflow_type, status, started_at, completed_at')
  .order('started_at', { ascending: false })
  .limit(500)

// Success rate by workflow type
const successRate = runs.reduce((acc, r) => {
  if (!acc[r.workflow_type]) acc[r.workflow_type] = { succeeded: 0, total: 0 }
  acc[r.workflow_type].total++
  if (r.status === 'succeeded') acc[r.workflow_type].succeeded++
  return acc
}, {})

// Average duration (completed runs only)
const completedRuns = runs.filter(r => r.completed_at && r.started_at)
const durations = completedRuns.map(r =>
  new Date(r.completed_at) - new Date(r.started_at)
)
const avgDurationMs  = durations.reduce((s, d) => s + d, 0) / durations.length
const avgDurationMin = (avgDurationMs / 1000 / 60).toFixed(1)

// Currently running
const { data: activeRuns } = await supabase
  .from('workflow_runs')
  .select('workflow_type, started_at')
  .eq('status', 'running')

// Failed runs in last 7 days
const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
const { data: recentFailed } = await supabase
  .from('workflow_runs')
  .select('workflow_type, started_at, error_msg')
  .eq('status', 'failed')
  .gte('started_at', weekAgo)
```

**Metrics to display:**
- Currently running workflows (live badge)
- Total runs: succeeded / failed / running (stat cards)
- Success rate per workflow type (grouped bar chart)
- Average run duration in minutes
- Failed runs this week (warning list with workflow_type + started_at)
- Run volume over time — last 30 days (line chart, coloured by status)

---

### 6. Schedule Stats

```js
const { data: schedules } = await supabase
  .from('workflow_schedules')
  .select('workflow_type, label, frequency, enabled, run_time, days_of_week, day_of_month, created_at')

// Active vs paused
const active = schedules.filter(s => s.enabled)
const paused = schedules.filter(s => !s.enabled)

// By frequency
const byFrequency = schedules.reduce((acc, s) => {
  acc[s.frequency] = (acc[s.frequency] || 0) + 1
  return acc
}, {})

// By workflow type
const schedulesByType = schedules.reduce((acc, s) => {
  acc[s.workflow_type] = (acc[s.workflow_type] || 0) + 1
  return acc
}, {})
```

**Metrics to display:**
- Total schedules: active / paused
- Schedule list table: label / type / frequency / next run / status
- By workflow type breakdown (donut chart)
- By frequency breakdown: daily / weekly / monthly

---

## Page Layout Recommendation

```
/analytics
│
├── Header: "Analytics" + date range picker (7d / 30d / 90d / all time)
│
├── Row 1 — Top KPI cards (6 cards)
│   ├── Total Leads (+ last 30d delta)
│   ├── Conversion Rate %
│   ├── Posts Published
│   ├── Blogs Published
│   ├── Approval Rate %
│   └── Active Schedules
│
├── Row 2 — Lead Generation section
│   ├── Lead Funnel (horizontal funnel: pending→emailed→followed_up→converted)
│   └── Leads Over Time (line chart, 30 days)
│
├── Row 3 — Social Posts section
│   ├── Post Status Breakdown (donut)
│   ├── Platform Distribution (bar)
│   └── Posts Per Week (bar chart, 8 weeks)
│
├── Row 4 — Blog + Approval side by side
│   ├── Blog Status Breakdown (donut) + Top Tags (horizontal bar)
│   └── Approval Queue Health (pending count, approval rate, avg review time)
│
├── Row 5 — Workflow Runs
│   ├── Success Rate by Type (grouped bar)
│   └── Run Volume Over Time (line chart, 30 days)
│
└── Row 6 — Schedules Table
    └── Full schedule list with status indicators
```

---

## Implementation Notes

### Data fetching
- Use `@tanstack/react-query` (already installed) with `queryKey: ['analytics', dateRange]`
- Fetch all tables in parallel with `Promise.all([...])`
- Cache for 5 minutes: `staleTime: 5 * 60 * 1000`
- Add a Refresh button to manually refetch

### Charts
- Use **Recharts** (already installed as a dependency)
- Recommended chart types:
  - `LineChart` — leads over time, run volume over time
  - `BarChart` — platform distribution, posts per week, success rates, top tags
  - `PieChart` / `Cell` — status donuts (post types, blog status, approval types)
  - Custom divs with width % — lead funnel, status breakdowns

### Date range filter
```js
const [range, setRange] = useState(30) // days
const since = new Date(Date.now() - range * 24 * 60 * 60 * 1000).toISOString()

// Pass `since` to all .gte('created_at', since) filters
```

### Colour palette (matches existing app)
```js
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
}

// Status colours
const STATUS_COLOURS = {
  pending_approval: '#F59E0B',
  approved_manual:  '#10B981',
  published:        '#0A2547',
  rejected:         '#EF4444',
  publish_failed:   '#EF4444',
  publishing:       '#1565C0',
}
```

### Nav item to add in `Layout.jsx`
```jsx
import { BarChart2 } from 'lucide-react'

// Add to NAV array (after Dashboard, before Leads):
{ to: '/analytics', icon: BarChart2, label: 'Analytics' }
```

### Route to add in `App.jsx`
```jsx
import Analytics from './pages/Analytics'

// Inside Routes:
<Route path="analytics" element={<Analytics />} />
```

---

## Quick-win Supabase Views (optional)

If you want to simplify the queries, create these views in Supabase SQL editor:

```sql
-- Lead funnel summary
CREATE OR REPLACE VIEW vw_lead_funnel AS
SELECT status, COUNT(*) as count FROM leads GROUP BY status;

-- Social post summary
CREATE OR REPLACE VIEW vw_social_summary AS
SELECT
  type,
  status,
  COUNT(*) as count,
  COUNT(*) FILTER (WHERE posted_at IS NOT NULL) as posted_count
FROM social_posts
GROUP BY type, status;

-- Workflow run performance
CREATE OR REPLACE VIEW vw_workflow_performance AS
SELECT
  workflow_type,
  status,
  COUNT(*) as count,
  AVG(EXTRACT(EPOCH FROM (completed_at - started_at))/60) as avg_duration_minutes
FROM workflow_runs
WHERE completed_at IS NOT NULL
GROUP BY workflow_type, status;

-- Approval health
CREATE OR REPLACE VIEW vw_approval_health AS
SELECT
  workflow_type,
  status,
  COUNT(*) as count,
  AVG(EXTRACT(EPOCH FROM (reviewed_at - created_at))/3600) as avg_review_hours
FROM approval_queue
GROUP BY workflow_type, status;
```

Then query views directly:
```js
const { data } = await supabase.from('vw_lead_funnel').select('*')
```