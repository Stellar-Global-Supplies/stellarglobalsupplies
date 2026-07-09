terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.50"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Configure via GitHub Actions secrets or a *.tfbackend file:
  #   terraform init -backend-config=backend.tfbackend
  backend "s3" {
    key            = "stellar-global/terraform.tfstate"
    encrypt        = true
    use_lockfile   = true
  }
}

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = merge(var.tags, { Environment = var.environment })
  }
}

# ────────────────────────────────────────────────────────────────────────────────
# LOCALS
# ────────────────────────────────────────────────────────────────────────────────
locals {
  prefix     = "${var.project_name}-${var.environment}"
  fqdn       = "${var.app_subdomain}.${var.domain_name}"
  lambda_dir = "${path.module}/../lambda"

  # Registered in Google Cloud Console -> OAuth Client -> Authorized redirect URIs
  google_oauth_redirect_uri = "${aws_apigatewayv2_api.ops.api_endpoint}/auth/google/callback"
}

# ────────────────────────────────────────────────────────────────────────────────
# RANDOM SUFFIX — prevents S3 global namespace collisions
# ────────────────────────────────────────────────────────────────────────────────
resource "random_id" "suffix" {
  byte_length = 4
}

# ────────────────────────────────────────────────────────────────────────────────
# S3 — FRONTEND BUCKET (private; served exclusively via CloudFront OAC)
# ────────────────────────────────────────────────────────────────────────────────
resource "aws_s3_bucket" "frontend" {
  bucket        = "${local.prefix}-frontend-${random_id.suffix.hex}"
  force_destroy = false
}

resource "aws_s3_bucket_versioning" "frontend" {
  bucket = aws_s3_bucket.frontend.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "frontend" {
  bucket = aws_s3_bucket.frontend.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket                  = aws_s3_bucket.frontend.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Bucket policy — only CloudFront OAC may read objects
resource "aws_s3_bucket_policy" "frontend" {
  bucket = aws_s3_bucket.frontend.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid    = "AllowCloudFrontOAC"
      Effect = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action   = "s3:GetObject"
      Resource = "${aws_s3_bucket.frontend.arn}/*"
      Condition = {
        StringEquals = {
          "AWS:SourceArn" = aws_cloudfront_distribution.frontend.arn
        }
      }
    }]
  })
}

# ────────────────────────────────────────────────────────────────────────────────
# S3 — DATA BUCKET (raw-ingest uploads + optional processed exports)
# ────────────────────────────────────────────────────────────────────────────────
resource "aws_s3_bucket" "data" {
  bucket        = "${local.prefix}-data-${random_id.suffix.hex}"
  force_destroy = false
}

resource "aws_s3_bucket" "attachments" {
  bucket_prefix = "${local.prefix}-attachments-"
  force_destroy = true
}

resource "aws_s3_bucket_lifecycle_configuration" "attachments" {
  bucket = aws_s3_bucket.attachments.id
  rule {
    id     = "expire-old-attachments"
    status = "Enabled"
    filter {
      prefix = "email-attachments/"
    }
    expiration {
      days = 30
    }
  }
  rule {
    id     = "expire-social-images"
    status = "Enabled"
    filter {
      prefix = "attachments/"
    }
    expiration {
      days = 7
    }
  }
}

resource "aws_s3_bucket_cors_configuration" "attachments" {
  bucket = aws_s3_bucket.attachments.id
  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["PUT", "POST", "GET"]
    allowed_origins = ["https://${local.fqdn}"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3600
  }
}






