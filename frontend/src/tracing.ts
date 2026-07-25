/**
 * SGS AgentVerse — Browser OTLP Tracing
 * ──────────────────────────────────────
 * Instruments the React SPA with OpenTelemetry traces sent to New Relic's
 * OTLP HTTP endpoint. Captures:
 *   • Page / section navigation (SGS uses a single-page section switcher)
 *   • Every outbound API fetch to the Lambda backend
 *   • Supabase PostgREST calls
 *   • Web Vitals (LCP, FID, CLS, TTFB, FCP) as span events
 *   • JS errors / unhandled promise rejections
 *   • User identity (set after Supabase auth)
 *
 * Usage — call initTracing() once in main.tsx BEFORE ReactDOM.createRoot(),
 * then use the exported helpers anywhere in the app:
 *
 *   import { startSpan, recordNavigation, setUser } from '@/tracing';
 */

import {
  WebTracerProvider,
  BatchSpanProcessor,
  ConsoleSpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-web';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { ZoneContextManager } from '@opentelemetry/context-zone';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { Resource } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import {
  trace,
  context,
  SpanStatusCode,
  SpanKind,
  type Span,
  type Attributes,
} from '@opentelemetry/api';
import { getWebAutoInstrumentations } from '@opentelemetry/auto-instrumentations-web';
import { registerInstrumentations } from '@opentelemetry/instrumentation';

// ─── Constants ────────────────────────────────────────────────────────────────

const SERVICE_NAME    = 'sgs-ops-frontend';
const SERVICE_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'local';

// New Relic EU OTLP endpoint (matches backend config)
const NR_ENDPOINT = 'https://otlp.eu01.nr-data.net:4318/v1/traces';

// NR Browser License key — set via Vite env var (VITE_NR_LICENSE_KEY)
// This is the INGEST key (starts with eu01xx...) — safe for browser use.
const NR_LICENSE_KEY = import.meta.env.VITE_NR_LICENSE_KEY as string | undefined;

let _provider: WebTracerProvider | null = null;
let _tracer = trace.getTracer(SERVICE_NAME);
let _userId: string | null = null;
let _userEmail: string | null = null;

// ─── Provider Init ────────────────────────────────────────────────────────────

