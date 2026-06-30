# Stellar Global Supplies — Ops Control Center

Internal operational control center and multi-agent AI workforce dashboard
for **Stellar Global Supplies**, a B2B supplier of Stainless Steel (SS) and
Mild Steel (MS) products based in Pune, India.

A Progressive Web App (installable, offline-capable) backed by a fully
serverless AWS architecture, with **seven specialised AI agents** (powered by
AWS Bedrock Claude Sonnet 4.5 / Amazon Nova Pro) grounded in live DynamoDB
business data and Supabase analytics.

---

## 📁 Repository Structure

```
stellar-ops/
├── ARCHITECTURE.md              # DynamoDB schema + system diagrams
├── DEPLOY.md                    # Complete deployment guide
├── README.md                    # This file
├── LINKEDIN_INTEGRATION.md      # LinkedIn OAuth setup guide
├── SUPABASE_INGESTION.md        # Supabase data pipeline guide
├── terraform/                   # Infrastructure as Code
│   ├── main.tf
│   ├── variables.tf
│   ├── outputs.tf
│   ├── backend.tfbackend.example
│   └── terraform.tfvars.example
├── lambda/
│   ├── presign/                 # S3 pre-signed URL generator
│   ├── ingest/                  # S3-triggered CSV/JSON → Supabase parser
│   ├── agent-router/            # Multi-agent Bedrock router + analytics API
│   ├── google-auth/             # Google OAuth 2.0 flow (Calendar + Gmail)
│   ├── email-sender/            # SES bulk email via connected Google account
│   ├── social-poster/           # LinkedIn & Facebook/Instagram posting
│   ├── s3-cleanup/              # S3 lifecycle cleanup with per-bucket retention
│   ├── dynamodb-cleanup/        # Old chat message TTL cleanup
│   ├── aws-costs/               # AWS Cost Explorer API proxy
│   ├── cur-processor/           # Cost & Usage Report processor
│   └── api-metrics/             # API monitoring metrics
├── frontend/                    # React + Vite + TypeScript PWA
│   ├── src/
│   │   ├── components/          # Dashboard, AgentPanel, DataIngestion, Analytics
│   │   │   ├── AuthPage.tsx          # Supabase login
│   │   │   ├── Dashboard.tsx         # CEO sales & purchase dashboard
│   │   │   ├── AgentPanel.tsx        # 7 AI agent chat workspace
│   │   │   ├── AwsCostDashboard.tsx  # AWS cost tracking (current month)
│   │   │   ├── WebTrafficDashboard.tsx # Website traffic (weekly view)
│   │   │   ├── MetaMarketingDashboard.tsx # Meta ad intelligence
│   │   │   ├── InventoryDashboard.tsx # Stock level monitoring
│   │   │   ├── EmailCampaignWidget.tsx # Bulk email campaigns
│   │   │   ├── LinkedInPostWidget.tsx  # LinkedIn company page posting
│   │   │   └── InstagramPostWidget.tsx # Instagram posting
│   │   ├── pages/tasks/TasksPage.tsx   # Marketing task center
│   │   ├── services/             # Analytics & AWS cost services
│   │   ├── api/client.ts         # Typed API client (all endpoints)
│   │   ├── lib/supabase.ts       # Supabase client singleton
│   │   ├── types/                # Shared TypeScript types
│   │   ├── store.ts              # Zustand state (nav, notifications, chat)
│   │   ├── sw.ts                 # Custom service worker logic
│   │   └── App.tsx               # Root component with auth routing
│   └── public/
│       ├── manifest.json
│       └── offline.html
├── supabase/                    # Supabase schema & migrations
└── .github/workflows/deploy.yml # CI/CD pipeline (13 Lambdas)
```

---

## 🏗️ Architecture Summary

```
Browser (PWA) → CloudFront → S3 (frontend — static assets)
              → API Gateway (HTTP API v2) → Lambda (agent-router)
              │                              → DynamoDB + Bedrock + Supabase
              ├─► S3 (raw-ingest/) → Lambda (ingest) → Supabase
              ├─► Lambda (google-auth) → Google OAuth → DynamoDB
              └─► Lambda (social-poster) → LinkedIn/Meta APIs
```

### Recent Updates