resource "aws_s3_bucket_versioning" "data" {
  bucket = aws_s3_bucket.data.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "data" {
  bucket = aws_s3_bucket.data.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "data" {
  bucket                  = aws_s3_bucket.data.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_cors_configuration" "data" {
  bucket = aws_s3_bucket.data.id
  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["PUT", "POST"]
    allowed_origins = ["https://${local.fqdn}"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3600
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "data" {
  bucket = aws_s3_bucket.data.id

  rule {
    id     = "expire-raw-ingest"
    status = "Enabled"
    filter { prefix = "raw-ingest/" }
    expiration { days = var.raw_ingest_retention_days }
    noncurrent_version_expiration { noncurrent_days = 7 }
  }

  rule {
    id     = "expire-processed"
    status = "Enabled"
    filter { prefix = "processed/" }
    expiration { days = 365 }
  }
}

# ────────────────────────────────────────────────────────────────────────────────
# ────────────────────────────────────────────────────────────────────────────────
# CLOUDFRONT — RESPONSE HEADERS POLICY (Security Headers + CSP)
# ────────────────────────────────────────────────────────────────────────────────
resource "aws_cloudfront_response_headers_policy" "security" {
  name    = "${local.prefix}-security-headers"
  comment = "Security headers + CSP for ${local.fqdn}"

  security_headers_config {
    content_security_policy {
      content_security_policy = join(" ", [
        "default-src 'none';",
        "script-src 'self' https://www.googletagmanager.com https://www.google-analytics.com;",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;",
        "img-src 'self' data: https:;",
        "font-src 'self' https://fonts.gstatic.com;",
        "connect-src 'self' https://${local.fqdn} https://${aws_apigatewayv2_api.ops.api_endpoint} https://*.supabase.co https://fonts.googleapis.com https://fonts.gstatic.com;",
        "frame-src 'self' https://accounts.google.com https://*.supabase.co;",
        "object-src 'none';",
        "base-uri 'self';",
        "form-action 'self';",
        "upgrade-insecure-requests;",
      ])
      override = true
    }

    strict_transport_security {
      access_control_max_age_sec = 63072000
      include_subdomains         = true
      preload                    = true
      override                   = true
    }

    content_type_options {
      override = true
    }

    frame_options {
      frame_option = "DENY"
      override     = true
    }

    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }
  }
}

# CLOUDFRONT — ORIGIN ACCESS CONTROL + DISTRIBUTION
# ────────────────────────────────────────────────────────────────────────────────
resource "aws_cloudfront_origin_access_control" "frontend" {
  name                              = "${local.prefix}-oac"
  description                       = "OAC for ${local.prefix} PWA"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "frontend" {
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  aliases             = [local.fqdn]
  price_class         = var.cloudfront_price_class
  comment             = "${local.prefix} PWA"
  http_version        = "http2and3"

  origin {
    domain_name              = aws_s3_bucket.frontend.bucket_regional_domain_name
    origin_id                = "S3-${aws_s3_bucket.frontend.id}"
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend.id
  }

  # Default: long-cache for hashed JS/CSS/images
  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "S3-${aws_s3_bucket.frontend.id}"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }

    min_ttl     = 0
    default_ttl = 86400
    max_ttl     = 31536000
  }

  # HTML files — never cache (SPA routing requires fresh index.html)
  ordered_cache_behavior {
    path_pattern           = "*.html"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "S3-${aws_s3_bucket.frontend.id}"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }

    min_ttl     = 0
    default_ttl = 0
    max_ttl     = 0
  }

  # Service worker — must never be cached
  ordered_cache_behavior {
    path_pattern           = "/sw.js"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "S3-${aws_s3_bucket.frontend.id}"
    viewer_protocol_policy = "redirect-to-https"
    compress               = false

    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }

    min_ttl     = 0
    default_ttl = 0
    max_ttl     = 0
  }

  # manifest.json — short cache so updates propagate quickly
  ordered_cache_behavior {
    path_pattern           = "/manifest.json"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "S3-${aws_s3_bucket.frontend.id}"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }

    min_ttl     = 0
    default_ttl = 3600
    max_ttl     = 3600
  }

  # Redirect 403/404 to index.html (SPA client-side routing)
  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 10
  }

  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 10
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  viewer_certificate {
    acm_certificate_arn      = var.acm_certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

# ────────────────────────────────────────────────────────────────────────────────
# ROUTE 53 — ALIAS RECORDS → CLOUDFRONT
# ────────────────────────────────────────────────────────────────────────────────
resource "aws_route53_record" "app_a" {
  zone_id = var.route53_zone_id
  name    = local.fqdn
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.frontend.domain_name
    zone_id                = aws_cloudfront_distribution.frontend.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "app_aaaa" {
  zone_id = var.route53_zone_id
  name    = local.fqdn
  type    = "AAAA"

  alias {
    name                   = aws_cloudfront_distribution.frontend.domain_name
    zone_id                = aws_cloudfront_distribution.frontend.hosted_zone_id
    evaluate_target_health = false
  }
}

# ────────────────────────────────────────────────────────────────────────────────
# DYNAMODB — SINGLE TABLE
# ────────────────────────────────────────────────────────────────────────────────
resource "aws_dynamodb_table" "ops" {
  name         = "${var.dynamodb_table_name}-${var.environment}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"

attribute {
  name = "PK"
  type = "S"
}

attribute {
  name = "SK"
  type = "S"
}

attribute {
  name = "GSI1PK"
  type = "S"
}

attribute {
  name = "GSI1SK"
  type = "S"
}

attribute {
  name = "GSI2PK"
  type = "S"
}

attribute {
  name = "GSI2SK"
  type = "S"
}

  global_secondary_index {
    name            = "GSI1"
    hash_key        = "GSI1PK"
    range_key       = "GSI1SK"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "GSI2"
    hash_key        = "GSI2PK"
    range_key       = "GSI2SK"
    projection_type = "ALL"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  point_in_time_recovery { enabled = true }
  server_side_encryption  { enabled = true }

  tags = { Name = "${var.dynamodb_table_name}-${var.environment}" }
}

# ────────────────────────────────────────────────────────────────────────────────
# SSM PARAMETER STORE — GOOGLE OAUTH CREDENTIALS (SecureString)
# ────────────────────────────────────────────────────────────────────────────────
resource "aws_ssm_parameter" "google_oauth_client_id" {
  name        = "/${local.prefix}/google-oauth-client-id"
  description = "Google OAuth 2.0 Client ID for personal Calendar/Gmail access"
  type        = "SecureString"
  value       = var.google_oauth_client_id
  tags        = var.tags
}

resource "aws_ssm_parameter" "google_oauth_client_secret" {
  name        = "/${local.prefix}/google-oauth-client-secret"
  description = "Google OAuth 2.0 Client Secret for personal Calendar/Gmail access"
  type        = "SecureString"
  value       = var.google_oauth_client_secret
  tags        = var.tags
}


# ────────────────────────────────────────────────────────────────────────────────
# SSM PARAMETER STORE — SOCIAL MEDIA CREDENTIALS (SecureString)
# ────────────────────────────────────────────────────────────────────────────────
resource "aws_ssm_parameter" "linkedin_client_id" {
  name        = "/${local.prefix}/linkedin-client-id"
  description = "LinkedIn OAuth 2.0 Client ID for Company Page posting"
  type        = "SecureString"
  value       = var.linkedin_client_id
  tags        = var.tags
}

resource "aws_ssm_parameter" "linkedin_client_secret" {
  name        = "/${local.prefix}/linkedin-client-secret"
  description = "LinkedIn OAuth 2.0 Client Secret for Company Page posting"
  type        = "SecureString"
  value       = var.linkedin_client_secret
  tags        = var.tags
}

resource "aws_ssm_parameter" "facebook_page_token" {
  name        = "/${local.prefix}/facebook-page-token"
  description = "Facebook Page Access Token (long-lived) for posting"
  type        = "SecureString"
  value       = var.facebook_page_token
  tags        = var.tags
}

resource "aws_ssm_parameter" "facebook_page_id" {
  name        = "/${local.prefix}/facebook-page-id"
  description = "Facebook Page ID for posting"
  type        = "String"
  value       = var.facebook_page_id
  tags        = var.tags
}

resource "aws_ssm_parameter" "instagram_business_id" {
  name        = "/${local.prefix}/instagram-business-id"
  description = "Instagram Business/Creator Account ID (separate from Facebook Page ID)"
  type        = "SecureString"
  value       = var.instagram_business_id
  tags        = var.tags
}
# ────────────────────────────────────────────────────────────────────────────────
# IAM — SHARED LAMBDA TRUST POLICY
# ────────────────────────────────────────────────────────────────────────────────
data "aws_iam_policy_document" "lambda_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

# ---- presign Lambda role ----
resource "aws_iam_role" "presign" {
  name               = "${local.prefix}-presign-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

resource "aws_iam_role_policy" "presign" {
  name = "${local.prefix}-presign-policy"
  role = aws_iam_role.presign.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "S3Presign"
        Effect   = "Allow"
        Action   = ["s3:PutObject"]
        Resource = "${aws_s3_bucket.data.arn}/raw-ingest/*"
      },
      {
        Sid      = "S3AttachmentsPresign"
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject"]
        Resource = "${aws_s3_bucket.attachments.arn}/attachments/*"
      },
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:*:*:*"
      }
    ]
  })
}

