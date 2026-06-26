# Stellar Global Supplies — Ops Control Center

Internal operational control center and multi-agent AI workforce dashboard
for **Stellar Global Supplies**, a B2B supplier of Stainless Steel (SS) and
Mild Steel (MS) products.

A Progressive Web App (installable, offline-capable) backed by a fully
serverless AWS architecture, with six specialised AI agents (powered by
AWS Bedrock Claude Sonnet 4.5) grounded in live DynamoDB business data.

---

## 📁 Repository Structure

```
stellar-ops/
├── ARCHITECTURE.md              # DynamoDB schema + system diagrams
├── terraform/                   # Infrastructure as Code
│   ├── main.tf
│   ├── variables.tf
│   ├── outputs.tf
│   ├── backend.tfbackend.example
│   └── terraform.tfvars.example
├── lambda/
│   ├── presign/                 # S3 pre-signed URL generator
│   ├── ingest/                  # S3-triggered CSV/JSON → DynamoDB parser
│   └── agent-router/            # Multi-agent Bedrock router + analytics API
├── frontend/                    # React + Vite + TypeScript PWA
│   ├── src/
│   │   ├── components/          # Dashboard, AgentPanel, DataIngestion, Analytics
│   │   ├── api/                 # Typed API client
│   │   ├── types/                # Shared TypeScript types
│   │   ├── store.ts              # Zustand state
│   │   ├── sw.ts                  # Custom service worker logic
│   │   └── App.tsx
│   └── public/
│       ├── manifest.json
│       └── offline.html
└── .github/workflows/deploy.yml # CI/CD pipeline
```

---

## 🏗️ Architecture Summary

```
Browser (PWA) → CloudFront → S3 (frontend)
              → API Gateway (HTTP API) → Lambda (agent-router) → DynamoDB + Bedrock
              → S3 (data bucket, raw-ingest/) → Lambda (ingest) → DynamoDB
```

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
(`USER#manager-001 / GOOGLE_TOKEN#v0`), scoped to only these four actions —
the agent **cannot** read your full mailbox, delete data, or change account
settings. You can revoke access anytime via the **Disconnect** button in the
same banner, or by removing the app at
https://myaccount.google.com/permissions.

### 5. Deploy

Push to `main` — the GitHub Actions workflow will:

1. Build all three Lambda functions (`presign`, `ingest`, `agent-router`)
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
| **Executive Assistant** | Meeting agendas, calendar scheduling, follow-up synopses             |

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