| Change | Description |
|--------|-------------|
| **Supabase auth in sidebar** | Sidebar now shows the actual logged-in user's name, initials, and email from Supabase instead of hardcoded "Manager" |
| **Per-bucket S3 retention** | `stellarglobal-cf-logs` → 7 days; other buckets → 2 days |
| **Web Traffic simplified** | Removed monthly toggle — always shows last 7 days (weekly view) |
| **AWS Costs simplified** | Removed month/year selector — always shows current month data |
| **13 Lambda functions** | Full serverless suite: presign, ingest, agent-router, google-auth, aws-costs, dynamodb-cleanup, email-sender, cur-processor, social-poster, api-metrics, s3-cleanup |
| **Supabase data pipeline** | CSV/JSON uploads ingested to Supabase with authenticated read policies |
| **Social media posting** | LinkedIn company page + Facebook/Instagram posting with OAuth connect flows |
| **Bulk email campaigns** | SES-based bulk email with file attachments via connected Google account |

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full DynamoDB single-table
design, access patterns, and entity schemas.

---

## 🚀 One-Time Setup

### 1. Prerequisites

- AWS account with permissions to create S3, CloudFront, Route53, API
  Gateway, Lambda, DynamoDB, IAM, SSM resources
- An existing **Route 53 hosted zone** for `stellarglobalsupplies.com`
- An **ACM certificate** issued in **us-east-1** covering
  `ops.stellarglobalsupplies.com` (required for CloudFront)
- **AWS Bedrock access** (Claude Sonnet 4.5 model — uses IAM authentication, no API key needed)
- Node.js 22+, Terraform ≥ 1.5, AWS CLI configured

### 2. Terraform state backend

Create an S3 bucket + DynamoDB table for Terraform state locking (one-time,
can be done manually or via a small bootstrap script):

```bash
aws s3 mb s3://your-terraform-state-bucket --region ap-south-1
aws s3api put-bucket-versioning --bucket your-terraform-state-bucket \
  --versioning-configuration Status=Enabled

aws dynamodb create-table \
  --table-name your-terraform-lock-table \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region ap-south-1
```

### 3. GitHub Secrets

Configure these in your repository's **Settings → Secrets and variables →
Actions**:

| Secret                       | Description                                      |
|------------------------------|---------------------------------------------------|
| `AWS_ACCESS_KEY_ID`          | IAM user/role access key with deploy permissions  |
| `AWS_SECRET_ACCESS_KEY`      | Corresponding secret key                          |
| `AWS_REGION`                 | e.g. `ap-south-1`                                  |
| `TF_BACKEND_BUCKET`          | Terraform state S3 bucket name                    |
| `TF_BACKEND_REGION`          | Region of the state bucket                        |
| `TF_BACKEND_DYNAMODB_TABLE`  | Terraform lock table name                         |
| `TF_VAR_route53_zone_id`     | Route53 hosted zone ID for stellarglobalsupplies.com |
| `TF_VAR_acm_certificate_arn` | ACM cert ARN (us-east-1)                          |
| `TF_VAR_bedrock_model_id`    | AWS Bedrock model ID (default: Claude Sonnet 4.5) |
| `TF_VAR_google_oauth_client_id`     | Google OAuth 2.0 Client ID (see step 5 below)  |
| `TF_VAR_google_oauth_client_secret` | Google OAuth 2.0 Client Secret                 |

### 4. Google OAuth — Executive Assistant Calendar/Gmail access

The Executive Assistant agent can create real Google Calendar events and
send real Gmail messages on your behalf, once you connect **your personal
Google account**.

1. Go to the [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials)
   (create a new project if you don't have one — this can be a free,
   personal Google Cloud project; no billing required for this usage tier)
2. **Enable APIs**: APIs & Services → Library → enable the **Google Calendar
   API** and the **Gmail API**
3. **OAuth consent screen**: set User type to "External", fill in the basic
   app info, and add your personal Gmail address as a **Test user** (this
   keeps the app in "Testing" mode, which is fine for personal use — tokens
   just need re-consent every 7 days unless you publish the app)
4. **Create credentials** → OAuth client ID → Application type: **Web
   application**
5. You won't have the exact redirect URI until after the first deploy. Do a
   first `terraform apply` (it will succeed even with a placeholder redirect
   URI registered), then run:
   ```bash
   terraform output google_oauth_redirect_uri
   ```
   Copy that value into the OAuth client's **Authorized redirect URIs** list
   in the Google Cloud Console, and save.
6. Copy the generated **Client ID** and **Client Secret** into
   `TF_VAR_google_oauth_client_id` / `TF_VAR_google_oauth_client_secret`
   (GitHub Secrets) or `terraform.tfvars` for local runs.

**Connecting your account in the app:** open the **AI Agents** tab → select
**Executive Assistant** → click **Connect Google** in the banner at the top
of the chat. You'll be redirected to Google's consent screen, then back to
the app. From then on, the agent can:

- `create_calendar_event` — schedule meetings on your primary calendar
- `list_upcoming_calendar_events` — check your availability
- `send_email` — send email via Gmail
- `list_recent_emails` — read recent inbox messages for meeting synopses

