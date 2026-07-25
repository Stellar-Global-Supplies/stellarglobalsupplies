/**
 * OpenTelemetry tracing initialisation for AWS Lambda Node.js functions.
 *
 * Provides:
 * - initTracing() — initialises OTel SDK for New Relic OTLP export
 * - trace.handler() — wrapper / decorator for Lambda handlers
 * - JSON log formatter with trace context for log correlation
 *
 * Usage:
 *   import { trace } from '../shared/tracing';
 *
 *   @trace.handler()
 *   export const handler: Handler = async (event, context) => { ... };
 *
 *   // Or without decorator:
 *   export const handler = trace.handler()(async (event, context) => { ... });
 *
 * Dependencies (add to package.json):
 *   @opentelemetry/api
 *   @opentelemetry/sdk-node
 *   @opentelemetry/exporter-trace-otlp-http
 *   @opentelemetry/semantic-conventions
 *   @opentelemetry/instrumentation-aws-sdk
 *   @opentelemetry/instrumentation-dns
 *   @opentelemetry/instrumentation-http
 */

import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { AWSXRayIdGenerator } from '@opentelemetry/id-generator-aws-xray';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { AwsInstrumentation } from '@opentelemetry/instrumentation-aws-sdk';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { Resource } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import {
  ATTR_SERVICE_NAME,
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
  ATTR_CLOUD_PROVIDER,
  ATTR_CLOUD_REGION,
} from '@opentelemetry/semantic-conventions';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { trace as apiTrace, context, SpanKind, SpanStatusCode } from '@opentelemetry/api';
import type { Handler } from 'aws-lambda';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TracingConfig {
  /** Service name shown in New Relic APM (default: sgs-ops-app) */
  serviceName?: string;
  /** Sampling ratio 0.0–1.0 (default: 1.0 — 100% for testing) */
  sampleRate?: number;
  /** OTLP traces endpoint (default: EU endpoint) */
  otlpEndpoint?: string;
  /** SSM prefix for the NR license key (default: /sgs-quote) */
  ssmPrefix?: string;
}

// ─── Internal state ───────────────────────────────────────────────────────────

let _initialised = false;
let _config: Required<TracingConfig>;

const DEFAULTS: Required<TracingConfig> = {
  serviceName: 'sgs-ops-app',
  sampleRate: 1.0,
  otlpEndpoint: 'https://otlp.eu01.nr-data.net/v1/traces',
  ssmPrefix: '/sgs-quote',
};

// ─── NR licence key from SSM ─────────────────────────────────────────────────

async function fetchLicenseKey(prefix: string): Promise<string | null> {
  const region = process.env.AWS_REGION ?? 'us-east-1';
  const ssm = new SSMClient({ region });
  const paramName = `${prefix}/new_relic_license_key`;
  try {
    const cmd = new GetParameterCommand({ Name: paramName, WithDecryption: true });
    const resp = await ssm.send(cmd);
    return resp.Parameter?.Value ?? null;
  } catch (err) {
    console.warn(`[otel] Failed to fetch NR license key from SSM: ${paramName}`);
    return null;
  }
}

// ─── Initialisation ───────────────────────────────────────────────────────────

/**
 * Initialise OpenTelemetry with New Relic OTLP export.
 * Idempotent — safe to call multiple times.
 *
 * Environment variable overrides:
 *   OTEL_SAMPLE_RATE  — override sampling ratio (0.0–1.0)
 *   OTEL_SERVICE_NAME — override service name
 */
