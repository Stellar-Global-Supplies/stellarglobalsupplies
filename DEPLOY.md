# Stellar Global Supplies — Ops Control Center
## Complete Deployment Guide (GitHub Actions — Zero Manual Steps)

Everything deploys automatically via GitHub Actions on every `git push origin main`.
You only need to do the one-time setup below — after that, every code change deploys itself.

---

## What gets deployed

| Component | What it is |
|-----------|-----------|
| S3 (frontend) | React PWA served privately via CloudFront |
| S3 (data) | Upload target for CSV/JSON sales files |
| CloudFront | CDN + HTTPS for `ops.stellarglobalsupplies.com` |
| Route53 | DNS A/AAAA alias pointing to CloudFront |
| API Gateway | HTTP API v2 — 13 routes |
| Lambda: presign | S3 pre-signed URL generator |
| Lambda: ingest | SGS CSV/JSON parser → DynamoDB (S3-triggered) |
| Lambda: agent-router | 6 AI agents (gemini-2.5-flash-lite) + Google Calendar/Gmail |
| Lambda: google-auth | Personal Google OAuth 2.0 flow |
| DynamoDB | Single-table design (sales, purchases, sessions, tokens) |
| SSM | Encrypted storage for Gemini key + Google OAuth credentials |

---

## One-Time Setup (~30 minutes)

### Step 1 — Fork / push the repo to GitHub

Push the contents of this zip to a new private GitHub repository.

```bash
cd stellar-ops
git init
git add .
git commit -m "Initial commit — Stellar Ops Control Center"
git remote add origin https://github.com/YOUR_ORG/stellar-ops.git
git push -u origin main
```

### Step 2 — Get your credentials (all free or very low cost)

| Credential | Where to get it |
|------------|----------------|
| AWS IAM credentials | IAM → Users → Create user → Attach `AdministratorAccess` (or least-privilege policy) → Security credentials → Create access key |
| Route53 Zone ID | Route53 → Hosted zones → click `stellarglobalsupplies.com` → copy Hosted zone ID |
| ACM Certificate ARN | Certificate Manager in **us-east-1** → Request → `ops.stellarglobalsupplies.com` → DNS validation → copy ARN after it turns `Issued` |
| Gemini API key | https://aistudio.google.com/app/apikey → Create API key (free tier: 500 req/day) |
| Google OAuth Client | See Step 3 below |

### Step 3 — Google OAuth (for Executive Assistant Calendar/Gmail)

1. Go to https://console.cloud.google.com → create a project (free)
2. APIs & Services → Library → enable **Google Calendar API** and **Gmail API**
3. APIs & Services → OAuth consent screen → External → fill in app name → add your Gmail as a Test user
4. APIs & Services → Credentials → Create credentials → **OAuth client ID** → Web application
5. For "Authorized redirect URIs" enter a placeholder for now: `https://placeholder.example.com`
   *(you will update this with the real URL after the first deploy — the workflow prints it)*
6. Copy the **Client ID** and **Client Secret**

### Step 4 — Add GitHub Secrets

Go to your repository → **Settings → Secrets and variables → Actions → New repository secret**

Add all 11 secrets:

| Secret name | Value |
|-------------|-------|
| `AWS_ACCESS_KEY_ID` | IAM access key ID |
| `AWS_SECRET_ACCESS_KEY` | IAM secret access key |
| `AWS_REGION` | `ap-south-1` (or your preferred region) |
| `TF_BACKEND_BUCKET` | Choose any globally unique name e.g. `stellar-tf-state-abc123` |
| `TF_BACKEND_REGION` | Same as `AWS_REGION` |
| `TF_BACKEND_DYNAMODB_TABLE` | `stellar-tf-locks` |
| `TF_VAR_route53_zone_id` | Your Route53 Zone ID |
| `TF_VAR_acm_certificate_arn` | ACM cert ARN (us-east-1) |
| `TF_VAR_gemini_api_key` | Gemini API key |
| `TF_VAR_google_oauth_client_id` | Google OAuth Client ID |
| `TF_VAR_google_oauth_client_secret` | Google OAuth Client Secret |

### Step 5 — Push and let GHA do everything

```bash
git push origin main
```

**The workflow does all of this automatically:**

```
Job 0: bootstrap    → creates S3 state bucket + DynamoDB lock table (idempotent)
Job 1: build-lambdas → builds all 4 Lambdas in parallel (presign, ingest, agent-router, google-auth)
Job 2: terraform    → terraform init → plan → apply → extracts outputs
Job 3: deploy-frontend → npm build → s3 sync (with correct cache headers) → CloudFront invalidation
Job 4: smoke-test   → hits /agents and /analytics/summary, prints live URL
```

The first run takes about **8–12 minutes**. Subsequent deploys take **4–6 minutes**.

### Step 6 — Update Google OAuth redirect URI (first deploy only)

