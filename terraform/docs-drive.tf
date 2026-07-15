# ─────────────────────────────────────────────────────────────────────────────
# Documents Drive Infrastructure
# Add these blocks into your existing terraform/main.tf
#
# Resources added:
#   1. S3 bucket  → stellarglobal-docs-drive  (private, versioning on)
#   2. DynamoDB   → stellarglobal-docs         (PAY_PER_REQUEST, GSI on gsi1pk)
#   3. IAM role   → docs-drive-lambda-role
#   4. Lambda     → stellarglobal-docs-drive-fn
#   5. API Gateway routes wired to the Lambda
#
# Assumes these already exist in your main.tf:
#   - aws_apigatewayv2_api.ops              (your HTTP API v2)
#   - aws_apigatewayv2_stage.default        (your $default stage)
#   - data.aws_iam_policy_document.assume_lambda  (or just copy the role below)
# ─────────────────────────────────────────────────────────────────────────────

# ── 1. S3 Bucket ──────────────────────────────────────────────────────────────

resource "aws_s3_bucket" "docs_drive" {
  bucket = "stellarglobal-ops-docs-drive"

  tags = {
    Project     = "StellarGlobalSupplies"
    Environment = "production"
    ManagedBy   = "terraform"
    Feature     = "docs-drive"
  }
}

resource "aws_s3_bucket_versioning" "docs_drive" {
  bucket = aws_s3_bucket.docs_drive.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "docs_drive" {
  bucket = aws_s3_bucket.docs_drive.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Block all public access — files are served via pre-signed URLs only
resource "aws_s3_bucket_public_access_block" "docs_drive" {
  bucket                  = aws_s3_bucket.docs_drive.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# CORS — allows the frontend origin to PUT (upload) and GET directly to S3
resource "aws_s3_bucket_cors_configuration" "docs_drive" {
  bucket = aws_s3_bucket.docs_drive.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "PUT", "HEAD"]
    allowed_origins = ["https://ops.stellarglobalsupplies.com"]
    expose_headers  = ["ETag", "Content-Type", "Content-Length"]
    max_age_seconds = 3600
  }
}

# Lifecycle — move objects to STANDARD_IA after 90 days, Glacier after 365
resource "aws_s3_bucket_lifecycle_configuration" "docs_drive" {
  bucket = aws_s3_bucket.docs_drive.id

  rule {
    id     = "docs-tiering"
    status = "Enabled"

    filter {}

    transition {
      days          = 90
      storage_class = "STANDARD_IA"
    }

    transition {
      days          = 365
      storage_class = "GLACIER"
    }

    noncurrent_version_expiration {
      noncurrent_days = 90
    }
  }
}

# ── 2. DynamoDB Table ─────────────────────────────────────────────────────────

resource "aws_dynamodb_table" "docs" {
  name         = "stellarglobal-docs"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  # GSI for listing all items under a given parent prefix
  # gsi1pk = "PREFIX#<parentPrefix>"  e.g. "PREFIX#reports/2024/"
  attribute {
    name = "gsi1pk"
    type = "S"
  }

  global_secondary_index {
    name            = "gsi1"
    hash_key        = "gsi1pk"
    range_key       = "sk"
    projection_type = "ALL"
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled = true
  }

  tags = {
    Project     = "StellarGlobalSupplies"
    Environment = "production"
    ManagedBy   = "terraform"
    Feature     = "docs-drive"
  }
}

# ── 3. IAM Role for Lambda ────────────────────────────────────────────────────

resource "aws_iam_role" "docs_drive_lambda" {
  name = "stellarglobal-ops-docs-drive-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Service = "lambda.amazonaws.com" }
        Action    = "sts:AssumeRole"
      }
    ]
  })

  tags = {
    Project   = "StellarGlobalSupplies"
    ManagedBy = "terraform"
  }
}

# CloudWatch Logs
resource "aws_iam_role_policy_attachment" "docs_drive_logs" {
  role       = aws_iam_role.docs_drive_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Inline policy: S3 + DynamoDB permissions scoped to the docs resources only
resource "aws_iam_role_policy" "docs_drive_permissions" {
  name = "stellarglobal-ops-docs-drive-permissions"
  role = aws_iam_role.docs_drive_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "S3DocsAccess"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:ListBucket",
          "s3:GetBucketLocation"
        ]
        Resource = [
          aws_s3_bucket.docs_drive.arn,
          "${aws_s3_bucket.docs_drive.arn}/*"
        ]
      },
      {
        Sid    = "DynamoDocsAccess"
        Effect = "Allow"
        Action = [
          "dynamodb:PutItem",
          "dynamodb:GetItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query",
          "dynamodb:UpdateItem"
        ]
        Resource = [
          aws_dynamodb_table.docs.arn,
          "${aws_dynamodb_table.docs.arn}/index/*"
        ]
      }
    ]
  })
}

