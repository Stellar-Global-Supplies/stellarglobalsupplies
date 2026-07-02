import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, ScheduledEvent } from 'aws-lambda';

const REGION      = process.env.AWS_REGION    ?? 'us-east-1';
const CACHE_BUCKET = process.env.CACHE_BUCKET  ?? 'stellar-analytics-reports-471112840461';
const CACHE_KEY    = 'api-metrics/latest.json';

const s3 = new S3Client({ region: REGION });

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

function corsHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function success(body: unknown): APIGatewayProxyResultV2 {
  return { statusCode: 200, headers: SECURITY_HEADERS, body: JSON.stringify(body) };
}

function serverError(msg: string): APIGatewayProxyResultV2 {
  return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: msg }) };
}

interface RouteMetric {
  route: string;
  method: string;
  totalCalls: number;
  successCount: number;
  errorCount: number;
  successRate: number;
  avgLatency: number;
  p99Latency: number;
}

interface TimeSeriesPoint {
  timestamp: string;
  calls: number;
  successes: number;
  errors: number;
}

interface LambdaMetric {
  functionName: string;
  invocations: number;
  errors: number;
  throttles: number;
  successCount: number;
  successRate: number;
  avgDuration: number;
  p99Duration: number;
}

interface LambdaTimeSeriesPoint {
  timestamp: string;
  invocations: number;
  errors: number;
  successes: number;
}

interface CachedMetrics {
  routes: RouteMetric[];
  timeSeries: TimeSeriesPoint[];
  lambdaMetrics: LambdaMetric[];
  lambdaTimeSeries: LambdaTimeSeriesPoint[];
  cachedAt: string;
}

// ── Read metrics from S3 cache ─────────────────────────────────────
async function readFromCache(): Promise<CachedMetrics | null> {
  try {
    const { Body } = await s3.send(new GetObjectCommand({
      Bucket: CACHE_BUCKET,
      Key:    CACHE_KEY,
    }));
    const raw = await Body?.transformToString();
    if (!raw) return null;
    return JSON.parse(raw) as CachedMetrics;
  } catch (error) {
    console.error('Failed to read from cache:', error);
    return null;
  }
}

// ── Main handler ──────────────────────────────────────────────────
export const handler = async (event: APIGatewayProxyEventV2 | ScheduledEvent): Promise<APIGatewayProxyResultV2 | void> => {
  // Detect schedule invocation (EventBridge ScheduledEvent has 'source' === 'aws.events')
  if ('source' in event && event.source === 'aws.events') {
    console.log('[schedule] This Lambda only serves cached data. Use api-metrics-processor for data collection.');
    return;
  }

  // Regular HTTP invocation
  const httpEvent = event as APIGatewayProxyEventV2;

  // Handle CORS preflight
  if (httpEvent.requestContext.http.method === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }

  try {
    // Read from S3 cache only — no CloudWatch calls
    const cached = await readFromCache();
    if (cached) {
      return success(cached);
    }

    // No cache yet — return empty data with message
    console.warn('No cached metrics found');
    return success({
      routes: [],
      timeSeries: [],
      lambdaMetrics: [],
      lambdaTimeSeries: [],
      cachedAt: new Date().toISOString(),
      message: 'No cached metrics available yet. The api-metrics-processor Lambda will populate this shortly.',
    } as CachedMetrics & { message: string });
  } catch (error) {
    console.error('Failed to fetch metrics:', error);
    return serverError(error instanceof Error ? error.message : 'Failed to fetch metrics');
  }
};