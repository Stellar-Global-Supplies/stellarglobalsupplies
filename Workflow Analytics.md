# Stellar Global Supplies — Ops Dashboard

A standalone read-only ops dashboard that mirrors the internal workflow platform. Useful for sharing with non-technical stakeholders or displaying on a wall screen without giving access to the main app.

---

## What it shows

- Live counts: leads, social posts, blog posts, pending approvals
- Workflow run history with status and duration
- AI cost breakdown by workflow type (Nova Pro tokens)
- Social post status breakdown
- Lead pipeline status breakdown

---

## Data source

All data comes from the same `/data/dashboard` API endpoint the main app uses.
No write access — purely GET requests.

---

## Setup

### 1. Environment variables

```env
VITE_API_URL=https://your-api-gateway-url.execute-api.us-east-1.amazonaws.com/prod
```

### 2. Component: `OpsDashboard.jsx`

```jsx
import { useQuery } from '@tanstack/react-query'
import { getDashboard } from '../services/api'
import { formatDistanceToNow } from 'date-fns'

const WF_LABELS = {
  lead_generation:      'Lead Generation',
  lead_email_existing:  'Lead Re-email',
  social_product:       'Product Post',
  social_tech:          'Tech Post',
  blog:                 'Blog Post',
}

const STATUS_COLOR = {
  succeeded: '#22c55e',
  running:   '#3b82f6',
  failed:    '#ef4444',
  stopped:   '#94a3b8',
  timed_out: '#f59e0b',
}

function StatCard({ label, value, sub, color = '#0A2547' }) {
  return (
    <div style={{
      background: '#fff', borderRadius: 16, padding: '20px 24px',
      border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.06)'
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 32, fontWeight: 700, color, lineHeight: 1 }}>{value ?? '—'}</div>
      {sub && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

function CostBar({ label, cost, totalCost }) {
  const pct = totalCost > 0 ? (cost / totalCost) * 100 : 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
      <div style={{ width: 120, fontSize: 12, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</div>
      <div style={{ flex: 1, background: '#f1f5f9', borderRadius: 4, height: 8 }}>
        <div style={{ width: `${pct}%`, height: 8, borderRadius: 4, background: '#0A2547', transition: 'width 0.4s' }} />
      </div>
      <div style={{ width: 60, textAlign: 'right', fontSize: 12, fontWeight: 600, color: '#0A2547' }}>${cost.toFixed(4)}</div>
    </div>
  )
}

function RunRow({ run }) {
  const dot = STATUS_COLOR[run.status] || '#94a3b8'
  const duration = run.completed_at
    ? `${Math.round((new Date(run.completed_at) - new Date(run.started_at)) / 1000)}s`
    : 'running…'
  const cost = parseFloat(run.cost_usd || 0)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', borderBottom: '1px solid #f1f5f9' }}>
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: dot, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: '#0A2547' }}>
          {WF_LABELS[run.workflow_type] || run.workflow_type}
        </div>
        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
          {formatDistanceToNow(new Date(run.started_at), { addSuffix: true })} · {duration}
          {cost > 0 && ` · $${cost.toFixed(4)}`}
        </div>
      </div>
      <div style={{
        fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 20,
        background: run.status === 'succeeded' ? '#f0fdf4' : run.status === 'failed' ? '#fef2f2' : '#f8fafc',
        color: run.status === 'succeeded' ? '#16a34a' : run.status === 'failed' ? '#dc2626' : '#64748b',
        border: `1px solid ${run.status === 'succeeded' ? '#bbf7d0' : run.status === 'failed' ? '#fecaca' : '#e2e8f0'}`,
      }}>
        {run.status}
      </div>
    </div>
  )
}

export default function OpsDashboard() {
  const { data, isLoading, dataUpdatedAt } = useQuery({
    queryKey: ['ops-dashboard'],
    queryFn:  getDashboard,
    refetchInterval: 60_000,
  })

  const stats    = data || {}
  const cost     = stats.cost || {}
  const totalCost = cost.total_usd || 0
  const costByType = cost.by_type || {}
  const runs     = stats.workflow_runs || []

  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
    : '—'

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>

      {/* Header */}
      <div style={{ background: '#0A2547', padding: '16px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 32, height: 32, borderRadius: 10, background: '#F59E0B', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: '#0A2547', fontSize: 16 }}>S</div>
          <div>
            <div style={{ color: '#fff', fontWeight: 700, fontSize: 16 }}>Stellar Global Supplies</div>
            <div style={{ color: '#94a3b8', fontSize: 12 }}>Ops Dashboard · Live</div>
          </div>
        </div>
        <div style={{ color: '#64748b', fontSize: 12 }}>Last updated: {lastUpdated} IST · auto-refreshes every 60s</div>
      </div>

      <div style={{ padding: '32px', maxWidth: 1200, margin: '0 auto' }}>

        {/* Stat cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 32 }}>
          <StatCard label="Total Leads"    value={stats.leads?.total ?? '—'}        sub={`${stats.leads?.by_status?.emailed ?? 0} emailed`}      color="#1565C0" />
          <StatCard label="Social Posts"   value={stats.social_posts?.total ?? '—'} sub={`${stats.social_posts?.by_status?.posted ?? 0} posted`}  color="#0A2547" />
          <StatCard label="Blog Posts"     value={stats.blogs?.total ?? '—'}         sub={`${stats.blogs?.by_status?.pr_created ?? 0} PRs open`}   color="#d97706" />
          <StatCard label="Pending Review" value={stats.pending_approvals ?? '—'}   sub="awaiting approval"                                         color="#dc2626" />
        </div>

        {/* Middle row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 32 }}>

          {/* Lead pipeline */}
          <div style={{ background: '#fff', borderRadius: 16, padding: 20, border: '1px solid #e2e8f0' }}>
            <div style={{ fontWeight: 600, color: '#0A2547', fontSize: 14, marginBottom: 16 }}>Lead Pipeline</div>
            {Object.entries(stats.leads?.by_status || {}).map(([status, count]) => (
              <div key={status} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontSize: 12, color: '#64748b', textTransform: 'capitalize' }}>{status.replace(/_/g, ' ')}</span>
                <span style={{ fontWeight: 700, color: '#0A2547', fontSize: 14 }}>{count}</span>
              </div>
            ))}
            {!Object.keys(stats.leads?.by_status || {}).length && (
              <div style={{ fontSize: 12, color: '#cbd5e1', textAlign: 'center', padding: '20px 0' }}>No leads yet</div>
            )}
          </div>

          {/* Social posts */}
          <div style={{ background: '#fff', borderRadius: 16, padding: 20, border: '1px solid #e2e8f0' }}>
            <div style={{ fontWeight: 600, color: '#0A2547', fontSize: 14, marginBottom: 16 }}>Social Posts</div>
            {Object.entries(stats.social_posts?.by_status || {}).map(([status, count]) => (
              <div key={status} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontSize: 12, color: '#64748b', textTransform: 'capitalize' }}>{status.replace(/_/g, ' ')}</span>
                <span style={{ fontWeight: 700, color: '#0A2547', fontSize: 14 }}>{count}</span>
              </div>
            ))}
            {!Object.keys(stats.social_posts?.by_status || {}).length && (
              <div style={{ fontSize: 12, color: '#cbd5e1', textAlign: 'center', padding: '20px 0' }}>No posts yet</div>
            )}
          </div>

          {/* AI Cost */}
          <div style={{ background: '#fff', borderRadius: 16, padding: 20, border: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <div style={{ fontWeight: 600, color: '#0A2547', fontSize: 14 }}>AI Costs</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>Nova Pro · all time</div>
            </div>
            {totalCost > 0 ? (
              <>
                <div style={{ fontSize: 28, fontWeight: 700, color: '#0A2547', marginBottom: 16 }}>${totalCost.toFixed(4)}</div>
                {Object.entries(costByType).sort(([,a],[,b]) => b - a).map(([type, cost]) => (
                  <CostBar key={type} label={WF_LABELS[type] || type} cost={cost} totalCost={totalCost} />
                ))}
                <div style={{ fontSize: 11, color: '#cbd5e1', marginTop: 12, textAlign: 'center' }}>FLUX images via Gradio = free</div>
              </>
            ) : (
              <div style={{ fontSize: 12, color: '#cbd5e1', textAlign: 'center', padding: '24px 0' }}>
                No cost data yet — run a workflow first
              </div>
            )}
          </div>
        </div>

        {/* Recent runs */}
        <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', fontWeight: 600, color: '#0A2547', fontSize: 14 }}>
            Recent Workflow Runs
          </div>
          {runs.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: '#cbd5e1', fontSize: 13 }}>No runs yet</div>
          ) : (
            runs.map(run => <RunRow key={run.id} run={run} />)
          )}
        </div>

      </div>
    </div>
  )
}
```

### 3. Add to router (App.jsx)

```jsx
import OpsDashboard from './pages/OpsDashboard'

// Inside <Routes>:
<Route path="/ops" element={<OpsDashboard />} />
```

### 4. Optional: public route (no auth)

If you want the ops dashboard accessible without login (e.g. wall screen), wrap it separately outside the `<AuthGuard>` component in App.jsx:

```jsx
<Routes>
  <Route path="/ops" element={<OpsDashboard />} />   {/* public */}
  <Route element={<AuthGuard />}>
    {/* all other routes */}
  </Route>
</Routes>
```

---

## Notes

- Refreshes every 60 seconds automatically
- Reads from the same API as the main app — no extra backend needed
- Cost data only appears after running `005_cost_tracking.sql` migration
- To display on a wall screen: open `/ops` in a browser in fullscreen mode