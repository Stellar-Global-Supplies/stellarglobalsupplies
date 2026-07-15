# Tech Stack

## Language(s)
TypeScript 5.5, Python 3.12 (Lambda), HCL (Terraform)

## Frontend
React 18.3.1 · Vite 5.3.2 · TypeScript · Tailwind CSS 3.4.6 · Zustand 4.5.4 (state management) · React Query 5.45.0 (data fetching) · date-fns 3.6.0 · Lucide React 0.400.0 (icons) · PWA with Workbox 7.1.0

## Backend / API
AWS Lambda (Node.js 22+ runtime) · API Gateway HTTP API v2 · Serverless architecture with 13 Lambda functions

## Database & Storage
PostgreSQL 16 (Supabase) · DynamoDB (AWS) · S3-compatible object storage (AWS S3)

## AI / ML
AWS Bedrock (Claude Sonnet 4.5 / Amazon Nova Pro) · Multi-agent orchestration with specialized agents for sales, business analysis, cloud engineering, marketing, executive assistance, and demand forecasting

## Infrastructure & Cloud
AWS (ap-south-1 region) · CloudFront CDN · S3 (static hosting + raw-ingest bucket) · API Gateway · Lambda · DynamoDB · Terraform ≥ 1.5 (IaC) · GitHub Actions (CI/CD)

## CI/CD & Observability
GitHub Actions · Terraform Cloud/remote state · CloudWatch (Lambda logs) · CloudTrail (audit logging) · AWS Cost Explorer API

## Auth & Security
Supabase Auth (email/password) · Row-level security policies · AWS IAM (least-privilege roles) · AWS SSM Parameter Store (secrets) · Google OAuth 2.0 (Calendar/Gmail integration) · ACM certificate (HTTPS)

## Key Third-Party Integrations
Supabase (PostgreSQL + auth) · AWS Bedrock (AI/ML) · LinkedIn API (company page posting) · Facebook/Instagram Graph API · Google Calendar API · Gmail API · AWS SES (email sending) · AWS Cost Explorer

## Package Manager & Dev Tooling
npm (frontend + Lambda functions) · ESLint 8.57.0 · Prettier (auto-formatting) · Vitest (testing) · Playwright (E2E testing)