# AWS Costs lambda and IAM resources
# This file adds a new lambda (aws-costs) plus IAM role & policy, CloudWatch log group,
# an archive_file data resource for packaging, and API Gateway integration + route.

# IAM role for aws-costs lambda
resource "aws_iam_role" "aws_costs" {
  name               = "${local.prefix}-aws-costs-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

resource "aws_iam_role_policy" "aws_costs" {
  name = "${local.prefix}-aws-costs-policy"
  role = aws_iam_role.aws_costs.id
  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Sid = "CostExplorerRead",
        Effect = "Allow",
        Action = [
          "ce:GetCostAndUsage",
          "ce:GetCostAndUsageWithResources",
          "ce:GetDimensionValues"
        ],
        Resource = "*"
      },
      {
        Sid = "Logs",
        Effect = "Allow",
        Action = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
        Resource = "arn:aws:logs:*:*:*"
      }
    ]
  })
}

# Package the lambda — built artifact is placed in dist/ by the build-lambdas CI job
data "archive_file" "aws_costs" {
  type        = "zip"
  source_dir  = "${local.lambda_dir}/aws-costs/dist"
  output_path = "${path.module}/.terraform-build/aws-costs.zip"
}

# CloudWatch log group for lambda
resource "aws_cloudwatch_log_group" "aws_costs" {
  name              = "/aws/lambda/${local.prefix}-aws-costs"
  retention_in_days = var.log_retention_days
}

# Lambda function
resource "aws_lambda_function" "aws_costs" {
  function_name    = "${local.prefix}-aws-costs"
  role             = aws_iam_role.aws_costs.arn
  handler          = "handler.handler"
  runtime          = var.lambda_runtime
  filename         = data.archive_file.aws_costs.output_path
  source_code_hash = data.archive_file.aws_costs.output_base64sha256
  memory_size      = 256
  timeout          = 15

  environment {
    variables = {
      ENVIRONMENT = var.environment
    }
  }

  depends_on = [aws_cloudwatch_log_group.aws_costs]
}

# Allow API Gateway to invoke the lambda
resource "aws_lambda_permission" "apigw_aws_costs" {
  statement_id  = "AllowAPIGWInvokeAwsCosts"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.aws_costs.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.ops.execution_arn}/*/*"
}

# API Gateway integration and route
resource "aws_apigatewayv2_integration" "aws_costs" {
  api_id                 = aws_apigatewayv2_api.ops.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.aws_costs.invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 15000
}

resource "aws_apigatewayv2_route" "aws_costs_route" {
  api_id    = aws_apigatewayv2_api.ops.id
  route_key = "GET /aws-costs"
  target    = "integrations/${aws_apigatewayv2_integration.aws_costs.id}"
}
