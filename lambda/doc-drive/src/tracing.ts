/**
 * OpenTelemetry tracing initialisation for AWS Lambda Node.js functions.
 *
 * Provides:
 * - initTracing() — initialises OTel SDK for New Relic OTLP export
 * - trace.handler() — wrapper / decorator for Lambda handlers
 * - JSON log formatter with trace context for log correlation
 */

import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { AWSXRayIdGenerator } from '@opentelemetry/id-generator-aws-xray';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { AwsInstrumentation } from '@opentelemetry/instrumentation-aws-sdk';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { Resource } from '@opentelemetry/resources';
import { NodeSDK, type NodeSDKConfig } from '@opentelemetry/sdk-node';
import { BatchSpanProcessor, type SpanProcessor } from '@opentelemetry/sdk-trace-base';
import {
  ATTR_SERVICE_NAME,
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
} from '@opentelemetry/semantic-conventions';
import {
  ATTR_CLOUD_PROVIDER,
  ATTR_CLOUD_REGION,
} from '@opentelemetry/semantic-conventions/incubating';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
// FIXED: Export 'propagation' directly from @opentelemetry/api
import { trace as apiTrace, context, propagation, SpanKind, SpanStatusCode } from '@opentelemetry/api';
import type { Handler } from 'aws-lambda';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TracingConfig {
  /** Service name shown in New Relic APM (default: sgs-ops-app) */
  serviceName?: string;
  /** Sampling ratio 0.0–1.0 (default: 1.0 — 100% for testing) */
  sampleRate?: number;
  /** OTLP traces endpoint — base URL, e.g. https://otlp.eu01.nr-data.net (default: EU endpoint) */
  otlpEndpoint?: string;
  /** SSM prefix for the NR license key (default: /sgs-quote) */
  ssmPrefix?: string;
}

// ─── Internal state ───────────────────────────────────────────────────────────

let _initialised = false;
let _initPromise: Promise<void> | null = null;
let _config: Required<TracingConfig>;
let _sdk: NodeSDK | null = null;

const DEFAULTS: Required<TracingConfig> = {
  serviceName: 'sgs-ops-app',
  sampleRate: 1.0,
  otlpEndpoint: 'https://otlp.eu01.nr-data.net',
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
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn(`[otel] Failed to fetch NR license key from SSM (${paramName}): ${errMsg}`);
    return null;
  }
}

// ─── Initialisation ───────────────────────────────────────────────────────────

export async function initTracing(config?: TracingConfig): Promise<void> {
  if (_initialised) return;
  if (_initPromise) return _initPromise;

  _initPromise = _doInitTracing(config);
  return _initPromise;
}

async function _doInitTracing(config?: TracingConfig): Promise<void> {
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

  const otlpUrl = `${_config.otlpEndpoint}/v1/traces`;

  const otelExporter = new OTLPTraceExporter({
    url: otlpUrl,
    headers: { 'api-key': licenseKey },
    concurrencyLimit: 10,
    timeoutMillis: 1000,
  });

  const spanProcessor = new BatchSpanProcessor(otelExporter, {
    maxQueueSize: 2048,
    maxExportBatchSize: 512,
    scheduledDelayMillis: 500,
    exportTimeoutMillis: 1000,
  });

  const resource = new Resource({
    [ATTR_SERVICE_NAME]: _config.serviceName,
    [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: process.env.ENVIRONMENT ?? 'production',
    [ATTR_CLOUD_PROVIDER]: 'aws',
    [ATTR_CLOUD_REGION]: process.env.AWS_REGION ?? 'us-east-1',
  });

  _sdk = new NodeSDK({
    resource,
    spanProcessor,
    idGenerator: new AWSXRayIdGenerator(),
    instrumentations: [
      new AwsInstrumentation({
        suppressInternalInstrumentation: true,
        preRequestHook: (_span, _request) => {},
      }),
      new HttpInstrumentation({
        ignoreIncomingRequestHook: () => true,
      }),
    ],
  });

  _sdk.start();
  _initialised = true;
  console.log(`[otel] Tracing initialised: ${_config.serviceName} @ ${_config.sampleRate * 100}% sampling, URL=${otlpUrl}`);
}

// ─── Handler Wrapper ──────────────────────────────────────────────────────────

export interface WrappedHandler<TEvent = any, TResult = any> {
  (event: TEvent, context: any): Promise<TResult>;
}

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
    if (descriptor) {
      const originalMethod = descriptor.value!;
      descriptor.value = wrap(originalMethod) as WrappedHandler<TEvent, TResult>;
      return descriptor;
    }

    return (event: TEvent, lambdaContext: any): Promise<TResult> => {
      return wrap(target as WrappedHandler<TEvent, TResult>)(event, lambdaContext);
    };
  };
}

