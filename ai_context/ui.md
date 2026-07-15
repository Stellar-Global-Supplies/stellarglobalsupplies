# UI

## Pages

### Command Center Dashboard
**Route:** /dashboard
**Purpose:** Main CEO dashboard showing high-level KPIs, sales trends, and business health at a glance
**Layout:** Grid layout with 4 KPI cards at the top (Total Revenue, Total Orders, Pending Orders, Delivered Orders), followed by line charts for revenue trends and bar charts for top customers/SKUs. Left sidebar navigation with logo and user profile. Top header with breadcrumb and notification bell.
**Key Components:** KPI cards with gradient icons, Recharts line/bar charts, date range filters, sidebar navigation with active state indicators, glass-morphism card design with dark theme
**Colors:** Dark slate background (#020617), emerald accent (#00B98E), cyan secondary (#00E5FF), glass cards with rgba backgrounds, white/light gray text
**Mobile Behavior:** Sidebar collapses to hamburger menu, cards stack vertically, charts resize to fit width, horizontal scroll for data tables

### AI Agents Workspace
**Route:** /agents
**Purpose:** Chat interface for interacting with 7 specialized AI agents for operational insights and task automation
**Layout:** Left panel showing agent list with icons and descriptions, main chat area with message bubbles, input bar at bottom. Agent cards show role badges and online status.
**Key Components:** Agent selector cards, chat message bubbles (user/assistant/system), typing indicators, tool call visualizations, connection status banner for Google OAuth
**Colors:** Dark theme with agent-specific accent colors, user messages in slate-800, assistant messages in slate-700 with emerald accents, system messages in amber
**Mobile Behavior:** Agent list becomes horizontal scrollable tabs, chat takes full width, input bar fixed at bottom

### Data Ingestion
**Route:** /ingest
**Purpose:** Upload CSV/JSON files for sales/purchase data processing
**Layout:** Drag-and-drop upload zone, file list with status indicators, progress bars for uploads, ingestion history table
**Key Components:** File upload dropzone with dashed border, file type icons, status badges (complete/error), row count display, retry buttons for failed uploads
**Colors:** Upload zone with slate-800 border, success states in emerald, error states in red, progress bars in cyan gradient
**Mobile Behavior:** Upload zone full width, file list cards instead of table rows, touch-friendly drag area

### Inventory Dashboard
**Route:** /inventory
**Purpose:** Monitor stock levels across all products with low-stock alerts
**Layout:** Summary cards (total items, low stock count, out of stock), searchable/filterable table with stock levels, material type badges
**Key Components:** Stock level progress bars, material type color badges (SS=purple, MS=cyan), search input, filter by material type, empty state illustrations
**Colors:** Stock levels: green (>100), amber (10-100), red (<10), material badges with distinct colors, dark table rows with hover states
**Mobile Behavior:** Cards stack vertically, table horizontal scroll, search bar sticky at top

### Sales & Purchase Register
**Route:** /registers
**Purpose:** View all sales and purchase transactions with filtering by type, date, and search
**Layout:** Filter bar (type, year, month, financial year), KPI cards (total sales, purchases, net position, records), search input, data table with pagination
**Key Components:** Type filter dropdown, date range selectors, KPI cards with trend indicators, table with Type badges (SALE/PURCHASE), material badges, amount formatting (₹K/₹M)
**Colors:** Sales in emerald green, purchases in indigo purple, net position dynamic (green if positive, red if negative), glass cards throughout
**Mobile Behavior:** Filters collapse into dropdown, cards 2-column grid, table horizontal scroll with sticky first column

### Order Summary
**Route:** /orders
**Purpose:** Track customer orders with status, payment, and delivery information
**Layout:** Filter bar (financial year, year, month, status), 4 KPI widgets, search bar, orders table with pagination
**Key Components:** Status badges (Order Received=indigo, Processing=amber, Ready to Dispatch=cyan, Delivered=emerald), payment status badges (Paid=green, Pending=red, Partial=amber), customer info with phone, cost breakdown (sale_cost, CGST, SGST, Total)
**Colors:** Status-specific badge colors, cost column in white, tax columns in slate-300, total in bold white, glass cards with subtle borders
**Mobile Behavior:** Filters wrap to multiple rows, KPI cards 2-column, table horizontal scroll with sticky columns

### Quotations
**Route:** /quotations
**Purpose:** Manage customer quotations with GST calculations and status tracking
**Layout:** Header with count, search bar, quotations table with pagination
**Key Components:** Search by quote number, table columns (Quote #, Customer, GST Number, Date, Expiry, Items count, Subtotal, CGST, SGST, Total, Status), pagination controls, status badges (draft=gray, sent=amber, accepted=green, rejected=red)
**Colors:** Status badges with distinct colors, financial columns right-aligned with tabular nums, quote numbers in monospace font, glass card table container
**Mobile Behavior:** Search bar full width, table horizontal scroll, pagination buttons stack vertically

### Meta Marketing Dashboard
**Route:** /meta
**Purpose:** View Meta (Facebook/Instagram) ad performance and audience insights
**Layout:** Summary metrics cards, traffic over time chart, device split donut chart, top pages table, geo distribution, peak hours heatmap
**Key Components:** Recharts area/line charts, donut charts, data tables with pagination, insight cards with recommendations, campaign performance tables
**Colors:** Meta brand colors (blue #1877F2), Instagram gradient accents, dark cards with colored chart lines, engagement metrics in emerald
**Mobile Behavior:** Charts stack vertically, cards full width, tables horizontal scroll, tabs for different metric sections

### Tasks Page
**Route:** /tasks
**Purpose:** Marketing task center for managing campaigns and activities
**Layout:** Task list with status indicators, priority badges, due dates, filter by status
**Key Components:** Task cards with checkboxes, priority badges (high=red, medium=amber, low=blue), due date indicators, progress bars, empty state
**Colors:** Priority-specific colors, completed tasks in muted slate, overdue tasks in red accent, progress bars in emerald gradient
**Mobile Behavior:** Cards full width, swipe actions for task completion, filter dropdown at top

## Design System

**Color Palette:**
- Primary: #00B98E (emerald green - brand color)
- Secondary: #00E5FF (cyan - accents and highlights)
- Background: #020617 (dark slate - main background), rgba(15, 23, 42, 0.8) (card backgrounds)
- Text: #f8fafc (primary text), #94a3b8 (secondary text), #64748b (muted text)
- Status: #10b981 (success), #f59e0b (warning), #ef4444 (error), #6366f1 (info)

**Typography:**
- Font family: System fonts (-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto)
- Font sizes: 3xl (30px - page titles), 2xl (24px - section headers), xl (20px - card titles), base (16px - body), sm (14px - secondary), 2xs (11px - labels)
- Font weights: 900 (headings), 700 (subheadings), 500 (body), 400 (secondary)

**Components:**
- Buttons: Rounded-lg (8px), slate-800 background, slate-700 hover, border border-slate-700, transition-colors, px-4 py-2 padding
- Forms: Inputs with bg-transparent, border border-slate-700, rounded-lg, px-3 py-2, focus:ring-2 focus:ring-emerald
- Cards: Glass-morphism with bg-slate-800/60, backdrop-blur, border border-slate-700/50, rounded-xl, p-5 padding
- Tables: Full width, border-b border-slate-800, hover:bg-slate-800/30, p-3 cell padding, text-xs font size
- Badges: px-2 py-0.5 rounded, text-2xs font-medium, uppercase tracking-wide

**Spacing:**
- Page padding: p-6 (24px) on desktop, p-4 (16px) on mobile
- Card spacing: space-y-6 (24px) between sections
- Grid gaps: gap-4 (16px) for cards, gap-3 (12px) for table cells
- Component padding: p-5 (20px) for cards, p-3 (12px) for table cells

**Interactions:**
- Hover states: Background color transitions (150ms ease)
- Loading: Shimmer animation on skeleton loaders
- Transitions: All interactive elements have transition-colors or transition-all
- Focus: Ring-2 ring-emerald-400 on focused inputs/buttons