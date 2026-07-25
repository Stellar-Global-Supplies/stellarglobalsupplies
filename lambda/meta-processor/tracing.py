"""
OpenTelemetry tracing initialisation for the meta-processor Lambda.

Provides:
- TracerProvider configured for New Relic OTLP export
- trace_lambda_handler decorator for Lambda root spans
- TraceJsonFormatter for log correlation
- configure_json_logging() for structured JSON logs

Reuses the same SSM parameter path as the quote app: /sgs-quote/new_relic_license_key
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
    prefix = os.environ.get("SSM_PREFIX", "/sgs-quote")
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

    resource = Resource.create(
        {
            "service.name": "sgs-ops-app",
            "deployment.environment.name": os.environ.get("ENVIRONMENT", "production"),
            "cloud.provider": "aws",
            "cloud.region": os.environ.get("AWS_REGION", "us-east-1"),
        }
    )

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
        _tracer = _get_tracer_provider().get_tracer("sgs-ops-app")
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
            entry["service.name"] = "sgs-ops-app"

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