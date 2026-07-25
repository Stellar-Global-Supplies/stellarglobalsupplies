# OpenTelemetry (OTLP) Migration Guide for AWS Lambda → New Relic

## Overview

This document provides a step-by-step guide for migrating any AWS Lambda Python application to use OpenTelemetry distributed tracing with New Relic APM via the OTLP endpoint.

It is based on the real-world implementation done for the **Stellar Global Supplies Quote Application** (`stellarglobalsupplies-quote`) and captures all issues encountered, fixes applied, and recommendations.

---

## Table of Contents

1. [Architecture Before & After](#1-architecture-before--after)
2. [Prerequisites](#2-prerequisites)
3. [Step 1: Add OpenTelemetry Dependencies](#3-step-1-add-opentelemetry-dependencies)
4. [Step 2: Create the Tracing Module](#4-step-2-create-the-tracing-module)
5. [Step 3: Instrument Shared Modules](#5-step-3-instrument-shared-modules)
6. [Step 4: Instrument Lambda Handlers](#6-step-4-instrument-lambda-handlers)
7. [Step 5: Infrastructure as Code Changes](#7-step-5-infrastructure-as-code-changes)
8. [Step 6: Environment Variables](#8-step-6-environment-variables)
9. [Step 7: SSM Parameter Store](#9-step-7-ssm-parameter-store)
10. [Step 8: CI/CD Pipeline Updates](#10-step-8-cicd-pipeline-updates)
11. [Step 9: Cost Management with Sampling](#11-step-9-cost-management-with-sampling)
12. [Common Issues & Resolutions](#12-common-issues--resolutions)
13. [Verification Checklist](#13-verification-checklist)
14. [New Relic Configuration & NRQL Queries](#14-new-relic-configuration--nrql-queries)
15. [Security Review](#15-security-review)
16. [Rollback Procedure](#16-rollback-procedure)

---

## 1. Architecture Before & After

### Before

```
Lambda → CloudWatch Logs → New Relic Log Forwarder → New Relic Logs
         ↑ Existing logging only, no tracing
```

### After

```
Lambda → CloudWatch Logs → New Relic Log Forwarder → New Relic Logs
         ↓                                                                    
    OpenTelemetry SDK → OTLP → New Relic EU (APM + Distributed Tracing)
```

**Key principle:** The existing logging pipeline is preserved. Only *traces* are exported via OTLP. Logs continue their existing path through CloudWatch subscription filters.

### Desired Trace Structure

```
POST /api/quotes (SERVER span — Lambda root)
│
├── POST Supabase quote_customers (CLIENT span)
├── GET Supabase quotes (CLIENT span)
└── POST Supabase quotes (CLIENT span)
```

Each Supabase or external API call should appear as a child span under the Lambda root span.

---

## 2. Prerequisites

### New Relic Account

1. **New Relic EU account** (if using European data region)
2. **License Key** (NOT an API Key)
   - Navigate to: New Relic → User Avatar → API Keys
   - Look for: **License Key** (40-character hex string)
   - **DO NOT** use a regular API Key or Ingest Key — only the License Key works with OTLP

### AWS Requirements

- AWS Lambda with Python 3.9+
- AWS SSM Parameter Store (for New Relic license key)
- IAM role with `ssm:GetParameter` permission
- Boto3 available in the Lambda runtime

### New Relic Endpoints

| Region | OTLP Endpoint |
|--------|--------------|
| **EU** | `https://otlp.eu01.nr-data.net/v1/traces` |
| **US** | `https://otlp.nr-data.net/v1/traces` |

---

## 3. Step 1: Add OpenTelemetry Dependencies

### 3.1 Create requirements.txt

```txt
# requirements.txt
opentelemetry-api==1.44.0
opentelemetry-sdk==1.44.0
opentelemetry-exporter-otlp-proto-http==1.44.0
opentelemetry-proto==1.44.0
opentelemetry-semantic-conventions==0.65b0
```

### 3.2 Install Dependencies

```bash
pip install -r requirements.txt -t backend/lambda/
```

**⚠️ Critical:** Install at the Lambda root directory, NOT a subdirectory. AWS Lambda only adds the zip root to `sys.path`.

**Wrong:**
```bash
pip install -r requirements.txt -t backend/lambda/python/   # ❌ Not importable
```

**Correct:**
```bash
pip install -r requirements.txt -t backend/lambda/          # ✅ Importable
```

### 3.3 Gitignore

```gitignore
# .gitignore or .dockerignore
backend/lambda/python/
backend/lambda/*.dist-info/
backend/lambda/opentelemetry/
backend/lambda/google/
backend/lambda/protobuf/
backend/lambda/requests/
backend/lambda/urllib3/
backend/lambda/certifi/
backend/lambda/idna/
backend/lambda/charset_normalizer/
backend/lambda/typing_extensions.py
```

These packages are installed by pip and should NOT be committed to git. They are rebuilt by CI/CD.

---

## 4. Step 2: Create the Tracing Module

### 4.1 Core Tracing Module

Create `backend/lambda/tracing.py`:

```python
"""
OpenTelemetry tracing initialisation for AWS Lambda Python functions.

Provides:
- TracerProvider configured for New Relic OTLP export
- trace_lambda_handler decorator for Lambda root spans
- TraceJsonFormatter for log correlation
- configure_json_logging() for structured JSON logs
"""

from __future__ import annotations

import functools
import json
import logging
import os
from typing import Any, Callable

import boto3

from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.trace import SpanKind, Status, StatusCode
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator

_tracer_provider: TracerProvider | None = None
_tracer: trace.Tracer | None = None
_nr_license_key: str | None = None

logger = logging.getLogger(__name__)


def _get_nr_license_key() -> str:
    """Retrieve NR license key from SSM. Cached at cold start."""
    global _nr_license_key
    if _nr_license_key is not None:
        return _nr_license_key

    region = os.environ.get("AWS_REGION", "us-east-1")
    prefix = os.environ.get("SSM_PREFIX", "/my-app")
    param_name = f"{prefix}/new_relic_license_key"

    try:
        ssm = boto3.client("ssm", region_name=region)
        resp = ssm.get_parameter(Name=param_name, WithDecryption=True)
        _nr_license_key = resp["Parameter"]["Value"]
    except Exception:
        logger.warning("Failed to retrieve New Relic license key from SSM; tracing disabled")
        _nr_license_key = ""

    return _nr_license_key


def _create_tracer_provider() -> TracerProvider:
    """Build TracerProvider for New Relic OTLP."""
    license_key = _get_nr_license_key()
    if not license_key:
        return TracerProvider()  # no-op

    resource = Resource.create()

    exporter = OTLPSpanExporter(
        endpoint=os.environ.get(
            "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
            "https://otlp.eu01.nr-data.net/v1/traces",
        ),
        headers={"api-key": license_key},
        timeout=1,  # seconds — never let telemetry delay the business API
    )

    processor = BatchSpanProcessor(
        span_exporter=exporter,
        max_queue_size=2048,
        max_export_batch_size=512,
        schedule_delay_millis=5000,
        export_timeout_millis=1000,
    )

    provider = TracerProvider(resource=resource)
    provider.add_span_processor(processor)
    return provider


def _get_tracer_provider() -> TracerProvider:
    global _tracer_provider
    if _tracer_provider is None:
        _tracer_provider = _create_tracer_provider()
    return _tracer_provider


def _get_tracer() -> trace.Tracer:
    global _tracer
    if _tracer is None:
        _tracer = _get_tracer_provider().get_tracer(
            os.environ.get("OTEL_SERVICE_NAME", "my-app")
        )
    return _tracer


class TraceJsonFormatter(logging.Formatter):
    """JSON log formatter with trace context for log correlation."""

    def format(self, record: logging.LogRecord) -> str:
        entry: dict[str, Any] = {
            "message": record.getMessage(),
            "level": record.levelname,
            "logger": record.name,
            "timestamp": self.formatTime(record, self.datefmt),
        }

        current_span = trace.get_current_span()
        if current_span is not None and current_span.is_recording():
            ctx = current_span.get_span_context()
            entry["trace.id"] = format(ctx.trace_id, "032x")
            entry["span.id"] = format(ctx.span_id, "016x")
            entry["service.name"] = os.environ.get("OTEL_SERVICE_NAME", "my-app")

        return json.dumps(entry, ensure_ascii=False, default=str)


def configure_json_logging(logger_name: str | None = None) -> logging.Logger:
    """Replace handler(s) with a single JSON StreamHandler."""
    target = logging.getLogger(logger_name) if logger_name else logging.getLogger()

    if (
        len(target.handlers) == 1
        and isinstance(target.handlers[0], logging.StreamHandler)
        and isinstance(target.handlers[0].formatter, TraceJsonFormatter)
    ):
        return target

    target.handlers.clear()
    handler = logging.StreamHandler()
    handler.setFormatter(TraceJsonFormatter())
    target.addHandler(handler)
    return target


def trace_lambda_handler(handler: Callable) -> Callable:
    """Decorator: creates root SERVER span for Lambda invocation."""

    @functools.wraps(handler)
    def wrapper(event: dict, context: object) -> dict:
        # Skip tracing for OPTIONS / CORS preflight
        if event.get("requestContext", {}).get("http", {}).get("method") == "OPTIONS":
            return handler(event, context)

        # Extract W3C trace context
        headers = event.get("headers", {}) or {}
        carrier = {
            "traceparent": headers.get("traceparent", ""),
            "tracestate": headers.get("tracestate", ""),
        }
        ctx = TraceContextTextMapPropagator().extract(carrier=carrier)

        http_method = event.get("requestContext", {}).get("http", {}).get("method", "UNKNOWN")
        raw_path = event.get("rawPath", "/")
        route_key = event.get("routeKey", "unknown")
        span_name = f"{http_method} {raw_path}"

        tracer = _get_tracer()
        span = tracer.start_span(
            span_name,
            context=ctx,
            kind=SpanKind.SERVER,
            attributes={
                "http.request.method": http_method,
                "http.route": route_key,
                "url.path": raw_path,
            },
        )

        try:
            response = handler(event, context)
            status_code = response.get("statusCode", 200) if isinstance(response, dict) else 200
            span.set_attribute("http.response.status_code", status_code)
            return response

        except Exception as exc:
            span.set_attribute("http.response.status_code", 500)
            span.set_status(Status(StatusCode.ERROR, str(exc)))
            span.record_exception(exc)
            raise

        finally:
            span.end()
            try:
                tp = _get_tracer_provider()
                tp.force_flush(timeout_millis=1500)
            except Exception:
                logger.warning("Telemetry force_flush failed; continuing")

    return wrapper
```

### 4.2 Customizing for Your Application

Replace these values for your app:

| Variable | Your Value |
|----------|-----------|
| `SSM_PREFIX` | `"/my-app"` |
| `OTEL_SERVICE_NAME` | `"my-service-name"` |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | `"https://otlp.eu01.nr-data.net/v1/traces"` (EU) or `"https://otlp.nr-data.net/v1/traces"` (US) |

---

## 5. Step 3: Instrument Shared Modules

If your application uses shared modules (e.g., a database client), instrument those to create child spans automatically.

### 5.1 Example: Supabase Client

```python
from opentelemetry import trace
from opentelemetry.trace import SpanKind, Status, StatusCode

tracer = trace.get_tracer("my-app")

def db_request(method: str, table: str, data: dict = None, params: str = "", prefer: str = None) -> list:
    parsed = urlparse(supabase_url())
    span_attrs = {
        "db.system": "supabase",
        "db.operation.name": method,
        "db.collection.name": table,
        "server.address": parsed.hostname or "unknown",
        "http.request.method": method,
    }

    with tracer.start_as_current_span(
        f"{method} {table}",
        kind=SpanKind.CLIENT,
        attributes=span_attrs,
    ) as span:
        try:
            # ... existing business logic ...
            span.set_attribute("http.response.status_code", resp.status)
            return result
        except HTTPError as e:
            span.set_attribute("http.response.status_code", e.code)
            span.set_status(Status(StatusCode.ERROR, f"HTTP {e.code}"))
            span.record_exception(e)
            raise
```

### 5.2 Key Attributes for Database Spans

| Attribute | Value | Required |
|-----------|-------|----------|
| `db.system` | `"supabase"`, `"postgresql"`, etc. | Yes |
| `db.operation.name` | HTTP method like `GET`, `POST` | Yes |
| `db.collection.name` | Table name | Yes |
| `server.address` | Hostname | Yes |
| `http.request.method` | HTTP method | Yes |
| `http.response.status_code` | Status code | Recommended |

### 5.3 What NOT to Record

❌ Never record these as span attributes:
- `Authorization` header value
- `apikey` header value
- Service role keys
- New Relic license key
- Request body contents
- Customer PII (email, phone, GST number, addresses)
- Session tokens

---

## 6. Step 4: Instrument Lambda Handlers

### 6.1 Adding the Decorator

```python
# Before
from supabase_client import db_request

logger = logging.getLogger()
logger.setLevel(logging.INFO)

def handler(event, context):
    # ...
```

```python
# After
from supabase_client import db_request
from tracing import trace_lambda_handler, configure_json_logging

logger = configure_json_logging()
logger.setLevel(logging.INFO)

@trace_lambda_handler
def handler(event, context):
    # ...
```

### 6.2 Changes Required Per Lambda

| File | Changes |
|------|---------|
| `lambda1.py` | Add import + decorator |
| `lambda2.py` | Add import + decorator |
| `shared_module.py` | Add child spans only |

---

## 7. Step 5: Infrastructure as Code Changes

### 7.1 Terraform Example (main.tf)

```hcl
locals {
  app_name = "my-app"
  
  otel_env_vars = {
    SSM_PREFIX                         = "/my-app"
    ENVIRONMENT                        = var.environment
    OTEL_SERVICE_NAME                  = local.app_name
    OTEL_RESOURCE_ATTRIBUTES           = "deployment.environment.name=${var.environment},cloud.provider=aws,cloud.region=${var.aws_region}"
    OTEL_TRACES_SAMPLER                = "parentbased_traceidratio"
    OTEL_TRACES_SAMPLER_ARG            = "0.10"  # 10% sampling
    OTEL_EXPORTER_OTLP_PROTOCOL        = "http/protobuf"
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = "https://otlp.eu01.nr-data.net/v1/traces"
  }
}

# Apply to each Lambda
resource "aws_lambda_function" "my_lambda" {
  handler = "my_lambda.handler"
  
  environment {
    variables = merge(
      local.otel_env_vars,
      {}
    )
  }
}
```

### 7.2 IAM Policy

Ensure Lambda execution role has:

```json
{
  "Effect": "Allow",
  "Action": [
    "ssm:GetParameter",
    "ssm:GetParameters",
    "ssm:GetParametersByPath"
  ],
  "Resource": "arn:aws:ssm:${region}:*:parameter/my-app/*"
}
```

### 7.3 SSM Parameter

```hcl
resource "aws_ssm_parameter" "new_relic_license_key" {
  name  = "/my-app/new_relic_license_key"
  type  = "SecureString"
  value = var.new_relic_license_key  # Store in GitHub Secrets
}
```

---

## 8. Step 6: Environment Variables

All environment variables are set via Terraform (or manually if not using IaC).

| Variable | Purpose | Example Value |
|----------|---------|--------------|
| `OTEL_SERVICE_NAME` | Identifies your service in New Relic APM | `my-app` |
| `OTEL_RESOURCE_ATTRIBUTES` | Resource metadata for filtering | `deployment.environment.name=production,cloud.provider=aws,cloud.region=us-east-1` |
| `OTEL_TRACES_SAMPLER` | Sampling strategy | `parentbased_traceidratio` |
| `OTEL_TRACES_SAMPLER_ARG` | Sampling rate (0.0–1.0) | `0.10` (10%) |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | Transport protocol | `http/protobuf` |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | New Relic OTLP endpoint | `https://otlp.eu01.nr-data.net/v1/traces` |
| `SSM_PREFIX` | Prefix for SSM parameters | `/my-app` |
| `ENVIRONMENT` | Deployment stage | `production`, `staging` |

---

## 9. Step 7: SSM Parameter Store

```bash
# Store New Relic License Key
aws ssm put-parameter \
  --name "/my-app/new_relic_license_key" \
  --type "SecureString" \
  --value "<YOUR_NR_LICENSE_KEY>" \
  --region us-east-1
```

**Important:** The Lambda caches the license key at cold start. If you update the SSM parameter, you need to trigger a cold start (e.g., update the Lambda configuration or deploy a new version).

### Shared SSM Parameter Across Apps

All applications share the **same** New Relic license key SSM parameter:

```
/sgs-quote/new_relic_license_key (SecureString)
```

This means:
- Every app uses `SSM_PREFIX=/sgs-quote` in its environment variables
- The `tracing.py` module reads from `{SSM_PREFIX}/new_relic_license_key`
- Only one SSM parameter to maintain across all apps
- If the license key changes, update it once and all apps pick it up on cold start
- The IAM policy must allow access to `arn:aws:ssm:*:*:parameter/sgs-quote/*`

---

## 10. Step 8: CI/CD Pipeline Updates

### 10.1 GitHub Actions Example

```yaml
# Before running Terraform, install Python dependencies
- name: Install Python dependencies for Lambda
  run: |
    pip install -r $GITHUB_WORKSPACE/backend/lambda/requirements.txt \
      -t $GITHUB_WORKSPACE/backend/lambda/
```

### 10.2 Important Notes

- Use `$GITHUB_WORKSPACE` for absolute paths (relative paths don't work in all GHA runners)
- Install packages **before** running Terraform so the zip includes them
- Do NOT commit the installed packages to git

---

## 11. Step 9: Cost Management with Sampling

### 11.1 Sampling Strategies

| `OTEL_TRACES_SAMPLER_ARG` | % of Traces | Use Case |
|--------------------------|-------------|----------|
| `1.0` | 100% | Debugging, low-traffic apps |
| `0.75` | 75% | Recommended starting point — default for this app |
| `0.10` | 10% | Cost-conscious production |
| `0.05` | 5% | Cost-conscious production |
| `0.01` | 1% | Very high traffic, cost-sensitive |

### 11.2 Monitoring Trace Ingestion

```sql
-- Check daily trace ingestion (GB)
FROM NrConsumption 
SELECT sum(GigabytesIngested) as "Trace GB" 
WHERE usageMetric = 'TracingBytes' 
SINCE 1 day ago

-- Check span count
FROM Span SELECT count(*) SINCE 24 hours ago FACET service.name
```

### 11.3 Adjusting Sampling Without Code Change

```bash
aws lambda update-function-configuration \
  --function-name my-app-function \
  --environment "Variables={OTEL_TRACES_SAMPLER_ARG=0.05}" \
  --region us-east-1
```

Or update Terraform and redeploy:
```hcl
OTEL_TRACES_SAMPLER_ARG = "0.10"  # from 0.05 to 0.10
```

---

## 12. Common Issues & Resolutions

### Issue 1: `No module named 'opentelemetry'`

**Error:**
```
Runtime.ImportModuleError: Unable to import module 'handler': No module named 'opentelemetry'
```

**Cause:** pip packages installed to `python/` subdirectory but Lambda expects them at zip root.

**Fix:** Install with `-t .` (current dir) not `-t python/`:
```bash
# ❌ Wrong
pip install -r requirements.txt -t backend/lambda/python/

# ✅ Correct
pip install -r requirements.txt -t backend/lambda/
```

### Issue 2: `BatchSpanProcessor.__init__() got an unexpected keyword argument 'exporter'`

**Error:**
```
TypeError: BatchSpanProcessor.__init__() got an unexpected keyword argument 'exporter'
```

**Cause:** Parameter name changed in newer OpenTelemetry versions.

**Fix:** Use `span_exporter` instead of `exporter`:
```python
# ❌ Wrong
BatchSpanProcessor(exporter=exporter)

# ✅ Correct
BatchSpanProcessor(span_exporter=exporter)
```

### Issue 3: `module 'opentelemetry.trace' has no attribute 'detach'`

**Error:**
```
AttributeError: module 'opentelemetry.trace' has no attribute 'detach'
```

**Cause:** `detach()` was moved to `opentelemetry.context` in v1.44+

**Fix:** Import from the correct module:
```python
# ❌ Wrong
from opentelemetry import trace
trace.detach(token)

# ✅ Correct
from opentelemetry.context import detach
detach(token)
```

### Issue 4: `Failed to detach context` (noisy logging)

**Error:** OpenTelemetry repeatedly logs "Failed to detach context" at ERROR level.

**Cause:** Attempting to detach a context token that was already detached, or incorrect context management.

**Fix:** The safest approach for Lambda is to NOT use context management at all. Lambda execution environments are frozen/thawed between invocations, so context cleanup is unnecessary:
```python
# ✅ Safe — no context management
span = tracer.start_span(span_name, context=ctx, kind=SpanKind.SERVER)
try:
    response = handler(event, context)
    return response
finally:
    span.end()
    tp = _get_tracer_provider()
    tp.force_flush(timeout_millis=1500)
```

### Issue 5: 0 spans in New Relic but no errors

**Possible Causes (in order of likelihood):**

| Cause | Check | Solution |
|-------|-------|----------|
| **Wrong API key type** | Is it a License Key (40-char hex) or an API Key? | Use License Key, not API Key |
| **Sampling too low** | Is `OTEL_TRACES_SAMPLER_ARG` set too low? | Temporarily set to `1.0` for testing |
| **SSM parameter missing** | Check CloudWatch for "Failed to retrieve" warning | Create the SSM parameter |
| **Wrong OTLP endpoint** | US vs EU region | Verify account region |
| **Lambda timeout** | Telemetry export takes ~1.5s | Set Lambda timeout ≥ 20s |
| **Cold start cache** | SSM key cached at cold start | Wait or force cold start |

### Issue 6: Wrong AWS Region

**Symptom:** SSM parameter lookups fail or defaults to wrong region.

**Fix:** Set the AWS region fallback correctly:
```python
region = os.environ.get("AWS_REGION", "us-east-1")  # Was: "ap-south-1"
```

Search your codebase for all default region values using:
```bash
grep -r "ap-south-1" backend/lambda/*.py
```

### Issue 7: GHA fails with "pip install" path errors

**Error:** `cd ../backend/lambda: No such file or directory`

**Fix:** Use `$GITHUB_WORKSPACE` for absolute paths in GitHub Actions:
```yaml
# ❌ Wrong
cd ../backend/lambda && pip install -r requirements.txt

# ✅ Correct
pip install -r $GITHUB_WORKSPACE/backend/lambda/requirements.txt \
  -t $GITHUB_WORKSPACE/backend/lambda/
```

### Issue 8: Terraform overwrites existing env vars

**Error:** Running `aws lambda update-function-configuration --environment` replaces ALL env vars.

**Fix:** Always include ALL existing variables when updating. Use a JSON file:
```bash
# Create env-vars.json with ALL variables
aws lambda update-function-configuration \
