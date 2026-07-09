# ────────────────────────────────────────────────────────────────────────────────
# CORE URLS
# ────────────────────────────────────────────────────────────────────────────────
output "app_url" {
  description = "Public URL of the PWA"
  value       = "https://${local.fqdn}"
}

output "cloudfront_domain" {
  description = "CloudFront distribution domain (for DNS debugging)"
  value       = aws_cloudfront_distribution.frontend.domain_name
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID — used for cache invalidation in CI"
  value       = aws_cloudfront_distribution.frontend.id
}

output "api_endpoint" {
  description = "API Gateway HTTP API base URL (set as VITE_API_BASE_URL in frontend build)"
  value       = aws_apigatewayv2_api.ops.api_endpoint
}

# ────────────────────────────────────────────────────────────────────────────────
# S3
# ────────────────────────────────────────────────────────────────────────────────
output "frontend_bucket_name" {
  description = "Frontend S3 bucket name — sync Vite build output here"
  value       = aws_s3_bucket.frontend.id
}

output "frontend_bucket_arn" {
  description = "Frontend S3 bucket ARN"
  value       = aws_s3_bucket.frontend.arn
}

output "data_bucket_name" {
  description = "Data S3 bucket name (raw-ingest/ uploads)"
  value       = aws_s3_bucket.data.id
}

output "data_bucket_arn" {
  description = "Data S3 bucket ARN"
  value       = aws_s3_bucket.data.arn
}

# ────────────────────────────────────────────────────────────────────────────────
# DYNAMODB
# ────────────────────────────────────────────────────────────────────────────────
output "dynamodb_table_name" {
  description = "DynamoDB single-table name"
  value       = aws_dynamodb_table.ops.name
}

output "dynamodb_table_arn" {
  description = "DynamoDB table ARN"
  value       = aws_dynamodb_table.ops.arn
}

# ────────────────────────────────────────────────────────────────────────────────
# LAMBDA
# ────────────────────────────────────────────────────────────────────────────────
output "lambda_presign_arn" {
  description = "Presign Lambda ARN"
  value       = aws_lambda_function.presign.arn
}

output "lambda_ingest_arn" {
  description = "Ingest Lambda ARN"
  value       = aws_lambda_function.ingest.arn
}

output "lambda_agent_router_arn" {
  description = "Agent Router Lambda ARN"
  value       = aws_lambda_function.agent_router.arn
}

output "lambda_google_auth_arn" {
  description = "Google Auth Lambda ARN"
  value       = aws_lambda_function.google_auth.arn
}

output "google_oauth_redirect_uri" {
  description = "Register this EXACT URL as an Authorized redirect URI on the Google Cloud Console OAuth Client"
  value       = local.google_oauth_redirect_uri
}

# ────────────────────────────────────────────────────────────────────────────────
# IAM ROLES (for debugging / external policy attachment)
# ────────────────────────────────────────────────────────────────────────────────
output "iam_role_presign" {
  description = "IAM role ARN for presign Lambda"
  value       = aws_iam_role.presign.arn
}

output "iam_role_ingest" {
  description = "IAM role ARN for ingest Lambda"
  value       = aws_iam_role.ingest.arn
}

output "iam_role_agent_router" {
  description = "IAM role ARN for agent-router Lambda"
  value       = aws_iam_role.agent_router.arn
}

# ────────────────────────────────────────────────────────────────────────────────
# SSM
# ────────────────────────────────────────────────────────────────────────────────
output "google_oauth_client_id_param" {
  description = "SSM parameter path for the Google OAuth Client ID"
  value       = aws_ssm_parameter.google_oauth_client_id.name
}