Your refresh token is stored encrypted at rest in DynamoDB
(`USER#<your-user-id> / GOOGLE_TOKEN#v0`), scoped to only these four actions —
the agent **cannot** read your full mailbox, delete data, or change account
settings. You can revoke access anytime via the **Disconnect** button in the
same banner, or by removing the app at
https://myaccount.google.com/permissions.

### 5. Deploy

Push to `main` — the GitHub Actions workflow will:

1. Build all 13 Lambda functions
2. Run `terraform apply` to provision/update all AWS infrastructure
3. Build the React PWA with the live API Gateway endpoint injected
4. Sync the build to S3 with correct cache headers
5. Invalidate the CloudFront cache

```bash
git push origin main
```

Or trigger manually via **Actions → Deploy → Run workflow**.

---

## 🧪 Local Development

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Create `frontend/.env.local`:
```
VITE_API_BASE_URL=https://your-api-id.execute-api.ap-south-1.amazonaws.com
```

### Lambda functions

Each Lambda has its own `package.json`:

```bash
cd lambda/agent-router
npm install
npm run build      # produces dist/handler.js (bundled, ready for zip)
npm run type-check
```

### Terraform (local plan)

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars   # fill in real values
cp backend.tfbackend.example backend.tfbackend # fill in real values

# Build lambda dist/ folders first (terraform zips them)
terraform init -backend-config=backend.tfbackend
terraform plan
```

---

## 🤖 AI Agents

| Agent                  | Focus                                                              |
|------------------------|---------------------------------------------------------------------|
| **Sales Analyst**       | Pricing trends, volume forecasting, SKU velocity                   |
| **Sales Strategist**    | Enterprise discount tiers, B2B contracts, outreach roadmaps         |
| **Business Analyst**    | Operational KPIs, margins, pipeline bottlenecks                     |
| **Cloud Engineer**      | System health, latency, AWS cost reporting                          |
| **Marketing Manager**   | LinkedIn posts, email newsletters, SEO product copy                 |
| **Executive Assistant** | Meeting agendas, calendar scheduling, follow-up synopses, Gmail     |
| **Demand Forecaster**   | Inventory requirements, seasonal trends, procurement timing         |

Every agent prompt is dynamically grounded with a live summary of sales
records, top SKUs, top customers, monthly revenue, and material split
pulled directly from DynamoDB — preventing hallucinated figures.

---

## 📊 Data Ingestion

Upload sales/purchase CSV or JSON files via the **Data Ingest** tab. Expected
CSV columns:

```
Invoice_ID, Date, Customer_Name, Product_SKU, Quantity, Unit_Price, Total_Amount, Material_Type (SS/MS)
```

Pipeline: Frontend requests a pre-signed S3 URL → uploads directly to
`raw-ingest/` → S3 `ObjectCreated` event triggers the `ingest` Lambda →
streams and validates rows → batch-writes to DynamoDB → updates monthly
analytics snapshots.

---

## 🔒 Security Notes

- Both S3 buckets are fully private; the frontend bucket is only readable by
  CloudFront via Origin Access Control (OAC)
- AWS Bedrock uses IAM role-based authentication — no API key needed. The Lambda's
  IAM role must have `bedrock:InvokeModel` permission
- All IAM roles follow least-privilege — each Lambda can only access the
  exact DynamoDB/S3/SSM resources it needs
- API Gateway CORS is locked to `https://ops.stellarglobalsupplies.com`

---

## 🛡️ Security Review & Best Practices

### ✅ What's Already Secure

1. **Authentication & Authorization**
   - Supabase authentication with email/password — users must log in to access the app
   - Row-level security policies in Supabase — users can only read their own data
   - Anonymous Supabase key (`VITE_SUPABASE_ANON_KEY`) is client-side safe — it only allows access to public data
   - Service role key (`VITE_SUPABASE_SERVICE_ROLE_KEY`) is stored as an environment variable and only used server-side in Lambda functions — never exposed to the browser

2. **AWS Infrastructure**
   - S3 buckets are **private** — no public access
   - Frontend bucket served only through CloudFront with Origin Access Control (OAC)
   - IAM roles follow least-privilege — each Lambda can only access its required resources
   - Secrets (Google OAuth client ID/secret, Supabase URL, service role key) stored in **AWS SSM Parameter Store** with encryption at rest
   - API Gateway CORS restricted to `https://ops.stellarglobalsupplies.com` — no wildcard

3. **Data Protection**
   - DynamoDB encryption at rest enabled by default
   - Google OAuth refresh tokens stored encrypted in DynamoDB (SSE)
   - S3 objects encrypted with SSE-S3 or SSE-KMS
   - HTTPS enforced via CloudFront + ACM certificate in `us-east-1`