export function initTracing(): void {
  if (_provider) return; // guard against double-init (React StrictMode)

  if (!NR_LICENSE_KEY) {
    console.warn('[tracing] VITE_NR_LICENSE_KEY not set — traces will not be exported.');
  }

  const resource = new Resource({
    [ATTR_SERVICE_NAME]:    SERVICE_NAME,
    [ATTR_SERVICE_VERSION]: SERVICE_VERSION,
    'deployment.environment': import.meta.env.MODE ?? 'production',
    'browser.user_agent':   navigator.userAgent,
    'browser.language':     navigator.language,
  });

  _provider = new WebTracerProvider({ resource });

  // ── Exporters ─────────────────────────────────────────────────────────────

  if (NR_LICENSE_KEY) {
    const exporter = new OTLPTraceExporter({
      url: NR_ENDPOINT,
      headers: {
        'api-key': NR_LICENSE_KEY,
      },
    });
    // BatchSpanProcessor — buffers and sends every 3 s or when 30 spans queued
    _provider.addSpanProcessor(
      new BatchSpanProcessor(exporter, {
        scheduledDelayMillis: 3000,
        maxExportBatchSize:   30,
        maxQueueSize:         200,
        exportTimeoutMillis:  10000,
      }),
    );
  }

  // Console exporter in dev for easy debugging
  if (import.meta.env.DEV) {
    _provider.addSpanProcessor(new SimpleSpanProcessor(new ConsoleSpanExporter()));
  }

  // ── Context + Propagation ─────────────────────────────────────────────────

  _provider.register({
    contextManager: new ZoneContextManager(),
    propagator:     new W3CTraceContextPropagator(),
  });

  // ── Auto-Instrumentation ──────────────────────────────────────────────────
  // Instruments fetch, XHR, and document load automatically.
  // We ignore Supabase auth/realtime WS noise and only trace API + Supabase REST.

  registerInstrumentations({
    tracerProvider: _provider,
    instrumentations: [
      getWebAutoInstrumentations({
        '@opentelemetry/instrumentation-fetch': {
          enabled: true,
          propagateTraceHeaderCorsUrls: [
            // Lambda API Gateway — inject traceparent so backend spans link up
            new RegExp(
              (import.meta.env.VITE_API_BASE_URL as string | undefined)
                ?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') ?? '.*lambda-url.*',
            ),
          ],
          applyCustomAttributesOnSpan(span, request, response) {
            // Check for 'url' in request object or handle string
            const url =
              typeof request === 'string'
                ? request
                : 'url' in request
                ? request.url
                : '';

            // Tag Supabase calls
            if (url.includes('supabase.co')) {
              span.setAttribute('db.system', 'postgresql');
              span.setAttribute('db.provider', 'supabase');
              // Extract table name from PostgREST path: /rest/v1/<table>
              const table = url.match(/\/rest\/v1\/([^?]+)/)?.[1];
              if (table) span.setAttribute('db.sql.table', table);
            }

            // Tag Lambda API calls
            const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '';
            if (apiBase && url.startsWith(apiBase)) {
              span.setAttribute('sgs.api.route', url.replace(apiBase, ''));
            }

            // Status
            if (response instanceof Response) {
              span.setAttribute('http.response.status_code', response.status);
              if (!response.ok) {
                span.setStatus({
                  code: SpanStatusCode.ERROR,
                  message: `HTTP ${response.status}`,
                });
              }
            }

            // User identity on every span
            if (_userId)    span.setAttribute('user.id',    _userId);
            if (_userEmail) span.setAttribute('user.email', _userEmail);
          },
          // Ignore noise: auth token refreshes, service worker, PWA assets
          ignoreUrls: [
            /supabase\.co\/auth\/v1\/token/,
            /supabase\.co\/realtime/,
            /\/sw\.js/,
            /manifest\.json/,
            /offline\.html/,
            /favicon/,
          ],
        },
        '@opentelemetry/instrumentation-xml-http-request': {
          // XHR is used for S3 uploads (uploadFileToS3 uses XMLHttpRequest)
          enabled: true,
          applyCustomAttributesOnSpan(span, _xhr) {
            span.setAttribute('sgs.transport', 'xhr');
            if (_userId) span.setAttribute('user.id', _userId);
          },
        },
        '@opentelemetry/instrumentation-document-load': {
          enabled: true,
        },
        '@opentelemetry/instrumentation-user-interaction': {
          enabled: false, // too noisy — we track navigation manually below
        },
      }),
    ],
  });

  _tracer = trace.getTracer(SERVICE_NAME, SERVICE_VERSION);

  // ── Global Error Capture ──────────────────────────────────────────────────

  window.addEventListener('error', (event) => {
    const span = _tracer.startSpan('js.error', { kind: SpanKind.CLIENT });
    span.setStatus({ code: SpanStatusCode.ERROR, message: event.message });
    span.recordException(event.error ?? new Error(event.message));
    span.setAttribute('error.type',       'uncaught_exception');
    span.setAttribute('error.filename',   event.filename ?? '');
    span.setAttribute('error.line',       event.lineno ?? 0);
    if (_userId) span.setAttribute('user.id', _userId);
    span.end();
  });

  window.addEventListener('unhandledrejection', (event) => {
    const span = _tracer.startSpan('js.unhandled_rejection', { kind: SpanKind.CLIENT });
    const err = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
    span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
    span.recordException(err);
    span.setAttribute('error.type', 'unhandled_promise_rejection');
    if (_userId) span.setAttribute('user.id', _userId);
    span.end();
  });

  // ── Web Vitals ────────────────────────────────────────────────────────────
  _captureWebVitals();

  console.info(`[tracing] Initialised — service=${SERVICE_NAME} env=${import.meta.env.MODE}`);
}

// ─── Web Vitals (inline — avoids adding web-vitals package dep) ───────────────

