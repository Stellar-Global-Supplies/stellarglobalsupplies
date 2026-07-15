# Engineering

## Architecture Pattern
Serverless event-driven architecture with modular frontend

## System Overview
The system follows a serverless-first architecture with clear separation between data ingestion, storage, and presentation layers:

```
Browser PWA (React + Vite)
    ↓ (HTTPS)
CloudFront CDN
    ↓
S3 (static frontend assets)
    ↓ (API calls)
API Gateway HTTP API v2
    ↓
Lambda Functions (13 total)
    ↓
DynamoDB (business data + chat history) + Supabase PostgreSQL (analytics) + AWS Services (S3, SES, Bedrock)
```

Data flows unidirectionally: CSV/JSON uploads → S3 → Ingest Lambda → DynamoDB + Supabase. AI agents read from DynamoDB for context, call Bedrock for inference, and write conversation history back to DynamoDB. The frontend reads analytics from Supabase and business data from DynamoDB via API Gateway.

## Key Architectural Decisions

- **Chose Supabase over pure DynamoDB for analytics** because complex analytical queries (monthly revenue, top SKUs, material splits) require JOINs and aggregations that are simpler in PostgreSQL. DynamoDB remains the source of truth for operational data and agent context.

- **Dual-write pattern for data ingestion** — writes go to both DynamoDB (for AI agent context) and Supabase (for analytics views) because each database serves different query patterns. DynamoDB provides low-latency key-value access for agents; Supabase provides SQL analytics for dashboards.

- **Serverless proxy for AWS Cost Explorer** — the aws-costs Lambda acts as a proxy to avoid CORS issues and keep AWS credentials server-side. The frontend never sees AWS keys.

- **React Query for data fetching** — chosen over Redux or SWR because it provides built-in caching, background refetching, and stale-while-revalidate semantics. The 30-second stale time for orders balances freshness with API cost.

- **PWA with Workbox** — enables offline capability and installability, critical for field operations where internet connectivity may be unreliable.

- **Row-level security in Supabase** — ensures multi-tenant data isolation without application-level checks. The anon key is safe to expose client-side because RLS enforces access control.

## Hard Problems Solved

### Real-Time Inventory Calculation
**The problem:** Inventory levels must reflect purchased quantity minus sold quantity across two tables (purchase_items, sales_items), with items that have only purchases or only sales showing zero for the missing side.
**What failed first:** Triggers on INSERT/UPDATE to maintain a running inventory counter. This created race conditions during bulk imports and required complex transaction handling.
**The solution:** A Supabase view (inventory_summary) using FULL JOIN with COALESCE to handle NULLs. The view computes stock on-read, eliminating consistency issues during bulk operations. Performance is acceptable because the view is queried infrequently (dashboard loads) and Supabase caches query plans.

### AI Agent Context Injection
**The problem:** AI agents must answer questions using actual business data (sales figures, top SKUs, customer names) without hallucinating numbers.
**What failed first:** Passing the entire DynamoDB table to the LLM context window. This exceeded token limits and was prohibitively expensive.
**The solution:** Pre-computed analytics snapshots in DynamoDB (sales summary, top customers, monthly revenue) are injected into the system prompt before each Bedrock call. The agent-router Lambda fetches these snapshots (typically <2KB) and prepends them to the conversation. This keeps token usage predictable and ensures grounded responses.

### Serverless File Ingestion at Scale
**The problem:** Users upload CSV files with 10,000+ rows. The ingest Lambda must parse, validate, and write to two databases without timing out (15-minute Lambda limit) or running out of memory (10GB limit).
**What failed first:** Loading the entire file into memory and processing in a single Lambda invocation. Files larger than ~5,000 rows caused OOM errors.
**The solution:** Streaming CSV parser that processes rows in batches of 25. Each batch is written to DynamoDB via BatchWriteItem (25 items per call) and inserted into Supabase via multi-row INSERT. The Lambda processes one batch, yields control back to the event loop, and continues. This pattern handles files of any size within Lambda's execution model.

### OAuth Token Management
**The problem:** Google OAuth refresh tokens must be stored securely, auto-expire after 30 days, and be accessible to the email-sender Lambda without exposing them to the frontend.
**What failed first:** Storing tokens in the frontend (localStorage) or passing them through API Gateway. Both approaches exposed tokens to the browser and created CORS complications.
**The solution:** Tokens are stored encrypted in DynamoDB with a TTL attribute (30 days). The google-auth Lambda handles the OAuth flow, stores the encrypted refresh token, and returns only an opaque reference ID to the frontend. The email-sender Lambda retrieves and decrypts the token server-side when needed.

## Scale & Metrics
- Active users: ~5 (internal team)
- Requests/day: ~500 (frontend + API Gateway)
- Data volume: ~50MB in DynamoDB, ~20MB in Supabase
- API p99 latency: ~800ms (agent chat with Bedrock), ~150ms (analytics queries)
- Uptime: 99.5% (CloudFront + Lambda multi-AZ)
- GitHub stars: N/A (private repo)
- Team size: 2 (founder + 1 engineer)

## Performance Wins
- Moved from client-side AWS SDK calls to Lambda proxies: eliminated CORS issues and reduced frontend bundle by 45KB
- Implemented React Query caching: reduced Supabase query load by ~70% (30-second stale time)
- Streaming CSV parser: reduced Lambda memory usage from 10GB to 512MB for 50K row files
- Supabase materialized views: reduced analytics query time from 2.3s to 180ms for monthly revenue

## What We'd Do Differently
- Start with event sourcing instead of dual-write — the current pattern of writing to two databases creates eventual consistency challenges. An event stream (Kinesis or EventBridge) would provide a single source of truth.
- Use a single database (PostgreSQL) with read replicas instead of DynamoDB + Supabase. The operational data could live in Supabase Postgres with row-level security, eliminating the dual-write complexity.
- Implement API Gateway throttling and WAF from day one rather than as an afterthought.

## Related Engineering Posts / Talks
NONE