# ---- ingest Lambda role ----
resource "aws_iam_role" "ingest" {
  name               = "${local.prefix}-ingest-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

resource "aws_iam_role_policy" "ingest" {
  name = "${local.prefix}-ingest-policy"
  role = aws_iam_role.ingest.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "S3ReadIngest"
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = "${aws_s3_bucket.data.arn}/raw-ingest/*"
      },
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:*:*:*"
      }
    ]
  })
}

# ---- agent-router Lambda role ----
resource "aws_iam_role" "agent_router" {
  name               = "${local.prefix}-agent-router-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

resource "aws_iam_role_policy" "agent_router" {
  name = "${local.prefix}-agent-router-policy"
  role = aws_iam_role.agent_router.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "DynamoReadWrite"
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem",
          "dynamodb:Query", "dynamodb:Scan", "dynamodb:BatchWriteItem"
        ]
        Resource = [
          aws_dynamodb_table.ops.arn,
          "${aws_dynamodb_table.ops.arn}/index/*"
        ]
      },
      {
        Sid      = "SSMRead"
        Effect   = "Allow"
        Action   = ["ssm:GetParameter"]
        Resource = [
          aws_ssm_parameter.google_oauth_client_id.arn,
          aws_ssm_parameter.google_oauth_client_secret.arn,
        ]
      },
      {
        Sid      = "BedrockInvoke"
        Effect   = "Allow"
        Action   = [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream",
          "aws-marketplace:Subscribe",
          "aws-marketplace:ViewSubscriptions"
        ]
        Resource = "*"
      },
      {
        Sid    = "AnalyticsS3Read"
        Effect = "Allow"
        Action = ["s3:GetObject"]
        Resource = [
          "arn:aws:s3:::${var.analytics_bucket_name}/meta/*",
          "arn:aws:s3:::${var.analytics_bucket_name}/reports/*",
        ]
      },
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:*:*:*"
      }
    ]
  })
}