4. **OAuth Scopes (Google Calendar/Gmail)**
   - Minimal scopes requested: `calendar.events`, `gmail.send`, `gmail.readonly`, `openid`, `email`
   - No full mailbox access, no delete permissions, no admin access
   - Tokens automatically expire after 30 days (DynamoDB TTL on messages)

5. **CI/CD Security**
   - GitHub Actions secrets encrypted at rest
   - No credentials committed to the repository
   - Terraform state stored in encrypted S3 with DynamoDB locking

---

### ⚠️ Areas for Improvement

1. **No Rate Limiting on API Gateway**
   - **Current**: API Gateway routes are open without rate limiting or throttling
   - **Risk**: Vulnerable to abuse, DDoS, or brute-force attacks
   - **Recommendation**: Enable API Gateway throttling (e.g., 100 requests/second per user) and consider AWS WAF for bot protection

2. **No Input Sanitization on Chat Messages**
   - **Current**: User messages are sent directly to Bedrock without content filtering
   - **Risk**: Prompt injection attacks, XSS if chat messages are rendered without sanitization
   - **Recommendation**: 
     - Add input validation/sanitization before rendering user messages
     - Consider AWS Bedrock Guardrails for content filtering
     - Implement length limits on user messages (e.g., max 4,000 characters)

3. **Broad CORS Configuration on S3 Cleanup Lambda**
   - **Current**: `Access-Control-Allow-Origin: *`
   - **Risk**: Any origin can make cross-origin requests to this endpoint
   - **Recommendation**: Restrict CORS to `https://ops.stellarglobalsupplies.com`

4. **No Audit Logging**
   - **Current**: No centralized audit trail for user actions (login, data uploads, agent chats, OAuth connections)
   - **Recommendation**: Enable CloudTrail for API Gateway, Lambda, and DynamoDB; log authentication events to CloudWatch or a dedicated audit table in DynamoDB

5. **No MFA Enforcement**
   - **Current**: Supabase login relies on email/password only — no MFA required
   - **Risk**: Credential stuffing, phishing attacks
   - **Recommendation**: Enable MFA in Supabase project settings (free feature)

6. **Frontend API Keys Exposed**
   - **Current**: `VITE_API_BASE_URL` and `VITE_SUPABASE_ANON_KEY` are embedded in the built JavaScript bundle
   - **Risk**: Anyone can inspect the built frontend and extract these values
   - **Note**: This is acceptable for public APIs when paired with proper backend authorization. The Supabase anon key is safe because Supabase row-level security enforces access control.

7. **Google OAuth Token Scope is Minimal but Monitor for Abuse**
   - **Current**: Restricted to Calendar events + Gmail send/readonly
   - **Risk**: If token is compromised, attacker could send emails as the user
   - **Recommendation**: 
     - Monitor Gmail "Sent" folder for unexpected activity
     - Implement a confirmation step before sending emails via the agent

8. **No Content Security Policy (CSP) Headers**
   - **Current**: No CSP headers configured
   - **Risk**: XSS attacks via malicious scripts
   - **Recommendation**: Add CSP headers via CloudFront response headers policy

9. **AWS Cost Exposure**
   - **Current**: No daily cost alerts or billing alerts configured
   - **Risk**: Unexpected cost spikes from Bedrock API abuse
   - **Recommendation**: Set up AWS Budgets alerts at 50%, 80%, and 100% of expected monthly spend

10. **Lambda IAM Roles Overly Broad**
    - **Current**: Some Lambdas may have broader permissions than needed (e.g., `agent-router` needs DynamoDB read/write + Bedrock + SSM + S3)
    - **Recommendation**: Review Terraform IAM policies regularly; split `agent-router` into multiple smaller functions if possible

---

### 📋 Security Checklist

- [ ] Enable API Gateway throttling + AWS WAF
- [x] Add input sanitization for chat messages
- [x] Restrict S3 cleanup CORS to allowlisted domain
- [ ] Enable CloudTrail + CloudWatch audit logging
- [ ] Enable MFA for all Supabase users
- [ ] Implement confirmation flow for email sending
- [x] Add CSP headers via CloudFront
- [ ] Set up AWS Budgets alerts
- [ ] Review and tighten Lambda IAM policies
- [ ] Implement rate limiting on `/agents/{id}/chat` endpoint
- [ ] Add bot detection/captcha for login page
- [ ] Regularly rotate SSM Parameter Store secrets

---

**Last security review**: June 2026  
**Next review recommended**: December 2026 (or after any major infrastructure changes)
