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

# ---- dynamodb-cleanup Lambda role ----
resource "aws_iam_role" "dynamodb_cleanup" {
  name               = "${local.prefix}-dynamodb-cleanup-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

resource "aws_iam_role_policy" "dynamodb_cleanup" {
  name = "${local.prefix}-dynamodb-cleanup-policy"
  role = aws_iam_role.dynamodb_cleanup.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "DynamoReadWrite"
        Effect   = "Allow"
        Action   = ["dynamodb:Scan", "dynamodb:BatchWriteItem"]
        Resource = aws_dynamodb_table.ops.arn
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

# ---- google-auth Lambda role ----
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

# ---- cur-processor Lambda role ----
resource "aws_iam_role" "cur_processor" {
  name               = "${local.prefix}-cur-processor-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

resource "aws_iam_role_policy" "cur_processor" {
  name = "${local.prefix}-cur-processor-policy"
  role = aws_iam_role.cur_processor.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "S3RawAccess"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:ListBucket"]
        Resource = [
          "arn:aws:s3:::stellarglobal-costing-bucket",
          "arn:aws:s3:::stellarglobal-costing-bucket/*"
        ]
      },
      {
        Sid      = "S3ProcessedAccess"
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"]
        Resource = "arn:aws:s3:::stellarglobal-costing-bucket/processed/*"
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

resource "aws_cloudwatch_log_group" "cur_processor" {
  name              = "/aws/lambda/${local.prefix}-cur-processor"
  retention_in_days = var.log_retention_days
}

data "archive_file" "cur_processor" {
  type        = "zip"
  source_dir  = "${local.lambda_dir}/cur-processor/dist"
  output_path = "${path.module}/.terraform-build/cur-processor.zip"
}


# ---- api-metrics Lambda role ----
resource "aws_iam_role" "api_metrics" {
  name               = "${local.prefix}-api-metrics-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

resource "aws_iam_role_policy" "api_metrics" {
  name = "${local.prefix}-api-metrics-policy"
  role = aws_iam_role.api_metrics.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "CloudWatchRead"
        Effect   = "Allow"
        Action   = ["cloudwatch:GetMetricData", "cloudwatch:ListMetrics"]
        Resource = "*"
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

resource "aws_cloudwatch_log_group" "api_metrics" {
  name              = "/aws/lambda/${local.prefix}-api-metrics"
  retention_in_days = var.log_retention_days
}

data "archive_file" "api_metrics" {
  type        = "zip"
  source_dir  = "${local.lambda_dir}/api-metrics/dist"
  output_path = "${path.module}/.terraform-build/api-metrics.zip"
}

resource "aws_lambda_function" "api_metrics" {
  function_name    = "${local.prefix}-api-metrics"
  role             = aws_iam_role.api_metrics.arn
  handler          = "handler.handler"
  runtime          = var.lambda_runtime
  filename         = data.archive_file.api_metrics.output_path
  source_code_hash = data.archive_file.api_metrics.output_base64sha256
  memory_size      = 256
  timeout          = 30

  environment {
    variables = {
      API_NAME = aws_apigatewayv2_api.ops.name
      ENVIRONMENT = var.environment
    }
  }

  depends_on = [aws_cloudwatch_log_group.api_metrics]
}

# ---- api-metrics API Integration ----
resource "aws_apigatewayv2_integration" "api_metrics" {
  api_id                 = aws_apigatewayv2_api.ops.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api_metrics.invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 10000
}

resource "aws_apigatewayv2_route" "api_metrics" {
  api_id    = aws_apigatewayv2_api.ops.id
  route_key = "GET /api/metrics/summary"
  target    = "integrations/${aws_apigatewayv2_integration.api_metrics.id}"
}

resource "aws_apigatewayv2_route" "api_metrics_options" {
  api_id    = aws_apigatewayv2_api.ops.id
  route_key = "OPTIONS /api/metrics/summary"
  target    = "integrations/${aws_apigatewayv2_integration.api_metrics.id}"
}

resource "aws_lambda_permission" "apigw_api_metrics" {
  statement_id  = "AllowAPIGWInvokeApiMetrics"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api_metrics.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.ops.execution_arn}/*/*"
}

resource "aws_lambda_function" "cur_processor" {
  function_name    = "${local.prefix}-cur-processor"
  role             = aws_iam_role.cur_processor.arn
  handler          = "handler.handler"
  runtime          = var.lambda_runtime
  filename         = data.archive_file.cur_processor.output_path
  source_code_hash = data.archive_file.cur_processor.output_base64sha256
  memory_size      = 512
  timeout          = 300

  environment {
    variables = {
      RAW_CUR_BUCKET       = "stellarglobal-costing-bucket"
      PROCESSED_CUR_BUCKET = "stellarglobal-costing-bucket"
      ENVIRONMENT          = var.environment
    }
  }

  depends_on = [aws_cloudwatch_log_group.cur_processor]
}






# EventBridge rule to trigger CUR processing daily at 7 AM IST (1:30 AM UTC)
resource "aws_cloudwatch_event_rule" "cur_daily_processing" {
  name                = "${local.prefix}-cur-daily-processing"
  description         = "Triggers cur-processor Lambda daily at 7 AM IST"
  schedule_expression = "cron(30 1 * * ? *)"
}

resource "aws_cloudwatch_event_target" "cur_daily_processing" {
  rule      = aws_cloudwatch_event_rule.cur_daily_processing.name
  arn       = aws_lambda_function.cur_processor.arn
}

resource "aws_lambda_permission" "eventbridge_cur_processor" {
  statement_id  = "AllowEventBridgeInvokeCURProcessor"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.cur_processor.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.cur_daily_processing.arn
}


resource "aws_iam_role" "google_auth" {
  name               = "${local.prefix}-google-auth-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

resource "aws_iam_role_policy" "google_auth" {
  name = "${local.prefix}-google-auth-policy"
  role = aws_iam_role.google_auth.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "DynamoWriteToken"
        Effect   = "Allow"
        Action   = ["dynamodb:PutItem", "dynamodb:GetItem", "dynamodb:DeleteItem"]
        Resource = aws_dynamodb_table.ops.arn
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
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:*:*:*"
      }
    ]
  })
}

# ────────────────────────────────────────────────────────────────────────────────
# LAMBDA — ZIP ARCHIVES (CI builds dist/ before terraform apply)
# ────────────────────────────────────────────────────────────────────────────────
data "archive_file" "presign" {
  type        = "zip"
  source_dir  = "${local.lambda_dir}/presign/dist"
  output_path = "${path.module}/.terraform-build/presign.zip"
}

data "archive_file" "ingest" {
  type        = "zip"
  source_dir  = "${local.lambda_dir}/ingest/dist"
  output_path = "${path.module}/.terraform-build/ingest.zip"
}

data "archive_file" "agent_router" {
  type        = "zip"
  source_dir  = "${local.lambda_dir}/agent-router/dist"
  output_path = "${path.module}/.terraform-build/agent-router.zip"
}

data "archive_file" "dynamodb_cleanup" {
  type        = "zip"
  source_dir  = "${local.lambda_dir}/dynamodb-cleanup/dist"
  output_path = "${path.module}/.terraform-build/dynamodb-cleanup.zip"
}

data "archive_file" "google_auth" {
  type        = "zip"
  source_dir  = "${local.lambda_dir}/google-auth/dist"
  output_path = "${path.module}/.terraform-build/google-auth.zip"
}

# ────────────────────────────────────────────────────────────────────────────────
# CLOUDWATCH LOG GROUPS — created before Lambdas to set retention
# ────────────────────────────────────────────────────────────────────────────────
resource "aws_cloudwatch_log_group" "presign" {
  name              = "/aws/lambda/${local.prefix}-presign"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "ingest" {
  name              = "/aws/lambda/${local.prefix}-ingest"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "agent_router" {
  name              = "/aws/lambda/${local.prefix}-agent-router"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "dynamodb_cleanup" {
  name              = "/aws/lambda/${local.prefix}-dynamodb-cleanup"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "google_auth" {
  name              = "/aws/lambda/${local.prefix}-google-auth"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "apigw" {
  name              = "/aws/apigateway/${local.prefix}"
  retention_in_days = var.log_retention_days
}

# ────────────────────────────────────────────────────────────────────────────────
# LAMBDA — FUNCTIONS
# ────────────────────────────────────────────────────────────────────────────────
resource "aws_lambda_function" "presign" {
  function_name    = "${local.prefix}-presign"
  role             = aws_iam_role.presign.arn
  handler          = "handler.handler"
  runtime          = var.lambda_runtime
  filename         = data.archive_file.presign.output_path
  source_code_hash = data.archive_file.presign.output_base64sha256
  memory_size      = 256
  timeout          = 10

  environment {
    variables = {
      DATA_BUCKET    = aws_s3_bucket.data.id
      ALLOWED_ORIGIN = "https://${local.fqdn}"
      ENVIRONMENT    = var.environment
    }
  }

  depends_on = [aws_cloudwatch_log_group.presign]
}

resource "aws_lambda_function" "ingest" {
  function_name    = "${local.prefix}-ingest"
  role             = aws_iam_role.ingest.arn
  handler          = "handler.handler"
  runtime          = var.lambda_runtime
  filename         = data.archive_file.ingest.output_path
  source_code_hash = data.archive_file.ingest.output_base64sha256
  memory_size      = var.lambda_memory_mb
  timeout          = var.lambda_timeout_ingest

  environment {
    variables = {
      SUPABASE_URL              = var.supabase_url
      SUPABASE_SERVICE_ROLE_KEY = var.supabase_service_role_key
    }
  }

  depends_on = [aws_cloudwatch_log_group.ingest]
}

resource "aws_lambda_function" "agent_router" {
  function_name    = "${local.prefix}-agent-router"
  role             = aws_iam_role.agent_router.arn
  handler          = "handler.handler"
  runtime          = var.lambda_runtime
  filename         = data.archive_file.agent_router.output_path
  source_code_hash = data.archive_file.agent_router.output_base64sha256
  memory_size      = var.lambda_memory_mb
  timeout          = var.lambda_timeout_agent

  environment {
    variables = {
      DYNAMODB_TABLE              = aws_dynamodb_table.ops.name
      BEDROCK_MODEL               = var.bedrock_model_id
      GOOGLE_CLIENT_ID_PARAM      = aws_ssm_parameter.google_oauth_client_id.name
      GOOGLE_CLIENT_SECRET_PARAM  = aws_ssm_parameter.google_oauth_client_secret.name
      ANALYTICS_BUCKET            = var.analytics_bucket_name
      SUPABASE_URL                = var.supabase_url
      SUPABASE_SERVICE_ROLE_KEY   = var.supabase_service_role_key
      ALLOWED_ORIGIN              = "https://${local.fqdn}"
      ENVIRONMENT                 = var.environment
    }
  }

  depends_on = [aws_cloudwatch_log_group.agent_router]
}

resource "aws_lambda_function" "dynamodb_cleanup" {
  function_name    = "${local.prefix}-dynamodb-cleanup"
  role             = aws_iam_role.dynamodb_cleanup.arn
  handler          = "handler.handler"
  runtime          = var.lambda_runtime
  filename         = data.archive_file.dynamodb_cleanup.output_path
  source_code_hash = data.archive_file.dynamodb_cleanup.output_base64sha256
  memory_size      = 256
  timeout          = 120

  environment {
    variables = {
      DYNAMODB_TABLE = aws_dynamodb_table.ops.name
      ENVIRONMENT    = var.environment
    }
  }

  depends_on = [aws_cloudwatch_log_group.dynamodb_cleanup]
}

# EventBridge rule to trigger cleanup Lambda every morning at 9am IST (3:30 UTC)
resource "aws_cloudwatch_event_rule" "dynamodb_daily_cleanup" {
  name                = "${local.prefix}-dynamodb-daily-cleanup"
  description         = "Triggers dynamodb-cleanup Lambda every morning at 9am IST"
  schedule_expression = "cron(30 3 * * ? *)"
}

resource "aws_cloudwatch_event_target" "dynamodb_daily_cleanup" {
  rule      = aws_cloudwatch_event_rule.dynamodb_daily_cleanup.name
  arn       = aws_lambda_function.dynamodb_cleanup.arn
}

resource "aws_lambda_permission" "eventbridge_dynamodb_cleanup" {
  statement_id  = "AllowEventBridgeInvokeDynamoDBCleanup"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.dynamodb_cleanup.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.dynamodb_daily_cleanup.arn
}

resource "aws_lambda_function" "google_auth" {
  function_name    = "${local.prefix}-google-auth"
  role             = aws_iam_role.google_auth.arn
  handler          = "handler.handler"
  runtime          = var.lambda_runtime
  filename         = data.archive_file.google_auth.output_path
  source_code_hash = data.archive_file.google_auth.output_base64sha256
  memory_size      = 256
  timeout          = 15

  environment {
    variables = {
      DYNAMODB_TABLE             = aws_dynamodb_table.ops.name
      GOOGLE_CLIENT_ID_PARAM     = aws_ssm_parameter.google_oauth_client_id.name
      GOOGLE_CLIENT_SECRET_PARAM = aws_ssm_parameter.google_oauth_client_secret.name
      GOOGLE_REDIRECT_URI        = local.google_oauth_redirect_uri
      FRONTEND_URL               = "https://${local.fqdn}"
      ENVIRONMENT                = var.environment
    }
  }

  depends_on = [aws_cloudwatch_log_group.google_auth]
}

# ────────────────────────────────────────────────────────────────────────────────
# S3 EVENT NOTIFICATION → INGEST LAMBDA
# ────────────────────────────────────────────────────────────────────────────────
resource "aws_lambda_permission" "s3_ingest_csv" {
  statement_id  = "AllowS3InvokeIngestCSV"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.ingest.function_name
  principal     = "s3.amazonaws.com"
  source_arn    = aws_s3_bucket.data.arn
}

resource "aws_s3_bucket_notification" "ingest" {
  bucket = aws_s3_bucket.data.id

  lambda_function {
    lambda_function_arn = aws_lambda_function.ingest.arn
    events              = ["s3:ObjectCreated:*"]
    filter_prefix       = "raw-ingest/"
    filter_suffix       = ".csv"
  }

  lambda_function {
    lambda_function_arn = aws_lambda_function.ingest.arn
    events              = ["s3:ObjectCreated:*"]
    filter_prefix       = "raw-ingest/"
    filter_suffix       = ".json"
  }

  depends_on = [aws_lambda_permission.s3_ingest_csv]
}

# ────────────────────────────────────────────────────────────────────────────────
# API GATEWAY v2 (HTTP API) — Built-in CORS, auto-deploy
# ────────────────────────────────────────────────────────────────────────────────
resource "aws_apigatewayv2_api" "ops" {
  name          = "${local.prefix}-api"
  protocol_type = "HTTP"
  description   = "Stellar Global Ops HTTP API"

  cors_configuration {
    allow_credentials = false
    allow_headers     = ["Content-Type", "Authorization", "X-Amz-Date", "X-Api-Key"]
    allow_methods     = ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
    allow_origins     = ["https://${local.fqdn}"]
    expose_headers    = ["Content-Length", "X-Request-Id"]
    max_age           = 3600
  }
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.ops.id
  name        = "$default"
  auto_deploy = true

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.apigw.arn
    format = jsonencode({
      requestId    = "$context.requestId"
      sourceIp     = "$context.identity.sourceIp"
      requestTime  = "$context.requestTime"
      httpMethod   = "$context.httpMethod"
      routeKey     = "$context.routeKey"
      status       = "$context.status"
      errorMessage = "$context.error.message"
      responseLatency = "$context.responseLatency"
    })
  }

  default_route_settings {
    throttling_burst_limit = 200
    throttling_rate_limit  = 100
    detailed_metrics_enabled = true
    logging_level            = "INFO"
  }
}

# ---- Lambda Integrations ----
resource "aws_apigatewayv2_integration" "presign" {
  api_id                 = aws_apigatewayv2_api.ops.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.presign.invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 10000
}

resource "aws_apigatewayv2_integration" "agent_router" {
  api_id                 = aws_apigatewayv2_api.ops.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.agent_router.invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 29000
}

resource "aws_apigatewayv2_integration" "google_auth" {
  api_id                 = aws_apigatewayv2_api.ops.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.google_auth.invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 15000
}

# ---- Routes ----
resource "aws_apigatewayv2_route" "upload_presign" {
  api_id    = aws_apigatewayv2_api.ops.id
  route_key = "POST /upload/presign"
  target    = "integrations/${aws_apigatewayv2_integration.presign.id}"
}

resource "aws_apigatewayv2_route" "agents_list" {
  api_id    = aws_apigatewayv2_api.ops.id
  route_key = "GET /agents"
  target    = "integrations/${aws_apigatewayv2_integration.agent_router.id}"
}

resource "aws_apigatewayv2_route" "agent_chat" {
  api_id    = aws_apigatewayv2_api.ops.id
  route_key = "POST /agents/{agentId}/chat"
  target    = "integrations/${aws_apigatewayv2_integration.agent_router.id}"
}

resource "aws_apigatewayv2_route" "analytics_summary" {
  api_id    = aws_apigatewayv2_api.ops.id
  route_key = "GET /analytics/summary"
  target    = "integrations/${aws_apigatewayv2_integration.agent_router.id}"
}

resource "aws_apigatewayv2_route" "analytics_web" {
  api_id    = aws_apigatewayv2_api.ops.id
  route_key = "GET /analytics/web"
  target    = "integrations/${aws_apigatewayv2_integration.agent_router.id}"
}

resource "aws_apigatewayv2_route" "analytics_meta" {
  api_id    = aws_apigatewayv2_api.ops.id
  route_key = "GET /analytics/meta"
  target    = "integrations/${aws_apigatewayv2_integration.agent_router.id}"
}

resource "aws_apigatewayv2_route" "sessions_get" {
  api_id    = aws_apigatewayv2_api.ops.id
  route_key = "GET /sessions/{sessionId}"
  target    = "integrations/${aws_apigatewayv2_integration.agent_router.id}"
}

resource "aws_apigatewayv2_route" "google_auth_status" {
  api_id    = aws_apigatewayv2_api.ops.id
  route_key = "GET /auth/google/status"
  target    = "integrations/${aws_apigatewayv2_integration.agent_router.id}"
}

resource "aws_apigatewayv2_route" "google_auth_disconnect" {
  api_id    = aws_apigatewayv2_api.ops.id
  route_key = "POST /auth/google/disconnect"
  target    = "integrations/${aws_apigatewayv2_integration.agent_router.id}"
}

resource "aws_apigatewayv2_route" "google_auth_url" {
  api_id    = aws_apigatewayv2_api.ops.id
  route_key = "GET /auth/google/url"
  target    = "integrations/${aws_apigatewayv2_integration.google_auth.id}"
}

resource "aws_apigatewayv2_route" "google_auth_callback" {
  api_id    = aws_apigatewayv2_api.ops.id
  route_key = "GET /auth/google/callback"
  target    = "integrations/${aws_apigatewayv2_integration.google_auth.id}"
}

# ---- Lambda Permissions — allow API Gateway to invoke ----
resource "aws_lambda_permission" "apigw_presign" {
  statement_id  = "AllowAPIGWInvokePresign"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.presign.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.ops.execution_arn}/*/*"
}


resource "aws_apigatewayv2_route" "email_send" {
  api_id    = aws_apigatewayv2_api.ops.id
  route_key = "POST /email/send"
  target    = "integrations/${aws_apigatewayv2_integration.email_sender.id}"
}


# ---- social-poster API Integration ----
resource "aws_apigatewayv2_integration" "social_poster" {
  api_id                 = aws_apigatewayv2_api.ops.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.social_poster.invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 30000
}

# LinkedIn routes
resource "aws_apigatewayv2_route" "linkedin_url" {
  api_id    = aws_apigatewayv2_api.ops.id
  route_key = "GET /social/linkedin/url"
  target    = "integrations/${aws_apigatewayv2_integration.social_poster.id}"
}

resource "aws_apigatewayv2_route" "linkedin_callback" {
  api_id    = aws_apigatewayv2_api.ops.id
  route_key = "GET /social/linkedin/callback"
  target    = "integrations/${aws_apigatewayv2_integration.social_poster.id}"
}

resource "aws_apigatewayv2_route" "linkedin_status" {
  api_id    = aws_apigatewayv2_api.ops.id
  route_key = "GET /social/linkedin/status"
  target    = "integrations/${aws_apigatewayv2_integration.social_poster.id}"
}

resource "aws_apigatewayv2_route" "linkedin_disconnect" {
  api_id    = aws_apigatewayv2_api.ops.id
  route_key = "POST /social/linkedin/disconnect"
  target    = "integrations/${aws_apigatewayv2_integration.social_poster.id}"
}

resource "aws_apigatewayv2_route" "linkedin_post" {
  api_id    = aws_apigatewayv2_api.ops.id
  route_key = "POST /social/linkedin/post"
  target    = "integrations/${aws_apigatewayv2_integration.social_poster.id}"
}

# Facebook routes (static token - configured at deploy time)
resource "aws_apigatewayv2_route" "facebook_status" {
  api_id    = aws_apigatewayv2_api.ops.id
  route_key = "GET /social/facebook/status"
  target    = "integrations/${aws_apigatewayv2_integration.social_poster.id}"
}

resource "aws_apigatewayv2_route" "facebook_post" {
  api_id    = aws_apigatewayv2_api.ops.id
  route_key = "POST /social/facebook/post"
  target    = "integrations/${aws_apigatewayv2_integration.social_poster.id}"
}

# Instagram route (via Facebook Graph API)
resource "aws_apigatewayv2_route" "instagram_post" {
  api_id    = aws_apigatewayv2_api.ops.id
  route_key = "POST /social/instagram/post"
  target    = "integrations/${aws_apigatewayv2_integration.social_poster.id}"
}

# Lambda permission for API Gateway
resource "aws_lambda_permission" "apigw_social_poster" {
  statement_id  = "AllowAPIGWInvokeSocialPoster"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.social_poster.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.ops.execution_arn}/*/*"
}
resource "aws_apigatewayv2_integration" "email_sender" {
  api_id           = aws_apigatewayv2_api.ops.id
  integration_type = "AWS_PROXY"
  integration_uri  = aws_lambda_function.email_sender.arn
  payload_format_version = "2.0"
}

resource "aws_lambda_permission" "apigw_email_sender" {
  statement_id  = "AllowAPIGWInvokeEmailSender"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.email_sender.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.ops.execution_arn}/*/*"
}


resource "aws_lambda_permission" "apigw_agent_router" {
  statement_id  = "AllowAPIGWInvokeAgentRouter"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.agent_router.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.ops.execution_arn}/*/*"
}

resource "aws_lambda_permission" "apigw_google_auth" {
  statement_id  = "AllowAPIGWInvokeGoogleAuth"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.google_auth.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.ops.execution_arn}/*/*"
}

# ────────────────────────────────────────────────────────────────────────────────
# DYNAMODB — SEED AGENT PROFILES (initial data via local-exec)
# ────────────────────────────────────────────────────────────────────────────────
resource "null_resource" "seed_agents" {
  triggers = {
    table_name = aws_dynamodb_table.ops.name
    region     = var.aws_region
  }

  provisioner "local-exec" {
    interpreter = ["bash", "-c"]
    command     = <<-EOF
      aws dynamodb batch-write-item \
        --region ${var.aws_region} \
        --request-items '{
          "${aws_dynamodb_table.ops.name}": [
            {"PutRequest":{"Item":{"PK":{"S":"AGENT#sales-analyst"},"SK":{"S":"PROFILE#v0"},"GSI1PK":{"S":"ROLE#sales-analyst"},"GSI1SK":{"S":"AGENT#sales-analyst"},"entityType":{"S":"AGENT"},"agent_id":{"S":"sales-analyst"},"name":{"S":"Sales Analyst"},"role":{"S":"sales-analyst"},"color":{"S":"#6366f1"},"icon":{"S":"TrendingUp"},"description":{"S":"Examines raw metal pricing, historical metrics, and predicts volume patterns."},"model":{"S":"amazon.nova-pro-v1:0"},"created_at":{"S":"2025-01-01T00:00:00Z"}}}},
            {"PutRequest":{"Item":{"PK":{"S":"AGENT#sales-strategist"},"SK":{"S":"PROFILE#v0"},"GSI1PK":{"S":"ROLE#sales-strategist"},"GSI1SK":{"S":"AGENT#sales-strategist"},"entityType":{"S":"AGENT"},"agent_id":{"S":"sales-strategist"},"name":{"S":"Sales Strategist"},"role":{"S":"sales-strategist"},"color":{"S":"#8b5cf6"},"icon":{"S":"Target"},"description":{"S":"Designs enterprise tier discounts, B2B contract negotiations, and steel supply outreach roadmaps."},"model":{"S":"amazon.nova-pro-v1:0"},"created_at":{"S":"2025-01-01T00:00:00Z"}}}},
            {"PutRequest":{"Item":{"PK":{"S":"AGENT#business-analyst"},"SK":{"S":"PROFILE#v0"},"GSI1PK":{"S":"ROLE#business-analyst"},"GSI1SK":{"S":"AGENT#business-analyst"},"entityType":{"S":"AGENT"},"agent_id":{"S":"business-analyst"},"name":{"S":"Business Analyst"},"role":{"S":"business-analyst"},"color":{"S":"#06b6d4"},"icon":{"S":"BarChart2"},"description":{"S":"Parses operational performance data, margins, and pipeline logjams."},"model":{"S":"amazon.nova-pro-v1:0"},"created_at":{"S":"2025-01-01T00:00:00Z"}}}},
            {"PutRequest":{"Item":{"PK":{"S":"AGENT#cloud-engineer"},"SK":{"S":"PROFILE#v0"},"GSI1PK":{"S":"ROLE#cloud-engineer"},"GSI1SK":{"S":"AGENT#cloud-engineer"},"entityType":{"S":"AGENT"},"agent_id":{"S":"cloud-engineer"},"name":{"S":"Cloud Engineer"},"role":{"S":"cloud-engineer"},"color":{"S":"#f59e0b"},"icon":{"S":"Cloud"},"description":{"S":"Reports system health, latency metrics, and operational cost from CloudWatch."},"model":{"S":"amazon.nova-pro-v1:0"},"created_at":{"S":"2025-01-01T00:00:00Z"}}}},
            {"PutRequest":{"Item":{"PK":{"S":"AGENT#marketing-manager"},"SK":{"S":"PROFILE#v0"},"GSI1PK":{"S":"ROLE#marketing-manager"},"GSI1SK":{"S":"AGENT#marketing-manager"},"entityType":{"S":"AGENT"},"agent_id":{"S":"marketing-manager"},"name":{"S":"Marketing Manager"},"role":{"S":"marketing-manager"},"color":{"S":"#10b981"},"icon":{"S":"Megaphone"},"description":{"S":"Drafts B2B LinkedIn updates, email newsletters, and SEO product copy."},"model":{"S":"amazon.nova-pro-v1:0"},"created_at":{"S":"2025-01-01T00:00:00Z"}}}},
            {"PutRequest":{"Item":{"PK":{"S":"AGENT#executive-assistant"},"SK":{"S":"PROFILE#v0"},"GSI1PK":{"S":"ROLE#executive-assistant"},"GSI1SK":{"S":"AGENT#executive-assistant"},"entityType":{"S":"AGENT"},"agent_id":{"S":"executive-assistant"},"name":{"S":"Executive Assistant"},"role":{"S":"executive-assistant"},"color":{"S":"#ef4444"},"icon":{"S":"Calendar"},"description":{"S":"Drafts calendar events, schedules team touchpoints, and builds meeting synopses."},"model":{"S":"amazon.nova-pro-v1:0"},"created_at":{"S":"2025-01-01T00:00:00Z"}}}},
            {"PutRequest":{"Item":{"PK":{"S":"AGENT#demand-forecasting"},"SK":{"S":"PROFILE#v0"},"GSI1PK":{"S":"ROLE#demand-forecasting"},"GSI1SK":{"S":"AGENT#demand-forecasting"},"entityType":{"S":"AGENT"},"agent_id":{"S":"demand-forecasting"},"name":{"S":"Demand Forecaster"},"role":{"S":"demand-forecasting"},"color":{"S":"#8b5cf6"},"icon":{"S":"TrendingDown"},"description":{"S":"Analyzes historical sales data and Indian market conditions to predict demand, inventory needs, and procurement timing."},"model":{"S":"amazon.nova-pro-v1:0"},"created_at":{"S":"2025-01-01T00:00:00Z"}}}}
          ]
        }'
    EOF
  }

  depends_on = [aws_dynamodb_table.ops]
}