# ---- email-sender Lambda role ----
resource "aws_iam_role" "email_sender" {
  name               = "${local.prefix}-email-sender-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

resource "aws_iam_role_policy" "email_sender" {
  name = "${local.prefix}-email-sender-policy"
  role = aws_iam_role.email_sender.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "DynamoDBTokens"
        Effect   = "Allow"
        Action   = ["dynamodb:Query", "dynamodb:GetItem"]
        Resource = aws_dynamodb_table.ops.arn
      },
      {
        Sid      = "S3Attachments"
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject"]
        Resource = "${aws_s3_bucket.attachments.arn}/*"
      },
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:*:*:*"
      }
    ]
  })
}

resource "aws_cloudwatch_log_group" "email_sender" {
  name              = "/aws/lambda/${local.prefix}-email-sender"
  retention_in_days = var.log_retention_days
}

data "archive_file" "email_sender" {
  type        = "zip"
  source_dir  = "${local.lambda_dir}/email-sender/dist"
  output_path = "${path.module}/.terraform-build/email-sender.zip"
}

resource "aws_lambda_function" "email_sender" {
  function_name    = "${local.prefix}-email-sender"
  role             = aws_iam_role.email_sender.arn
  handler          = "handler.handler"
  runtime          = var.lambda_runtime
  filename         = data.archive_file.email_sender.output_path
  source_code_hash = data.archive_file.email_sender.output_base64sha256
  memory_size      = 256
  timeout          = 120

  environment {
    variables = {
      DYNAMODB_TABLE       = aws_dynamodb_table.ops.name
      ATTACHMENTS_BUCKET   = aws_s3_bucket.attachments.bucket
      GOOGLE_CLIENT_ID     = var.google_oauth_client_id
      GOOGLE_CLIENT_SECRET = var.google_oauth_client_secret
      ENVIRONMENT          = var.environment
    }
  }

  depends_on = [aws_cloudwatch_log_group.email_sender]
}