# ── 4. Lambda Function ────────────────────────────────────────────────────────

# Zip the built handler (CI/CD builds lambda/docs-drive/dist/handler.js first)
data "archive_file" "docs_drive" {
  type        = "zip"
  source_dir  = "${path.module}/../lambda/doc-drive/dist"
  output_path = "${path.module}/../lambda/doc-drive/doc-drive.zip"
}

resource "aws_lambda_function" "docs_drive" {
  function_name    = "stellarglobal-ops-docs-drive"
  description      = "Documents Drive: list / upload / download / delete / folder ops"
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]   # Graviton2 — matches your existing Lambdas
  role             = aws_iam_role.docs_drive_lambda.arn
  handler          = "handler.handler"
  filename         = data.archive_file.docs_drive.output_path
  source_code_hash = data.archive_file.docs_drive.output_base64sha256
  timeout          = 30
  memory_size      = 256

  environment {
    variables = {
      DOCS_BUCKET = aws_s3_bucket.docs_drive.bucket
      DOCS_TABLE  = aws_dynamodb_table.docs.name
    }
  }

  tags = {
    Project     = "StellarGlobalSupplies"
    Environment = "production"
    ManagedBy   = "terraform"
    Feature     = "docs-drive"
  }

  depends_on = [
    aws_iam_role_policy_attachment.docs_drive_logs,
    aws_iam_role_policy.docs_drive_permissions,
  ]
}

# CloudWatch log group with 30-day retention
resource "aws_cloudwatch_log_group" "docs_drive" {
  name              = "/aws/lambda/${aws_lambda_function.docs_drive.function_name}"
  retention_in_days = 1

  tags = {
    Project   = "StellarGlobalSupplies"
    ManagedBy = "terraform"
  }
}

# ── 5. API Gateway Integration & Routes ───────────────────────────────────────
# Wires into your existing aws_apigatewayv2_api.api resource

resource "aws_apigatewayv2_integration" "docs_drive" {
  api_id                 = aws_apigatewayv2_api.ops.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.docs_drive.invoke_arn
  payload_format_version = "2.0"
}

# Allow API Gateway to invoke the Lambda
resource "aws_lambda_permission" "docs_drive_apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.docs_drive.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.ops.execution_arn}/*/*/docs/*"
}

resource "aws_apigatewayv2_route" "docs_list" {
  api_id    = aws_apigatewayv2_api.ops.id
  route_key = "GET /docs/list"
  target    = "integrations/${aws_apigatewayv2_integration.docs_drive.id}"
}

resource "aws_apigatewayv2_route" "docs_folder" {
  api_id    = aws_apigatewayv2_api.ops.id
  route_key = "POST /docs/folder"
  target    = "integrations/${aws_apigatewayv2_integration.docs_drive.id}"
}

resource "aws_apigatewayv2_route" "docs_presign_upload" {
  api_id    = aws_apigatewayv2_api.ops.id
  route_key = "POST /docs/presign-upload"
  target    = "integrations/${aws_apigatewayv2_integration.docs_drive.id}"
}

resource "aws_apigatewayv2_route" "docs_presign_download" {
  api_id    = aws_apigatewayv2_api.ops.id
  route_key = "POST /docs/presign-download"
  target    = "integrations/${aws_apigatewayv2_integration.docs_drive.id}"
}

resource "aws_apigatewayv2_route" "docs_delete" {
  api_id    = aws_apigatewayv2_api.ops.id
  route_key = "DELETE /docs/delete"
  target    = "integrations/${aws_apigatewayv2_integration.docs_drive.id}"
}

# OPTIONS preflight (CORS) — handled by the Lambda itself, route still needed
resource "aws_apigatewayv2_route" "docs_options" {
  api_id    = aws_apigatewayv2_api.ops.id
  route_key = "OPTIONS /docs/{proxy+}"
  target    = "integrations/${aws_apigatewayv2_integration.docs_drive.id}"
}

# ── 6. Outputs ────────────────────────────────────────────────────────────────

output "docs_bucket_name" {
  description = "S3 bucket for Documents Drive"
  value       = aws_s3_bucket.docs_drive.bucket
}

output "docs_bucket_arn" {
  description = "ARN of the Documents Drive S3 bucket"
  value       = aws_s3_bucket.docs_drive.arn
}

output "docs_table_name" {
  description = "DynamoDB table for Documents Drive metadata"
  value       = aws_dynamodb_table.docs.name
}

output "docs_table_arn" {
  description = "ARN of the Documents Drive DynamoDB table"
  value       = aws_dynamodb_table.docs.arn
}

output "docs_lambda_arn" {
  description = "ARN of the Documents Drive Lambda function"
  value       = aws_lambda_function.docs_drive.arn
}