function _captureWebVitals(): void {
  // Use PerformanceObserver to capture paint + LCP + CLS
  try {
    // FCP + LCP
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const span = _tracer.startSpan(`web_vital.${entry.name.toLowerCase().replace(/-/g, '_')}`, {
          kind: SpanKind.CLIENT,
          startTime: entry.startTime,
        });
        span.setAttribute('web_vital.name',       entry.name);
        span.setAttribute('web_vital.value_ms',   Math.round(entry.startTime));
        span.setAttribute('web_vital.rating',     entry.startTime < 2500 ? 'good' : entry.startTime < 4000 ? 'needs-improvement' : 'poor');
        span.end(entry.startTime);
      }
    }).observe({ type: 'paint', buffered: true });

    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const lcp = entry as PerformanceEntry & { startTime: number };
        const span = _tracer.startSpan('web_vital.lcp', {
          kind: SpanKind.CLIENT,
          startTime: lcp.startTime,
        });
        span.setAttribute('web_vital.name',     'LCP');
        span.setAttribute('web_vital.value_ms', Math.round(lcp.startTime));
        span.setAttribute('web_vital.rating',   lcp.startTime < 2500 ? 'good' : lcp.startTime < 4000 ? 'needs-improvement' : 'poor');
        span.end(lcp.startTime);
      }
    }).observe({ type: 'largest-contentful-paint', buffered: true });

    // CLS
    new PerformanceObserver((list) => {
      let clsValue = 0;
      for (const entry of list.getEntries()) {
        clsValue += (entry as any).value ?? 0;
      }
      if (clsValue > 0) {
        const span = _tracer.startSpan('web_vital.cls', { kind: SpanKind.CLIENT });
        span.setAttribute('web_vital.name',    'CLS');
        span.setAttribute('web_vital.value',   clsValue);
        span.setAttribute('web_vital.rating',  clsValue < 0.1 ? 'good' : clsValue < 0.25 ? 'needs-improvement' : 'poor');
        span.end();
      }
    }).observe({ type: 'layout-shift', buffered: true });

    // TTFB from navigation timing
    const [navEntry] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
    if (navEntry) {
      const ttfb = navEntry.responseStart - navEntry.requestStart;
      const span = _tracer.startSpan('web_vital.ttfb', {
        kind: SpanKind.CLIENT,
        startTime: navEntry.requestStart,
      });
      span.setAttribute('web_vital.name',     'TTFB');
      span.setAttribute('web_vital.value_ms', Math.round(ttfb));
      span.setAttribute('web_vital.rating',   ttfb < 800 ? 'good' : ttfb < 1800 ? 'needs-improvement' : 'poor');
      span.end(navEntry.responseStart);
    }
  } catch {
    // PerformanceObserver may not be available in all browsers — safe to ignore
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Record a section navigation event (called from the zustand nav store or App).
 * Creates a CLIENT span named `sgs.navigate` with the section name.
 */
export function recordNavigation(section: string, prevSection?: string): void {
  const span = _tracer.startSpan('sgs.navigate', { kind: SpanKind.CLIENT });
  span.setAttribute('sgs.section',      section);
  span.setAttribute('sgs.prev_section', prevSection ?? '');
  span.setAttribute('sgs.app',          SERVICE_NAME);
  if (_userId)    span.setAttribute('user.id',    _userId);
  if (_userEmail) span.setAttribute('user.email', _userEmail);
  span.setStatus({ code: SpanStatusCode.OK });
  span.end();
}

/**
 * Set the authenticated user so all subsequent spans carry identity attributes.
 * Call this right after supabase.auth.getSession() resolves.
 */
export function setUser(userId: string, email?: string): void {
  _userId    = userId;
  _userEmail = email ?? null;
}

/**
 * Clear the user identity (call on signOut).
 */
export function clearUser(): void {
  _userId    = null;
  _userEmail = null;
}

/**
 * Manually start a named span. Returns the span — caller must call span.end().
 * Use for async operations you want to time (e.g. CSV parse, PDF generation).
 *
 * @example
 * const span = startSpan('csv.parse', { 'file.name': file.name });
 * try { ... } finally { span.end(); }
 */
export function startSpan(name: string, attributes?: Attributes): Span {
  const span = _tracer.startSpan(name, { kind: SpanKind.CLIENT });
  if (attributes) {
    for (const [k, v] of Object.entries(attributes)) {
      if (v !== undefined) span.setAttribute(k, v as string | number | boolean);
    }
  }
  if (_userId)    span.setAttribute('user.id',    _userId);
  if (_userEmail) span.setAttribute('user.email', _userEmail);
  return span;
}

/**
 * Run an async function inside a span — handles success/error/end automatically.
 *
 * @example
 * const result = await withSpan('supabase.fetch_orders', async () => {
 *   return supabase.from('orders').select('*');
 * });
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  attributes?: Attributes,
): Promise<T> {
  const span = startSpan(name, attributes);
  try {
    const result = await context.with(trace.setSpan(context.active(), span), () => fn(span));
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (err: any) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: err?.message ?? String(err) });
    span.recordException(err);
    throw err;
  } finally {
    span.end();
  }
}

/**
 * Flush pending spans — call before the page unloads to avoid losing the last batch.
 */
export async function flushTraces(): Promise<void> {
  await _provider?.forceFlush?.();
}

// Flush on page hide (most reliable unload event for mobile)
if (typeof window !== 'undefined') {
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushTraces();
  });
  window.addEventListener('pagehide', flushTraces);
}