import { CloudWatchClient, GetMetricDataCommand, MetricDataQuery, ListMetricsCommand } from '@aws-sdk/client-cloudwatch';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, ScheduledEvent } from 'aws-lambda';

const REGION      = process.env.AWS_REGION    ?? 'us-east-1';
const API_NAME    = process.env.API_NAME      ?? '';
const API_ID      = process.env.API_ID        ?? 'wtt3awq1xg';
const CACHE_BUCKET = process.env.CACHE_BUCKET  ?? 'stellar-analytics-reports-471112840461';
const CACHE_KEY    = 'api-metrics/latest.json';

const cw = new CloudWatchClient({ region: REGION });
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
    'Fetching API metrics — mode:', isHttpApi ? 'HTTP API v2 (ApiId)' : 'REST API (ApiName)',
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

  console.log('CloudWatch API metrics response:', JSON.stringify(response, null, 2));

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

  console.log('Returning API metrics:', JSON.stringify({ routes, timeSeries: timeSeries.length }, null, 2));

  return { routes, timeSeries };
}

// ── Lambda Metrics ──────────────────────────────────────────────────────────

/**
 * Discover all Lambda function names in the account by listing CloudWatch metrics.
 */
async function listLambdaFunctions(): Promise<string[]> {
  const functionNames: string[] = [];
  let nextToken: string | undefined;

  do {
    const command = new ListMetricsCommand({
      Namespace: 'AWS/Lambda',
      MetricName: 'Invocations',
      NextToken: nextToken,
    });
    const response = await cw.send(command);
    for (const metric of response.Metrics ?? []) {
      const nameDim = metric.Dimensions?.find(d => d.Name === 'FunctionName');
      if (nameDim?.Value && !functionNames.includes(nameDim.Value)) {
        functionNames.push(nameDim.Value);
      }
    }
    nextToken = response.NextToken;
  } while (nextToken);

  return functionNames.sort();
}

/**
 * Fetch Lambda metrics (invocations, errors, throttles, duration) for all functions.
 */
