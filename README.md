# Stellar Global Supplies — Ops Control Center

Internal operational control center and multi-agent AI workforce dashboard
for **Stellar Global Supplies**, a B2B supplier of Stainless Steel (SS) and
Mild Steel (MS) products based in Pune, India.

A Progressive Web App (installable, offline-capable) backed by a fully
serverless AWS architecture, with **seven specialised AI agents** (powered by
AWS Bedrock Claude Sonnet 4.5 / Amazon Nova Pro) grounded in live DynamoDB
business data and Supabase analytics.

---

## Table of Contents
- [Project Structure](#project-structure)
- [Tech Stack Overview](#tech-stack-overview)
- [System Architecture](#system-architecture)
- [Pages & Features](#pages--features)
- [Adding New Features](#adding-new-features)
  - [Adding a New Frontend Page](#1-adding-a-new-frontend-page)
  - [Adding a New Lambda Function](#2-adding-a-new-lambda-function)
  - [Adding New Infrastructure](#3-adding-new-infrastructure)
  - [Adding a New Database Table](#4-adding-a-new-database-table)
- [Local Development](#local-development)
- [Deployment Pipeline](#deployment-pipeline)
- [Security Notes](#security-notes)

---

## Project Structure

```
stellarglobalsupplies/
│
├── frontend/                         # React + Vite + TypeScript PWA
│   ├── src/
│   │   ├── components/               # UI pages & widgets
│   │   │   ├── AgentPanel.tsx               # 7 AI agent chat workspace
│   │   │   ├── Analytics.tsx                # Business analytics dashboard
│   │   │   ├── AuthPage.tsx                 # Supabase login page
│   │   │   ├── Dashboard.tsx                # CEO command center
│   │   │   ├── DataIngestion.tsx            # CSV/JSON upload page
│   │   │   ├── EmailCampaignWidget.tsx      # Bulk email campaigns
│   │   │   ├── FacebookPostWidget.tsx       # Facebook posting
│   │   │   ├── InstagramPostWidget.tsx      # Instagram posting
│   │   │   ├── InventoryDashboard.tsx       # Stock level monitoring
│   │   │   ├── LinkedInPostWidget.tsx       # LinkedIn posting
│   │   │   ├── MetaMarketingDashboard.tsx   # Meta ad intelligence
│   │   │   ├── OrderSummaryDashboard.tsx    # Order management
│   │   │   ├── QuotationsDashboard.tsx      # Quotations management
│   │   │   └── SalesPurchaseTable.tsx       # Sales & purchase register
│   │   ├── pages/tasks/
│   │   │   └── TasksPage.tsx          # Marketing task center
│   │   ├── services/                  # API/data service layers
│   │   │   ├── analytics.ts           # Supabase analytics queries
│   │   │   ├── orders.ts              # Order CRUD operations
│   │   │   └── quotes.ts              # Quotation CRUD operations
│   │   ├── api/client.ts              # Typed API client for Lambda endpoints
│   │   ├── lib/supabase.ts            # Supabase client singleton
│   │   ├── types/index.ts             # Shared TypeScript type definitions
│   │   ├── store.ts                   # Zustand state management
│   │   ├── App.tsx                    # Root component + routing + sidebar
│   │   ├── main.tsx                   # Entry point
│   │   ├── index.css                  # Global styles
│   │   └── sw.ts                      # Service worker (PWA)
│   └── public/
│       ├── manifest.json              # PWA manifest
│       └── offline.html               # Offline fallback
│
├── lambda/                             # 13 serverless Lambda functions
│   ├── presign/                        # S3 pre-signed URL generator
│   ├── ingest/                         # S3 → CSV/JSON parser → Supabase + DynamoDB
│   ├── agent-router/                   # Multi-agent Bedrock router
│   ├── google-auth/                    # Google OAuth 2.0 flow
│   ├── email-sender/                   # SES bulk email
│   ├── social-poster/                  # LinkedIn + Facebook/Instagram posting
│   └── ... (other internal lambdas)
│
├── terraform/                          # Infrastructure as Code
│   ├── main.tf                         # All AWS resource definitions
│   ├── variables.tf                    # Input variables
│   ├── outputs.tf                      # Output values
│   └── terraform.tfvars.example        # Variable template
│
├── supabase/
│   └── schema.sql                      # Complete Supabase schema (tables, views, RLS)
│
├── .github/workflows/
│   └── deploy.yml                      # CI/CD pipeline
│
├── ai_context/                         # AI documentation for social posts
│   ├── overview.md                     # Project overview
│   ├── tech-stack.md                   # Technology breakdown
│   ├── features.md                     # Core features
│   ├── engineering.md                  # Architecture & decisions
│   └── ui.md                          # UI documentation
│
├── ai_prompt.md                        # Guide for creating ai_context/ files
├── ARCHITECTURE.md                     # DynamoDB schema & access patterns
├── DEPLOY.md                           # Deployment guide
├── LINKEDIN_INTEGRATION.md             # LinkedIn OAuth setup
└── SUPABASE_INGESTION.md               # Data pipeline guide
```

---

## Tech Stack Overview

| Layer           | Technology                                        |
|-----------------|---------------------------------------------------|
| **Frontend**    | React 18.3.1, TypeScript 5.5, Vite 5.3.2, Tailwind CSS 3.4.6 |
| **State**       | Zustand 4.5.4, React Query 5.45.0                |
| **Backend**     | AWS Lambda (Node.js 22+, ARM64 Graviton2), API Gateway HTTP API v2 |
| **Database 1**  | Supabase (PostgreSQL 16) — analytics & auth       |
| **Database 2**  | DynamoDB — operational data & AI agent context    |
| **Storage**     | S3 — frontend hosting + raw data ingestion        |
| **AI/ML**       | AWS Bedrock — Claude Sonnet 4.5 / Amazon Nova Pro |
| **Auth**        | Supabase Auth (email/password), Google OAuth 2.0  |
| **Infrastructure** | Terraform ≥ 1.5, CloudFront CDN                 |
| **CI/CD**       | GitHub Actions (13 Lambda zips + Terraform + frontend deploy) |

---

## System Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│                       Browser (PWA)                                │
│   React + Vite + Tailwind CSS + Zustand + React Query              │
└───────────┬────────────────────────────────────┬──────────────────┘
            │ (HTTPS)                             │ (HTTPS)
            ▼                                     ▼
    ┌──────────────┐                    ┌──────────────────┐
    │  CloudFront   │                    │  API Gateway v2  │
    │    CDN        │                    │  HTTP API        │
    └──────┬───────┘                    └────────┬─────────┘
           │                                     │
           ▼                                     ▼
    ┌──────────────┐                    ┌──────────────────┐
    │ S3 (Static   │                    │  Lambda Router   │
    │   Assets)    │                    │  (agent-router)  │
    └──────────────┘                    └────────┬─────────┘
                                                 │
          ┌──────────────────────────────────────┼──────────────────────┐
          │                                      │                      │
          ▼                                      ▼                      ▼
  ┌──────────────┐                     ┌──────────────────┐   ┌──────────────┐
  │  DynamoDB    │                     │  AWS Bedrock     │   │  Supabase    │
  │  - Orders    │                     │  (Claude/Nova)   │   │  PostgreSQL  │
  │  - Quotes    │                     │  Multi-agent     │   │  - Analytics │
  │  - Chat MSG  │                     │  orchestration   │   │  - auth      │
  │  - Inventory │                     └──────────────────┘   └──────────────┘
  └──────────────┘

  Data Ingestion Pipeline:
  S3 (raw-ingest/) → Lambda (ingest) → DynamoDB + Supabase
```

### Data Flow

1. **Static content**: CloudFront → S3 (React PWA bundle)
2. **Analytics data**: Frontend → Supabase direct (read-only, RLS enforced)
3. **Operational data**: Frontend → API Gateway → Lambda → DynamoDB
4. **AI agent chat**: Frontend → API Gateway → agent-router Lambda → DynamoDB + Bedrock
5. **Data ingestion**: CSV/JSON upload → S3 pre-signed URL → Lambda (ingest) → DynamoDB + Supabase

---

## Pages & Features

| Page              | Route         | Purpose                                     |
|-------------------|---------------|---------------------------------------------|
| Command Center    | `/dashboard`  | CEO KPI dashboard with revenue charts       |
| AI Agents         | `/agents`     | 7 specialized AI agent chat workspace       |
| Data Ingest       | `/ingest`     | CSV/JSON file upload for data processing    |
| Inventory         | `/inventory`  | Stock level monitoring with alerts          |
| Analytics         | `/analytics`  | Business analytics with monthly breakdowns  |
| Sales & Purchase  | `/registers`  | Transaction register with filters           |
| Meta Marketing    | `/meta`       | Facebook/Instagram ad performance            |
| Tasks             | `/tasks`      | Marketing task management                   |
| Order Summary     | `/orders`     | Customer order tracking with GST            |
| Quotations        | `/quotations` | Customer quotations with pricing & GST      |

---

## Adding New Features

### 1. Adding a New Frontend Page

**Step 1: Add TypeScript types** → `frontend/src/types/index.ts`
```typescript
export interface NewFeature {
  id: string;
  name: string;
  // ... fields matching your database table
}
```

**Step 2: Add the NavSection** → same file
```typescript
export type NavSection = 'dashboard' | 'agents' | ... | 'your-feature';
```

**Step 3: Create a service** → `frontend/src/services/your-feature.ts`
```typescript
import { supabase } from '@/lib/supabase';
import type { NewFeature } from '@/types';

export async function fetchYourFeature(): Promise<NewFeature[]> {
  const { data, error } = await supabase
    .from('your_table')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return data ?? [];
}
```

**Step 4: Create the component** → `frontend/src/components/YourFeatureDashboard.tsx`
- Follow the pattern from `OrderSummaryDashboard.tsx` or `QuotationsDashboard.tsx`
- Use `@tanstack/react-query` for data fetching
- Use the same glass-card design pattern

**Step 5: Add routing** → `frontend/src/App.tsx`
- Import your component
- Add to `CEO_ITEMS` array with an appropriate `lucide-react` icon
- Add a `case` in the `MainContent` switch statement

### 2. Adding a New Lambda Function

**Step 1: Create the Lambda directory**
```bash
mkdir -p lambda/your-function/src
cd lambda/your-function
npm init -y
npm install --save @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb
npm install --save-dev typescript @types/aws-lambda esbuild
```

**Step 2: Add tsconfig.json**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true
  },
  "include": ["src"]
}
```

**Step 3: Create handler** → `lambda/your-function/src/handler.ts`
```typescript
import { Handler } from 'aws-lambda';
export const handler: Handler = async (event) => {
  return { statusCode: 200, body: JSON.stringify({ message: 'ok' }) };
};
```

**Step 4: Add build script to package.json**
```json
{
  "scripts": {
    "build": "tsc && esbuild dist/handler.js --bundle --minify --outfile=dist/handler.js --platform=node --target=node22"
  }
}
```

**Step 5: Wire up in Terraform** → `terraform/main.tf`
- Add a new `aws_lambda_function` resource
- Add `data.archive_file` to zip the dist/
- Add any needed IAM permissions
- Add API Gateway route if exposing via HTTP

**Step 6: Update CI/CD** → `.github/workflows/deploy.yml`
- Add build step for the new Lambda
- Add it to the deployment sequence

### 3. Adding New Infrastructure

**Step 1: Edit Terraform** → `terraform/main.tf`
```hcl
# Example: Adding a new DynamoDB table
resource "aws_dynamodb_table" "your_table" {
  name         = "your-table-name"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }
}
```

**Step 2: Add dynamic names** → `terraform/variables.tf`
```hcl
variable "your_table_name" {
  description = "Name for the new table"
  type        = string
  default     = "your-table-${terraform.workspace}"
}
```

**Step 3: Output ARNs** → `terraform/outputs.tf`
```hcl
output "your_table_arn" {
  value = aws_dynamodb_table.your_table.arn
}
```

**Step 4: Run Terraform**
```bash
cd terraform
terraform plan   # Preview changes
terraform apply  # Apply changes
```

### 4. Adding a New Database Table

**Supabase (PostgreSQL)** — `supabase/schema.sql`
```sql
create table public.your_table (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Add RLS
alter table public.your_table enable row level security;
create policy "Authenticated users can read" on public.your_table
  for select to authenticated using (true);
```

**DynamoDB** — via Terraform (see Adding New Infrastructure above)

---

## Local Development

### Frontend

```bash
cd frontend
npm install
npm run dev        # Vite dev server at localhost:5173
npm run type-check # TypeScript type checking
npm run build      # Production build
```

Create `frontend/.env.local`:
```
VITE_API_BASE_URL=https://your-api-id.execute-api.ap-south-1.amazonaws.com
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### Lambda Functions

Each Lambda has its own `package.json` and build process:

```bash
cd lambda/your-function
npm install
npm run build      # Produces dist/handler.js (bundled)
npm run type-check
```

### Terraform (local plan)

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars   # Fill in values
cp backend.tfbackend.example backend.tfbackend # Fill in values

# Build all Lambda dist/ folders first (terraform zips them)
./build-lambdas.sh  # or build each one manually

terraform init -backend-config=backend.tfbackend
terraform plan
terraform apply
```

---

## Deployment Pipeline

The GitHub Actions workflow (`.github/workflows/deploy.yml`) runs on every push to `main`:

1. **Build all 13 Lambda functions** — `npm install && npm run build` for each
2. **Terraform apply** — Provisions/updates all AWS infrastructure
3. **Build React PWA** — `npm run build` with live API URL injection
4. **S3 sync** — Upload built frontend to S3 with cache headers
5. **CloudFront invalidation** — Clear CDN cache for immediate updates

### Triggering Deploy

```bash
git push origin main                       # Auto-deploy
# OR
GitHub → Actions → Deploy → Run workflow   # Manual trigger
```

---

## Security Notes

- S3 buckets are **private** — frontend served only via CloudFront OAC
- All IAM roles follow least-privilege per Lambda function
- API Gateway CORS locked to `https://ops.stellarglobalsupplies.com`
- Supabase RLS enforces row-level access control
- Secrets stored in **AWS SSM Parameter Store** (encrypted at rest)
- Google OAuth tokens stored encrypted in DynamoDB with 30-day TTL
- HTTPS enforced via ACM certificate + CloudFront

---

## AI Agents

| Agent                  | Focus                                                              |
|------------------------|---------------------------------------------------------------------|
| **Sales Analyst**       | Pricing trends, volume forecasting, SKU velocity                   |
| **Sales Strategist**    | Enterprise discount tiers, B2B contracts, outreach roadmaps         |
| **Business Analyst**    | Operational KPIs, margins, pipeline bottlenecks                     |
| **Cloud Engineer**      | System health, latency, AWS cost reporting                          |
| **Marketing Manager**   | LinkedIn posts, email newsletters, SEO product copy                 |
| **Executive Assistant** | Meeting agendas, calendar scheduling, follow-up synopses, Gmail     |
| **Demand Forecaster**   | Inventory requirements, seasonal trends, procurement timing         |

Each agent gets a **live data snapshot** (sales records, top customers, revenue) injected into the system prompt before every Bedrock call, preventing hallucinated figures.

---

## Documentation Index

| File | Description |
|------|-------------|
| `ARCHITECTURE.md` | DynamoDB single-table design & access patterns |
| `DEPLOY.md` | One-time setup & deployment instructions |
| `LINKEDIN_INTEGRATION.md` | LinkedIn OAuth configuration |
| `SUPABASE_INGESTION.md` | Supabase data pipeline guide |
| `ai_prompt.md` | Template for creating `ai_context/` files |
| `ai_context/` | Project documentation for AI social posts |

---

## Quick Reference: Common Tasks

| Task | Command / Location |
|------|--------------------|
| Add a page | Create component in `frontend/src/components/` + add to `App.tsx` |
| Add a Supabase query | Create service in `frontend/src/services/` |
| Add a TypeScript type | Edit `frontend/src/types/index.ts` |
| Add a Lambda | Create `lambda/your-function/` + add to `terraform/main.tf` |
| Add infrastructure | Edit `terraform/main.tf` |
| Run type-check | `cd frontend && npm run type-check` |
| Run locally | `cd frontend && npm run dev` |
| Deploy | Push to `main` (auto-deploys via GitHub Actions) |
| Update Supabase schema | Edit `supabase/schema.sql` and run in Supabase SQL editor |