function wrap<TEvent = any, TResult = any>(
  fn: WrappedHandler<TEvent, TResult>,
): WrappedHandler<TEvent, TResult> {
  return async (event: TEvent, lambdaContext: any): Promise<TResult> => {
    if (!_initialised) {
      await initTracing().catch(err => console.error('[otel] initTracing failed:', err));
    }

    const evt = event as any;
    if (evt?.requestContext?.http?.method === 'OPTIONS') {
      return fn(event, lambdaContext);
    }

    const tracer = apiTrace.getTracer(_config?.serviceName ?? 'sgs-ops-app');

    const headers = evt?.headers ?? {};
    
    // FIXED: Using 'propagation.extract' instead of 'apiTrace.propagation.extract'
    const parentContext = propagation.extract(context.active(), {
      traceparent: headers.traceparent ?? '',
      tracestate: headers.tracestate ?? '',
    });

    const isHttp = !!evt?.requestContext?.http?.method;
    const isS3 = Array.isArray(evt?.Records) && evt?.Records?.[0]?.eventSource === 'aws:s3';
    const isEventBridge = !!evt?.['detail-type'];

    const httpMethod = evt?.requestContext?.http?.method ?? 'INVOKE';
    const rawPath = evt?.rawPath ?? '/';
    const routeKey = evt?.routeKey ?? `${httpMethod} ${rawPath}`;

    const spanName = isS3
      ? `S3 ${evt.Records[0]?.eventName ?? 'event'}`
      : isEventBridge
      ? `EventBridge ${evt['detail-type']}`
      : `${httpMethod} ${rawPath}`;

    const spanAttributes: Record<string, string> = {
      'aws.lambda.function_name': lambdaContext?.functionName ?? '',
      'aws.lambda.invoked_function_arn': lambdaContext?.invokedFunctionArn ?? '',
    };
    if (isHttp) {
      spanAttributes['http.request.method'] = httpMethod;
      spanAttributes['http.route'] = routeKey;
      spanAttributes['url.path'] = rawPath;
    }
    if (isS3) {
      spanAttributes['aws.s3.bucket'] = evt.Records[0]?.s3?.bucket?.name ?? '';
      spanAttributes['aws.s3.key'] = evt.Records[0]?.s3?.object?.key ?? '';
    }
    if (isEventBridge) {
      spanAttributes['eventbridge.detail_type'] = evt['detail-type'];
      spanAttributes['eventbridge.source'] = evt.source ?? '';
    }

    return tracer.startActiveSpan(
      spanName,
      {
        kind: SpanKind.SERVER,
        attributes: spanAttributes,
      },
      parentContext,
      async (span) => {
        try {
          const result: TResult = await fn(event, lambdaContext);
          const statusCode =
            result && typeof result === 'object' && 'statusCode' in (result as any)
              ? (result as any).statusCode
              : 200;
          if (isHttp) span.setAttribute('http.response.status_code', statusCode);
          span.setStatus({ code: SpanStatusCode.OK });
          return result;
        } catch (err: any) {
          if (isHttp) span.setAttribute('http.response.status_code', 500);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: err?.message ?? String(err),
          });
          span.recordException(err);
          throw err;
        } finally {
          span.end();
          try {
            const tp = apiTrace.getTracerProvider();
            if (tp && typeof (tp as any).forceFlush === 'function') {
              await (tp as any).forceFlush();
            }
          } catch (flushErr) {
            // Non-critical
          }
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