async function getLambdaMetrics(period: string): Promise<{
  lambdaMetrics: LambdaMetric[];
  lambdaTimeSeries: LambdaTimeSeriesPoint[];
}> {
  const startTime          = getStartTime(period);
  const endTime            = new Date();
  const granularitySeconds = getGranularitySeconds(period);

  console.log('Fetching Lambda metrics | period:', period, '| granularity:', granularitySeconds);
  console.log('Time range:', startTime.toISOString(), 'to', endTime.toISOString());

  // Discover all Lambda functions
  const functionNames = await listLambdaFunctions();
  console.log(`Discovered ${functionNames.length} Lambda functions:`, functionNames);

  if (functionNames.length === 0) {
    return { lambdaMetrics: [], lambdaTimeSeries: [] };
  }

  // Build metric queries for each function
  // CloudWatch GetMetricData supports up to 500 queries per request
  const queries: MetricDataQuery[] = [];
  const queryIdMap: Array<{ functionName: string; metricType: string }> = [];

  for (let i = 0; i < functionNames.length; i++) {
    const fn = functionNames[i];
    const dim = { Name: 'FunctionName', Value: fn };

    // Invocations
    const invId = `inv_${i}`;
    queries.push({
      Id: invId,
      MetricStat: {
        Metric: { Namespace: 'AWS/Lambda', MetricName: 'Invocations', Dimensions: [dim] },
        Period: granularitySeconds,
        Stat: 'Sum',
      },
      ReturnData: true,
    });
    queryIdMap.push({ functionName: fn, metricType: 'invocations' });

    // Errors
    const errId = `err_${i}`;
    queries.push({
      Id: errId,
      MetricStat: {
        Metric: { Namespace: 'AWS/Lambda', MetricName: 'Errors', Dimensions: [dim] },
        Period: granularitySeconds,
        Stat: 'Sum',
      },
      ReturnData: true,
    });
    queryIdMap.push({ functionName: fn, metricType: 'errors' });

    // Throttles
    const thrId = `thr_${i}`;
    queries.push({
      Id: thrId,
      MetricStat: {
        Metric: { Namespace: 'AWS/Lambda', MetricName: 'Throttles', Dimensions: [dim] },
        Period: granularitySeconds,
        Stat: 'Sum',
      },
      ReturnData: true,
    });
    queryIdMap.push({ functionName: fn, metricType: 'throttles' });

    // Duration Average
    const durAvgId = `durAvg_${i}`;
    queries.push({
      Id: durAvgId,
      MetricStat: {
        Metric: { Namespace: 'AWS/Lambda', MetricName: 'Duration', Dimensions: [dim] },
        Period: granularitySeconds,
        Stat: 'Average',
      },
      ReturnData: true,
    });
    queryIdMap.push({ functionName: fn, metricType: 'durationAvg' });

    // Duration p99
    const durP99Id = `durP99_${i}`;
    queries.push({
      Id: durP99Id,
      MetricStat: {
        Metric: { Namespace: 'AWS/Lambda', MetricName: 'Duration', Dimensions: [dim] },
        Period: granularitySeconds,
        Stat: 'p99',
      },
      ReturnData: true,
    });
    queryIdMap.push({ functionName: fn, metricType: 'durationP99' });
  }

  const command = new GetMetricDataCommand({
    MetricDataQueries: queries,
    StartTime: startTime,
    EndTime:   endTime,
  });

  const response = await cw.send(command);

  console.log('CloudWatch Lambda metrics response received');

  // Organize results by function name
  const fnResults = new Map<string, {
    invocations?: number[];
    errors?: number[];
    throttles?: number[];
    durationAvg?: number[];
    durationP99?: number[];
    timestamps?: Date[];
  }>();

  for (const result of response.MetricDataResults ?? []) {
    const id = result.Id ?? '';
    const entry = queryIdMap.find(q => q.metricType === id.split('_')[0] ? false : true);

    // Parse the query ID to find which function and metric type
    // Format: inv_0, err_0, thr_0, durAvg_0, durP99_0
    const parts = id.split('_');
    const metricType = parts[0]; // inv, err, thr, durAvg, durP99
    const fnIndex = parseInt(parts[1], 10);

    if (isNaN(fnIndex) || fnIndex >= functionNames.length) continue;

    const fnName = functionNames[fnIndex];
    if (!fnResults.has(fnName)) {
      fnResults.set(fnName, {});
    }
    const fnData = fnResults.get(fnName)!;

    const values = result.Values ?? [];
    const timestamps = result.Timestamps ?? [];

    switch (metricType) {
      case 'inv':
        fnData.invocations = values;
        fnData.timestamps = timestamps;
        break;
      case 'err':
        fnData.errors = values;
        break;
      case 'thr':
        fnData.throttles = values;
        break;
      case 'durAvg':
        fnData.durationAvg = values;
        break;
      case 'durP99':
        fnData.durationP99 = values;
        break;
    }
  }

  // Build per-function metrics
  const lambdaMetrics: LambdaMetric[] = [];
  const lambdaTsMap = new Map<string, LambdaTimeSeriesPoint>();

  for (const fnName of functionNames) {
    const data = fnResults.get(fnName);
    if (!data) {
      lambdaMetrics.push({
        functionName: fnName,
        invocations: 0,
        errors: 0,
        throttles: 0,
        successCount: 0,
        successRate: 0,
        avgDuration: 0,
        p99Duration: 0,
      });
      continue;
    }

    const totalInvocations = Math.round((data.invocations ?? []).reduce((a, b) => a + b, 0));
    const totalErrors      = Math.round((data.errors ?? []).reduce((a, b) => a + b, 0));
    const totalThrottles   = Math.round((data.throttles ?? []).reduce((a, b) => a + b, 0));
    const totalSuccess     = Math.max(0, totalInvocations - totalErrors - totalThrottles);

    const durAvgValues = data.durationAvg ?? [];
    const avgDurationMs = durAvgValues.length > 0
      ? durAvgValues.reduce((a, b) => a + b, 0) / durAvgValues.length
      : 0;

    const durP99Values = data.durationP99 ?? [];
    const p99DurationMs = durP99Values.length > 0 ? durP99Values[durP99Values.length - 1] : 0;

    lambdaMetrics.push({
      functionName: fnName,
      invocations: totalInvocations,
      errors: totalErrors,
      throttles: totalThrottles,
      successCount: totalSuccess,
      successRate: totalInvocations > 0 ? (totalSuccess / totalInvocations) * 100 : 0,
      avgDuration: Math.round(avgDurationMs * 100) / 100,
      p99Duration: Math.round(p99DurationMs * 100) / 100,
    });

    // Build time series data
    if (data.timestamps && data.invocations) {
      for (let i = 0; i < data.timestamps.length; i++) {
        const ts = data.timestamps[i];
        const key = ts.toISOString();
        if (!lambdaTsMap.has(key)) {
          lambdaTsMap.set(key, { timestamp: key, invocations: 0, errors: 0, successes: 0 });
        }
        const pt = lambdaTsMap.get(key)!;
        pt.invocations += Math.round(data.invocations[i] ?? 0);
        pt.errors      += Math.round((data.errors?.[i] ?? 0) + (data.throttles?.[i] ?? 0));
      }
    }
  }

  // Derive successes for time series
  for (const pt of lambdaTsMap.values()) {
    pt.successes = Math.max(0, pt.invocations - pt.errors);
  }

  // Sort chronologically
  const lambdaTimeSeries: LambdaTimeSeriesPoint[] = Array.from(lambdaTsMap.values()).sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  console.log(`Returning Lambda metrics for ${lambdaMetrics.length} functions, ${lambdaTimeSeries.length} time points`);

  return { lambdaMetrics, lambdaTimeSeries };
}

