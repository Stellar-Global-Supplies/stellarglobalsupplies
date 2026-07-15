# Features

## Core Features

### Multi-Agent AI Workforce
**What it does:** Provides seven specialized AI agents (Sales Analyst, Sales Strategist, Business Analyst, Cloud Engineer, Marketing Manager, Executive Assistant, Demand Forecaster) that answer operational questions grounded in live business data.
**Powered by:** AWS Bedrock (Claude Sonnet 4.5 / Amazon Nova Pro) with DynamoDB-backed context injection and multi-turn conversation management via React Query.
**Why it's notable:** Each agent has a distinct system prompt and tool access. The Executive Assistant can create real Google Calendar events and send Gmail messages via OAuth. Agents prevent hallucination by injecting actual sales figures, top SKUs, and revenue metrics from DynamoDB before each LLM call.

### Real-Time Analytics Dashboard
**What it does:** Displays KPIs (total revenue, orders, inventory levels, margins) with interactive charts and filters for financial year, month, and status.
**Powered by:** Supabase PostgreSQL with materialized views (analytics_summary, monthly_revenue, top_customers, top_skus, inventory_summary) queried via React Query with 30-second stale times.
**Why it's notable:** Complex analytical queries (item margins, material splits, monthly GST) are pre-computed as database views, keeping the frontend fast. Row-level security ensures users only see authorized data.

### CSV/JSON Data Ingestion Pipeline
**What it does:** Allows uploading sales/purchase CSV files which are parsed, validated, and loaded into both DynamoDB (for agent context) and Supabase (for analytics).
**Powered by:** S3 pre-signed URLs (Lambda/presign) → S3 ObjectCreated events → Lambda/ingest (streaming parser) → DynamoDB batch writes + Supabase inserts.
**Why it's notable:** Serverless file processing with no server to manage. The ingest Lambda streams large files row-by-row to avoid memory limits, and updates monthly analytics snapshots atomically.

### Order & Quotation Management
**What it does:** Tracks orders with customer details, product specifications, quantities, costs, CGST/SGST breakdown, payment status, and delivery timelines. Manages customer quotations with expiry dates, item-level pricing, and status tracking (draft/sent/accepted/rejected).
**Powered by:** Supabase PostgreSQL with foreign key relationships (orders → customers, quotes → quote_customers) and TypeScript interfaces for type safety.
**Why it's notable:** Orders display computed totals (sale_cost + CGST + SGST) with proper Indian GST formatting. Quotations support JSONB item arrays with flexible line-item structures.

### Inventory Monitoring
**What it does:** Shows current stock levels by calculating purchased quantity minus sold quantity from purchase_items and sales_items tables.
**Powered by:** Supabase view (inventory_summary) with FULL JOIN to show items with only purchases or only sales, coalesced to zero.
**Why it's notable:** Real-time stock calculation without triggers or scheduled jobs. The view handles NULL quantities gracefully and groups by item_name with material_type.

### Social Media & Email Campaigns
**What it does:** Enables posting to LinkedIn company pages and Facebook/Instagram via OAuth, plus bulk email campaigns with file attachments via connected Google accounts.
**Powered by:** LinkedIn API · Facebook/Instagram Graph API · AWS SES · Google OAuth 2.0 (Calendar/Gmail scopes) · Lambda/social-poster and Lambda/email-sender.
**Why it's notable:** OAuth tokens are stored encrypted in DynamoDB with TTL auto-expiry. The Executive Assistant agent can trigger these actions via natural language commands.

### AWS Cost Tracking
**What it does:** Displays current month AWS costs by service with daily breakdowns and trend analysis.
**Powered by:** AWS Cost Explorer API via Lambda/aws-costs proxy (avoids CORS issues) · Recharts for visualization.
**Why it's notable:** Serverless proxy pattern avoids exposing AWS credentials to the browser. Costs are cached in React Query to minimize API calls.

## Recently Shipped
- **[July 2026]:** Quotations management page with customer linking, GST calculations, and status tracking
- **[July 2026]:** Order table enhanced with CGST, SGST, and grand total columns
- **[June 2026]:** Supabase authentication integration with user profile display in sidebar
- **[June 2026]:** Per-bucket S3 retention policies (7 days for CloudFront logs, 2 days for others)
- **[June 2026]:** Web Traffic and AWS Costs dashboards simplified to always show current period

## In Progress / Coming Soon
- Quotation PDF generation with company branding
- Bulk quotation actions (send, convert to order)
- Advanced inventory forecasting with demand predictions
- Mobile app (React Native) for field sales team
- Multi-currency support for export customers

## Developer Experience Features
- **Local dev setup:** `npm run dev` for frontend, isolated Lambda builds with `npm run build` per function
- **Type safety:** Full TypeScript coverage with strict mode, shared types between frontend and Lambda via monorepo structure
- **Hot reloading:** Vite HMR for frontend, Lambda tests run in isolation
- **IaC:** Terraform with remote state and locking, `terraform plan` previews before apply
- **CI/CD:** GitHub Actions auto-deploys on push to main (13 Lambda zips, Terraform apply, frontend build + S3 sync + CloudFront invalidation)

## Notable Performance Numbers
- Frontend bundle: ~250KB gzipped (PWA with code splitting)
- PWA offline-ready with Workbox precaching
- Lambda cold start: ~2-3 seconds (Node.js 22+ with ARM64 Graviton2)
- React Query stale time: 30 seconds for orders, 5 minutes for analytics
- DynamoDB read capacity: On-demand (auto-scaling)
- Supabase queries: <200ms p95 for analytics views