export async function initTracing(config?: TracingConfig): Promise<void> {
  if (_initialised) return;
  _config = { ...DEFAULTS, ...config };

  // Allow runtime override via environment variables
  if (process.env.OTEL_SAMPLE_RATE) {
    _config.sampleRate = parseFloat(process.env.OTEL_SAMPLE_RATE);
  }
  if (process.env.OTEL_SERVICE_NAME) {
    _config.serviceName = process.env.OTEL_SERVICE_NAME;
  }

  const licenseKey = await fetchLicenseKey(_config.ssmPrefix);
  if (!licenseKey) {
    console.warn('[otel] No NR license key found — tracing disabled');
    _initialised = true;
    return;
  }

  // Enable diagnostics for troubleshooting (set OTEL_LOG_LEVEL=debug to see)
  // diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN);

  const otelExporter = new OTLPTraceExporter({
    url: `${_config.otlpEndpoint}/v1/traces`,
    headers: { 'api-key': licenseKey },
    concurrencyLimit: 10,
    timeoutMillis: 1000, // never let telemetry delay the business API
  });

  const spanProcessor = new BatchSpanProcessor(otelExporter, {
    maxQueueSize: 2048,
    maxExportBatchSize: 512,
    scheduledDelayMillis: 5000,
    exportTimeoutMillis: 1000,
  });

  const resource = new Resource({
    [ATTR_SERVICE_NAME]: _config.serviceName,
    [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: process.env.ENVIRONMENT ?? 'production',
    [ATTR_CLOUD_PROVIDER]: 'aws',
    [ATTR_CLOUD_REGION]: process.env.AWS_REGION ?? 'us-east-1',
  });

  const sdk = new NodeSDK({
    resource,
    spanProcessor,
    idGenerator: new AWSXRayIdGenerator(),
    instrumentations: [
      new AwsInstrumentation({
        suppressInternalInstrumentation: true,
        // Pre-request hook — no PII in span attributes
        preRequestHook: (_span, _request) => {
          // intentionally empty — we rely on default attribute suppression
        },
      }),
      new HttpInstrumentation({
        ignoreIncomingRequestHook: () => true, // Don't create spans for incoming HTTP (Lambda handles this)
      }),
    ],
  });

  sdk.start();
  _initialised = true;
  console.log(`[otel] Tracing initialised: ${_config.serviceName} @ ${_config.sampleRate * 100}% sampling`);
}

// ─── Handler Wrapper ──────────────────────────────────────────────────────────

export interface WrappedHandler<TEvent = any, TResult = any> {
  (event: TEvent, context: any): Promise<TResult>;
}

/**
 * Decorator / wrapper for Lambda handlers.
 * Creates a root SERVER span for each invocation.
 *
 * @example
 *   @trace.handler()
 *   export const handler: Handler = async (event, context) => { ... };
 */
export function handler<TEvent = any, TResult = any>(): (
  target: any,
  propertyKey?: string,
  descriptor?: TypedPropertyDescriptor<WrappedHandler<TEvent, TResult>>,
) => any {
  return function (
    target: any,
    _propertyKey?: string,
    descriptor?: TypedPropertyDescriptor<WrappedHandler<TEvent, TResult>>,
  ): any {
    // Decorator form: @trace.handler()
    if (descriptor) {
      const originalMethod = descriptor.value!;
      descriptor.value = wrap(originalMethod) as WrappedHandler<TEvent, TResult>;
      return descriptor;
    }

    // Direct form: export const handler = trace.handler()(async (event, ctx) => { ... })
    return (event: TEvent, lambdaContext: any): Promise<TResult> => {
      return wrap(target as WrappedHandler<TEvent, TResult>)(event, lambdaContext);
    };
  };
}

function wrap<TEvent = any, TResult = any>(
  fn: WrappedHandler<TEvent, TResult>,
): WrappedHandler<TEvent, TResult> {
  return async (event: TEvent, lambdaContext: any): Promise<TResult> => {
    // Auto-initialize tracing if not already done (fire-and-forget on first call)
    if (!_initialised) {
      initTracing().catch(err => console.error('[otel] initTracing failed:', err));
    }

    // Skip tracing for OPTIONS / CORS preflight
    const evt = event as any;
    if (evt?.requestContext?.http?.method === 'OPTIONS') {
      return fn(event, lambdaContext);
    }

    const tracer = apiTrace.getTracer(_config?.serviceName ?? 'sgs-ops-app');

    // Extract W3C trace context from incoming headers
    const headers = evt?.headers ?? {};
    const parentContext = apiTrace.propagation.extract(context.active(), {
      traceparent: headers.traceparent ?? '',
      tracestate: headers.tracestate ?? '',
    });

    const httpMethod = evt?.requestContext?.http?.method ?? 'UNKNOWN';
    const rawPath = evt?.rawPath ?? '/';
    const routeKey = evt?.routeKey ?? 'unknown';

    return tracer.startActiveSpan(
      `${httpMethod} ${rawPath}`,
      {
        kind: SpanKind.SERVER,
        attributes: {
          'http.request.method': httpMethod,
          'http.route': routeKey,
          'url.path': rawPath,
          'aws.lambda.function_name': lambdaContext?.functionName ?? '',
          'aws.lambda.invoked_function_arn': lambdaContext?.invokedFunctionArn ?? '',
        },
      },
      parentContext,
      async (span) => {
        try {
          const result: TResult = await fn(event, lambdaContext);
          const statusCode =
            result && typeof result === 'object' && 'statusCode' in (result as any)
              ? (result as any).statusCode
              : 200;
          span.setAttribute('http.response.status_code', statusCode);
          span.setStatus({ code: SpanStatusCode.OK });
          return result;
        } catch (err: any) {
          span.setAttribute('http.response.status_code', 500);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: err?.message ?? String(err),
          });
          span.recordException(err);
          throw err;
        } finally {
          span.end();
        }
      },
    );
  };
}

/**
 * Simple JSON log formatter with trace context.
 */
export function formatLog(level: string, message: string, extra?: Record<string, any>): string {
  const currentSpan = apiTrace.getActiveSpan();
  const entry: Record<string, any> = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...extra,
  };

  if (currentSpan) {
    const ctx = currentSpan.spanContext();
    entry['trace.id'] = ctx.traceId;
    entry['span.id'] = ctx.spanId;
  }

  return JSON.stringify(entry);
}

export const trace = { initTracing, handler, formatLog };
