import { CloudWatchClient, GetMetricDataCommand, MetricDataQuery } from '@aws-sdk/client-cloudwatch';
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

const REGION   = process.env.AWS_REGION ?? 'us-east-1';
const API_NAME = process.env.API_NAME   ?? '';
const API_ID   = process.env.API_ID     ?? 'wtt3awq1xg';   // HTTP API (v2) uses ApiId, not ApiName

const cw = new CloudWatchClient({ region: REGION });

function corsHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function success(body: unknown): APIGatewayProxyResultV2 {
  return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify(body) };
}

function clientError(msg: string): APIGatewayProxyResultV2 {
  return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: msg }) };
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

// Fine-grained bucket size for time-series data points
function getGranularitySeconds(period: string): number {
  switch (period) {
    case '1h':  return 300;    // 5-min buckets → 12 points
    case '24h': return 3600;   // 1-hour buckets → 24 points
    case '7d':  return 86400;  // 1-day buckets  → 7 points
    default:    return 3600;
  }
}

function getStartTime(period: string): Date {
  const now = new Date();
  switch (period) {
    case '1h':  now.setHours(now.getHours() - 1);  break;
    case '24h': now.setDate(now.getDate() - 1);     break;
    case '7d':  now.setDate(now.getDate() - 7);     break;
  }
  return now;
}