After the first deploy, check the Job 2 (Terraform) logs — it prints:

```
════════════════════════════════════════════════════════════════
  ACTION REQUIRED (first deploy only)
  Add this Authorized redirect URI to your Google OAuth client:
  https://xxxxxxxxxx.execute-api.ap-south-1.amazonaws.com/auth/google/callback
════════════════════════════════════════════════════════════════
```

Go to https://console.cloud.google.com/apis/credentials → your OAuth client → add that URL to **Authorized redirect URIs** → Save.

You only do this once. All future deploys are fully hands-free.

---

## After deployment

### Upload your sales data

1. Open `https://ops.stellarglobalsupplies.com`
2. Go to **Data Ingest** tab
3. Drop your files: `Sales_.xls`, `Purchase.xls`, `Item_sales.xls`, `Items_Purchase.xls`
4. Each file uploads directly to S3, triggering the ingest Lambda automatically
5. Refresh the **CEO Dashboard** after ~30 seconds to see your live data

### Connect Google Account (Executive Assistant)

1. Go to **AI Agents** tab → select **Executive Assistant**
2. Click **Connect Google Account** in the yellow banner
3. Approve the consent screen — grants Calendar + Gmail access only
4. The agent can now create calendar events and send emails on your behalf

### Share with the CEO

Send the URL: `https://ops.stellarglobalsupplies.com`

No login is required for an internal tool on a private URL. If you want login protection, add an AWS Cognito hosted UI — raise this as a separate request.

---

## Re-deploys

Every `git push origin main` automatically redeploys. You can also trigger manually:

- GitHub → Actions → **Deploy — Stellar Ops Control Center** → Run workflow
- Use `tf_action: plan` to preview Terraform changes without applying

---

## Cost estimate (ap-south-1 region)

| Service | Est. monthly cost |
|---------|-------------------|
| Lambda (4 functions, ~5K invocations/month) | ₹0 (free tier) |
| DynamoDB (on-demand, ~50K read/write units) | ₹200–400 |
| S3 (frontend + data bucket, ~1 GB) | ₹50–100 |
| CloudFront (~5 GB transfer) | ₹300–500 |
| API Gateway (HTTP API, ~5K requests) | ₹50–100 |
| SSM Parameter Store | ₹0 (free tier) |
| **Total** | **~₹600–1,100 / month** |

Gemini API (gemini-2.5-flash-lite): free tier provides 500 requests/day — sufficient for a team of 2–3 using agents daily.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Terraform fails with `NoSuchBucket` | The bootstrap job failed — check Job 0 logs, verify `TF_BACKEND_BUCKET` secret |
| Lambda builds fail | Check Node 22 compatibility — run `npm ci && npm run build` locally first |
| CloudFront 403 on all pages | S3 bucket policy not applied yet — wait 2–3 min and retry |
| Agents return 502 | Gemini API key invalid or quota exceeded — check `TF_VAR_gemini_api_key` secret |
| Google OAuth `redirect_uri_mismatch` | You haven't added the redirect URI from Step 6 to Google Cloud Console |
| Analytics S3 bucket access denied | Your IAM role needs `s3:GetObject` on `stellar-analytics-reports-471112840461` |

---

## Project structure

```
stellar-ops/
├── .github/workflows/deploy.yml   ← Full automated CI/CD (this file runs everything)
├── terraform/                     ← All AWS infrastructure as code
│   ├── main.tf                    ← S3, CloudFront, Route53, API GW, Lambdas, DynamoDB, IAM
│   ├── variables.tf               ← All configurable inputs
│   ├── outputs.tf                 ← Exported values (bucket name, API URL, etc.)
│   └── terraform.tfvars.example   ← Template — copy to terraform.tfvars for local use
├── lambda/
│   ├── presign/                   ← S3 pre-signed URL generator
│   ├── ingest/                    ← SGS file format CSV/JSON parser
│   ├── agent-router/              ← AI agents + Gemini 2.5 Flash Lite + Google tools
│   └── google-auth/               ← Google OAuth flow
├── frontend/
│   ├── src/components/
│   │   ├── Dashboard.tsx          ← CEO Sales & Purchase dashboard (real FY25-26 data)
│   │   ├── AgentPanel.tsx         ← 6 AI agent chat workspace
│   │   ├── DataIngestion.tsx      ← CSV/JSON upload with progress
│   │   ├── Analytics.tsx          ← Sales analytics with charts
│   │   ├── WebTrafficDashboard.tsx ← Website traffic + security alerts
│   │   └── MetaMarketingDashboard.tsx ← Meta ad intelligence
│   └── public/
│       ├── manifest.json          ← PWA manifest (installable app)
│       └── offline.html           ← Offline fallback page
├── ARCHITECTURE.md                ← DynamoDB schema + system diagrams
└── DEPLOY.md                      ← This file
```