// ── Write metrics to S3 cache ──────────────────────────────────────
async function fetchAndCacheMetrics(): Promise<void> {
  const [apiResult, lambdaResult] = await Promise.all([
    getApiMetrics('7d'),
    getLambdaMetrics('7d'),
  ]);

  const cachedData: CachedMetrics = {
    routes: apiResult.routes,
    timeSeries: apiResult.timeSeries,
    lambdaMetrics: lambdaResult.lambdaMetrics,
    lambdaTimeSeries: lambdaResult.lambdaTimeSeries,
  };

  await s3.send(new PutObjectCommand({
    Bucket: CACHE_BUCKET,
    Key:    CACHE_KEY,
    Body:   JSON.stringify(cachedData),
    ContentType: 'application/json',
  }));
  console.log('Cached API + Lambda metrics to s3://' + CACHE_BUCKET + '/' + CACHE_KEY);
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
  } catch {
    console.warn('No cached metrics found at s3://' + CACHE_BUCKET + '/' + CACHE_KEY);
    return null;
  }
}

// ── Main handler ──────────────────────────────────────────────────
export const handler = async (event: APIGatewayProxyEventV2 | ScheduledEvent): Promise<APIGatewayProxyResultV2 | void> => {
  // Detect schedule invocation (EventBridge ScheduledEvent has 'source' === 'aws.events')
  if ('source' in event && event.source === 'aws.events') {
    console.log('[schedule] Fetching and caching API + Lambda metrics...');
    try {
      await fetchAndCacheMetrics();
      console.log('[schedule] Metrics cached successfully');
      return;
    } catch (error) {
      console.error('[schedule] Failed to cache metrics:', error);
      return;
    }
  }

  // Regular HTTP invocation
  const httpEvent = event as APIGatewayProxyEventV2;

  // Handle CORS preflight
  if (httpEvent.requestContext.http.method === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }

  try {
    const period = httpEvent.queryStringParameters?.period ?? '24h';

    // Require either API_ID (HTTP API) or API_NAME (REST API)
    if (!API_ID && !API_NAME) {
      console.warn('Neither API_ID nor API_NAME env var is set — returning empty metrics');
      return success({
        routes:    [],
        timeSeries: [],
        lambdaMetrics: [],
        lambdaTimeSeries: [],
        message:   'API_ID (HTTP API) or API_NAME (REST API) not configured',
      });
    }

    // Read from S3 cache — no CloudWatch calls
    const cached = await readFromCache();
    if (cached) {
      return success(cached);
    }

    // Fallback: no cache yet — fetch live (first run only)
    console.warn('No cached data — fetching live metrics from CloudWatch');
    const [apiMetrics, lambdaMetrics] = await Promise.all([
      getApiMetrics(period),
      getLambdaMetrics(period),
    ]);
    return success({
      routes: apiMetrics.routes,
      timeSeries: apiMetrics.timeSeries,
      lambdaMetrics: lambdaMetrics.lambdaMetrics,
      lambdaTimeSeries: lambdaMetrics.lambdaTimeSeries,
    });
  } catch (error) {
    console.error('Failed to fetch metrics:', error);
    return serverError(error instanceof Error ? error.message : 'Failed to fetch metrics');
  }
};