async function getApiMetrics(period: string): Promise<{ routes: RouteMetric[]; timeSeries: TimeSeriesPoint[] }> {
  const startTime          = getStartTime(period);
  const endTime            = new Date();
  const granularitySeconds = getGranularitySeconds(period);

  // ── Determine REST API vs HTTP API (v2) ────────────────────────────────────
  // HTTP APIs use dimension "ApiId" and lowercase metric names "4xx"/"5xx".
  // REST APIs use dimension "ApiName" and "4XXError"/"5XXError".
  // Set API_ID for HTTP APIs; API_NAME for REST APIs.
  const isHttpApi      = Boolean(API_ID);
  const dimension      = isHttpApi
    ? { Name: 'ApiId',   Value: API_ID   }
    : { Name: 'ApiName', Value: API_NAME };
  const error4xxMetric = isHttpApi ? '4xx'      : '4XXError';
  const error5xxMetric = isHttpApi ? '5xx'      : '5XXError';
  const displayName    = isHttpApi ? API_ID      : API_NAME;

  console.log(
    'Fetching metrics — mode:', isHttpApi ? 'HTTP API v2 (ApiId)' : 'REST API (ApiName)',
    '| value:', displayName,
    '| period:', period,
    '| granularity:', granularitySeconds,
  );
  console.log('Time range:', startTime.toISOString(), 'to', endTime.toISOString());

  const metricQueries: MetricDataQuery[] = [
    {
      Id: 'totalCalls',
      MetricStat: {
        Metric: {
          Namespace:  'AWS/ApiGateway',
          MetricName: 'Count',
          Dimensions: [dimension],
        },
        Period: granularitySeconds,
        Stat:   'Sum',
      },
      ReturnData: true,
    },
    {
      Id: 'errors4xx',
      MetricStat: {
        Metric: {
          Namespace:  'AWS/ApiGateway',
          MetricName: error4xxMetric,
          Dimensions: [dimension],
        },
        Period: granularitySeconds,
        Stat:   'Sum',
      },
      ReturnData: true,
    },
    {
      Id: 'errors5xx',
      MetricStat: {
        Metric: {
          Namespace:  'AWS/ApiGateway',
          MetricName: error5xxMetric,
          Dimensions: [dimension],
        },
        Period: granularitySeconds,
        Stat:   'Sum',
      },
      ReturnData: true,
    },
    {
      Id: 'latency',
      MetricStat: {
        Metric: {
          Namespace:  'AWS/ApiGateway',
          MetricName: 'Latency',
          Dimensions: [dimension],
        },
        Period: granularitySeconds,
        Stat:   'Average',
      },
      ReturnData: true,
    },
    {
      Id: 'p99Latency',
      MetricStat: {
        Metric: {
          Namespace:  'AWS/ApiGateway',
          MetricName: 'Latency',
          Dimensions: [dimension],
        },
        Period: granularitySeconds,
        Stat:   'p99',
      },
      ReturnData: true,
    },
  ];

  const command = new GetMetricDataCommand({
    MetricDataQueries: metricQueries,
    StartTime: startTime,
    EndTime:   endTime,
  });

  const response = await cw.send(command);

  console.log('CloudWatch response:', JSON.stringify(response, null, 2));

  const totalCallsSeries = response.MetricDataResults?.find(r => r.Id === 'totalCalls');
  const errors4xxSeries  = response.MetricDataResults?.find(r => r.Id === 'errors4xx');
  const errors5xxSeries  = response.MetricDataResults?.find(r => r.Id === 'errors5xx');
  const latencySeries    = response.MetricDataResults?.find(r => r.Id === 'latency');
  const p99LatencySeries = response.MetricDataResults?.find(r => r.Id === 'p99Latency');

  // Build a timestamp-keyed map so all series align correctly
  const tsMap = new Map<string, TimeSeriesPoint>();

  const allTimestamps = [
    ...(totalCallsSeries?.Timestamps ?? []),
    ...(errors4xxSeries?.Timestamps  ?? []),
    ...(errors5xxSeries?.Timestamps  ?? []),
  ];

  // Seed every known timestamp with zeros
  for (const ts of allTimestamps) {
    const key = ts.toISOString();
    if (!tsMap.has(key)) {
      tsMap.set(key, { timestamp: key, calls: 0, successes: 0, errors: 0 });
    }
  }

  // Fill totalCalls
  (totalCallsSeries?.Timestamps ?? []).forEach((ts, i) => {
    const key = ts.toISOString();
    const pt  = tsMap.get(key)!;
    pt.calls  = Math.round(totalCallsSeries?.Values?.[i] ?? 0);
  });

  // Fill errors
  (errors4xxSeries?.Timestamps ?? []).forEach((ts, i) => {
    const key = ts.toISOString();
    const pt  = tsMap.get(key)!;
    pt.errors += Math.round(errors4xxSeries?.Values?.[i] ?? 0);
  });
  (errors5xxSeries?.Timestamps ?? []).forEach((ts, i) => {
    const key = ts.toISOString();
    const pt  = tsMap.get(key)!;
    pt.errors += Math.round(errors5xxSeries?.Values?.[i] ?? 0);
  });

  // Derive successes
  for (const pt of tsMap.values()) {
    pt.successes = Math.max(0, pt.calls - pt.errors);
  }

  // Sort chronologically
  const timeSeries: TimeSeriesPoint[] = Array.from(tsMap.values()).sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  // Aggregate totals
  const totalCalls   = timeSeries.reduce((sum, t) => sum + t.calls,     0);
  const totalSuccess = timeSeries.reduce((sum, t) => sum + t.successes, 0);
  const totalErrors  = timeSeries.reduce((sum, t) => sum + t.errors,    0);

  // Average latency
  const latencyValues = latencySeries?.Values ?? [];
  const avgLatencyMs  = latencyValues.length > 0
    ? latencyValues.reduce((a, b) => a + b, 0) / latencyValues.length
    : 0;

  // P99 — use the latest non-zero value
  const p99Values  = p99LatencySeries?.Values ?? [];
  const p99Latency = p99Values.length > 0 ? p99Values[p99Values.length - 1] : 0;

  const routes: RouteMetric[] = [{
    route:        displayName ? `${displayName}/*` : 'all',
    method:       'ALL',
    totalCalls:   Math.round(totalCalls),
    successCount: Math.round(totalSuccess),
    errorCount:   Math.round(totalErrors),
    successRate:  totalCalls > 0 ? (totalSuccess / totalCalls) * 100 : 0,
    avgLatency:   Math.round(avgLatencyMs),
    p99Latency:   Math.round(p99Latency),
  }];

  console.log('Returning metrics:', JSON.stringify({ routes, timeSeries: timeSeries.length }, null, 2));

  return { routes, timeSeries };
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  // Handle CORS preflight
  if (event.requestContext.http.method === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }

  try {
    const period = event.queryStringParameters?.period ?? '24h';

    // Require either API_ID (HTTP API) or API_NAME (REST API)
    if (!API_ID && !API_NAME) {
      console.warn('Neither API_ID nor API_NAME env var is set — returning empty metrics');
      return success({
        routes:    [],
        timeSeries: [],
        message:   'API_ID (HTTP API) or API_NAME (REST API) not configured',
      });
    }

    const metrics = await getApiMetrics(period);
    return success(metrics);
  } catch (error) {
    console.error('Failed to fetch API metrics:', error);
    return serverError(error instanceof Error ? error.message : 'Failed to fetch metrics');
  }
};