# ---- social-poster Lambda role ----
resource "aws_iam_role" "social_poster" {
  name               = "${local.prefix}-social-poster-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

resource "aws_iam_role_policy" "social_poster" {
  name = "${local.prefix}-social-poster-policy"
  role = aws_iam_role.social_poster.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "DynamoDBTokens"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem", "dynamodb:Query"]
        Resource = aws_dynamodb_table.ops.arn
      },
      {
        Sid      = "SSMRead"
        Effect   = "Allow"
        Action   = ["ssm:GetParameter"]
        Resource = [
          aws_ssm_parameter.linkedin_client_id.arn,
          aws_ssm_parameter.linkedin_client_secret.arn,
          aws_ssm_parameter.facebook_page_token.arn,
          aws_ssm_parameter.facebook_page_id.arn,
          aws_ssm_parameter.instagram_business_id.arn,
        ]
      },
      {
        Sid      = "S3Attachments"
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = "${aws_s3_bucket.attachments.arn}/*"
      },
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:*:*:*"
      }
    ]
  })
}

resource "aws_cloudwatch_log_group" "social_poster" {
  name              = "/aws/lambda/${local.prefix}-social-poster"
  retention_in_days = var.log_retention_days
}

data "archive_file" "social_poster" {
  type        = "zip"
  source_dir  = "${local.lambda_dir}/social-poster/dist"
  output_path = "${path.module}/.terraform-build/social-poster.zip"
}

resource "aws_lambda_function" "social_poster" {
  function_name    = "${local.prefix}-social-poster"
  role             = aws_iam_role.social_poster.arn
  handler          = "handler.handler"
  runtime          = var.lambda_runtime
  filename         = data.archive_file.social_poster.output_path
  source_code_hash = data.archive_file.social_poster.output_base64sha256
  memory_size      = 256
  timeout          = 60

  environment {
    variables = {
      DYNAMODB_TABLE              = aws_dynamodb_table.ops.name
      ATTACHMENTS_BUCKET          = aws_s3_bucket.attachments.bucket
      LINKEDIN_CLIENT_ID_PARAM    = aws_ssm_parameter.linkedin_client_id.name
      LINKEDIN_CLIENT_SECRET_PARAM = aws_ssm_parameter.linkedin_client_secret.name
      LINKEDIN_REDIRECT_URI       = "${aws_apigatewayv2_api.ops.api_endpoint}/social/linkedin/callback"
      FACEBOOK_PAGE_TOKEN_PARAM  = aws_ssm_parameter.facebook_page_token.name
      FACEBOOK_PAGE_ID_PARAM      = aws_ssm_parameter.facebook_page_id.name
      INSTAGRAM_BUSINESS_ID_PARAM = aws_ssm_parameter.instagram_business_id.name
      FRONTEND_URL                = "https://${local.fqdn}"
      ALLOWED_ORIGIN              = "https://${local.fqdn}"
      ENVIRONMENT                 = var.environment
    }
  }

  depends_on = [aws_cloudwatch_log_group.social_poster]
}

