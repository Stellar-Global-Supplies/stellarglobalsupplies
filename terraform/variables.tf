variable "aws_region" {
  description = "Primary AWS region for all resources"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Project identifier prefix used in all resource names"
  type        = string
  default     = "stellar-global"
}

variable "environment" {
  description = "Deployment environment (prod | staging | dev)"
  type        = string
  default     = "prod"
  validation {
    condition     = contains(["prod", "staging", "dev"], var.environment)
    error_message = "environment must be prod, staging, or dev."
  }
}

variable "domain_name" {
  description = "Apex domain that has an active Route53 hosted zone"
  type        = string
  default     = "stellarglobalsupplies.com"
}

variable "app_subdomain" {
  description = "Subdomain for the PWA (combined: <subdomain>.<domain>)"
  type        = string
  default     = "ops"
}

variable "route53_zone_id" {
  description = "Route53 hosted zone ID for domain_name"
  type        = string
}

variable "acm_certificate_arn" {
  description = "ACM TLS certificate ARN — MUST be provisioned in us-east-1 for CloudFront"
  type        = string
}

variable "bedrock_model_id" {
  description = "AWS Bedrock model ID for AI agents (default: Amazon Nova Pro)"
  type        = string
  default     = "amazon.nova-pro-v1:0"
}

variable "google_oauth_client_id" {
  description = "Google OAuth 2.0 Client ID (Web application type) for personal Calendar/Gmail access"
  type        = string
  sensitive   = true
}

variable "google_oauth_client_secret" {
  description = "Google OAuth 2.0 Client Secret for the above Client ID"
  type        = string
  sensitive   = true
}

variable "lambda_runtime" {
  description = "Lambda runtime identifier"
  type        = string
  default     = "nodejs22.x"
}

variable "lambda_timeout_agent" {
  description = "Timeout (seconds) for the agent-router Lambda"
  type        = number
  default     = 30
}

variable "lambda_timeout_ingest" {
  description = "Timeout (seconds) for the data-ingest Lambda (allow large CSV batches)"
  type        = number
  default     = 300
}

variable "lambda_memory_mb" {
  description = "Memory (MB) for agent-router and ingest Lambdas"
  type        = number
  default     = 512
}

variable "dynamodb_table_name" {
  description = "DynamoDB single-table base name (environment suffix appended automatically)"
  type        = string
  default     = "stellar-ops"
}

variable "cloudfront_price_class" {
  description = "CloudFront price class (PriceClass_100 | PriceClass_200 | PriceClass_All)"
  type        = string
  default     = "PriceClass_200"
  validation {
    condition     = contains(["PriceClass_100", "PriceClass_200", "PriceClass_All"], var.cloudfront_price_class)
    error_message = "Invalid CloudFront price class."
  }
}

variable "raw_ingest_retention_days" {
  description = "Days to retain raw CSV/JSON uploads in S3 before expiry"
  type        = number
  default     = 90
}

variable "log_retention_days" {
  description = "CloudWatch log retention in days"
  type        = number
  default     = 1
}

variable "tags" {
  description = "Common resource tags applied to all taggable resources"
  type        = map(string)
  default = {
    Project   = "StellarGlobalOps"
    ManagedBy = "Terraform"
    Owner     = "Engineering"
  }
}

variable "analytics_bucket_name" {
  description = "External S3 bucket (already exists) containing daily-refreshed web and Meta analytics JSON reports"
  type        = string
  default     = "stellar-analytics-reports-471112840461"
}
variable "supabase_url" {
  type = string
}

variable "supabase_service_role_key" {
  type = string
  sensitive = true
}

variable "sender_email" {
  description = "Verified SES sender email address for bulk email campaigns"
  type        = string
  default     = "noreply@stellarglobalsupplies.com"
}

# ─────────────────────────────────────────────────────────────────────────
# LinkedIn OAuth 2.0 — for Company Page posting
# ─────────────────────────────────────────────────────────────────────────
variable "linkedin_client_id" {
  description = "LinkedIn OAuth 2.0 Client ID for Company Page posting"
  type        = string
  sensitive   = true
}

variable "linkedin_client_secret" {
  description = "LinkedIn OAuth 2.0 Client Secret"
  type        = string
  sensitive   = true
}

# ─────────────────────────────────────────────────────────────────────────
# Facebook & Instagram — Static Page Access Token
# ─────────────────────────────────────────────────────────────────────────
variable "facebook_page_token" {
  description = "Facebook Page Access Token (long-lived) for Facebook & Instagram posting"
  type        = string
  sensitive   = true
}

variable "facebook_page_id" {
  description = "Facebook Page ID for posting (also used for Instagram via Graph API)"
  type        = string
}
