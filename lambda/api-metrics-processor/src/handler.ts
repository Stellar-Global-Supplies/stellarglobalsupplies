import { CloudWatchClient, GetMetricDataCommand, ListMetricsCommand } from '@aws-sdk/client-cloudwatch';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { ScheduledEvent } from 'aws-lambda';

const REGION      = process.env.AWS_REGION    ?? 'us-east-1';
const CACHE_BUCKET = process.env.CACHE_BUCKET  ?? 'stellar-analytics-reports-471112840461';
const CACHE_KEY    = 'api-metrics/latest.json';

// Configure multiple APIs to monitor
const APIS_TO_MONITOR = [
  { name: 'stellar-oms-api', id: 'rjwx3tdkx3' },
  { name: 'ops-api', id: 'wtt3awq1xg' },
];

const cw = new CloudWatchClient({ region: REGION });
const s3 = new S3Client({ region: REGION });

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

function getGranularitySeconds(period: string): number {
  switch (period) {
    case '1h':  return 300;
    case '24h': return 3600;
    case '7d':  return 86400;
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

  console.log('Fetching API metrics for multiple APIs | period:', period);

  const allRoutes: RouteMetric[] = [];
  const allTimeSeries: TimeSeriesPoint[] = [];

  // Fetch metrics for each API
  for (const api of APIS_TO_MONITOR) {
    const isHttpApi      = true; // All configured APIs are HTTP APIs
    const dimension      = { Name: 'ApiId', Value: api.id };
    const error4xxMetric = '4xx';
    const error5xxMetric = '5xx';
    const displayName    = api.id;

    console.log(`Fetching metrics for ${api.name} (${api.id})`);

    const metricQueries = [
      {
        Id: `totalCalls_${api.id}`,
        MetricStat: {
          Metric: { Namespace: 'AWS/ApiGateway', MetricName: 'Count', Dimensions: [dimension] },
          Period: granularitySeconds,
          Stat:   'Sum',
        },
        ReturnData: true,
      },
      {
        Id: `errors4xx_${api.id}`,
        MetricStat: {
          Metric: { Namespace: 'AWS/ApiGateway', MetricName: error4xxMetric, Dimensions: [dimension] },
          Period: granularitySeconds,
          Stat:   'Sum',
        },
        ReturnData: true,
      },
      {
        Id: `errors5xx_${api.id}`,
        MetricStat: {
          Metric: { Namespace: 'AWS/ApiGateway', MetricName: error5xxMetric, Dimensions: [dimension] },
          Period: granularitySeconds,
          Stat:   'Sum',
        },
        ReturnData: true,
      },
      {
        Id: `latency_${api.id}`,
        MetricStat: {
          Metric: { Namespace: 'AWS/ApiGateway', MetricName: 'Latency', Dimensions: [dimension] },
          Period: granularitySeconds,
          Stat:   'Average',
        },
        ReturnData: true,
      },
      {
        Id: `p99Latency_${api.id}`,
        MetricStat: {
          Metric: { Namespace: 'AWS/ApiGateway', MetricName: 'Latency', Dimensions: [dimension] },
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

    const totalCallsSeries = response.MetricDataResults?.find(r => r.Id === `totalCalls_${api.id}`);
    const errors4xxSeries  = response.MetricDataResults?.find(r => r.Id === `errors4xx_${api.id}`);
    const errors5xxSeries  = response.MetricDataResults?.find(r => r.Id === `errors5xx_${api.id}`);
    const latencySeries    = response.MetricDataResults?.find(r => r.Id === `latency_${api.id}`);
    const p99LatencySeries = response.MetricDataResults?.find(r => r.Id === `p99Latency_${api.id}`);

    const tsMap = new Map<string, TimeSeriesPoint>();

    const allTimestamps = [
      ...(totalCallsSeries?.Timestamps ?? []),
      ...(errors4xxSeries?.Timestamps  ?? []),
      ...(errors5xxSeries?.Timestamps  ?? []),
    ];

    for (const ts of allTimestamps) {
      const key = ts.toISOString();
      if (!tsMap.has(key)) {
        tsMap.set(key, { timestamp: key, calls: 0, successes: 0, errors: 0 });
      }
    }

    (totalCallsSeries?.Timestamps ?? []).forEach((ts, idx) => {
      const key = ts.toISOString();
      const pt  = tsMap.get(key)!;
      pt.calls  = Math.round(totalCallsSeries?.Values?.[idx] ?? 0);
    });

    (errors4xxSeries?.Timestamps ?? []).forEach((ts, idx) => {
      const key = ts.toISOString();
      const pt  = tsMap.get(key)!;
      pt.errors += Math.round(errors4xxSeries?.Values?.[idx] ?? 0);
    });
    (errors5xxSeries?.Timestamps ?? []).forEach((ts, idx) => {
      const key = ts.toISOString();
      const pt  = tsMap.get(key)!;
      pt.errors += Math.round(errors5xxSeries?.Values?.[idx] ?? 0);
    });

    for (const pt of tsMap.values()) {
      pt.successes = Math.max(0, pt.calls - pt.errors);
    }

    const timeSeries: TimeSeriesPoint[] = Array.from(tsMap.values()).sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

    const totalCalls   = timeSeries.reduce((sum, t) => sum + t.calls,     0);
    const totalSuccess = timeSeries.reduce((sum, t) => sum + t.successes, 0);
    const totalErrors  = timeSeries.reduce((sum, t) => sum + t.errors,    0);

    const latencyValues = latencySeries?.Values ?? [];
    const avgLatencyMs  = latencyValues.length > 0
      ? latencyValues.reduce((a, b) => a + b, 0) / latencyValues.length
      : 0;

    const p99Values  = p99LatencySeries?.Values ?? [];
    const p99Latency = p99Values.length > 0 ? p99Values[p99Values.length - 1] : 0;

    const routeMetric: RouteMetric = {
      route:        `${api.name}/*`,
      method:       'ALL',
      totalCalls:   Math.round(totalCalls),
      successCount: Math.round(totalSuccess),
      errorCount:   Math.round(totalErrors),
      successRate:  totalCalls > 0 ? (totalSuccess / totalCalls) * 100 : 0,
      avgLatency:   Math.round(avgLatencyMs),
      p99Latency:   Math.round(p99Latency),
    };

    allRoutes.push(routeMetric);
    allTimeSeries.push(...timeSeries);
  }

  return { routes: allRoutes, timeSeries: allTimeSeries };
}

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

async function getLambdaMetrics(period: string): Promise<{
  lambdaMetrics: LambdaMetric[];
  lambdaTimeSeries: LambdaTimeSeriesPoint[];
}> {
  const startTime          = getStartTime(period);
  const endTime            = new Date();
  const granularitySeconds = getGranularitySeconds(period);

  console.log('Fetching Lambda metrics | period:', period);

  const functionNames = await listLambdaFunctions();
  console.log(`Discovered ${functionNames.length} Lambda functions`);

  if (functionNames.length === 0) {
    return { lambdaMetrics: [], lambdaTimeSeries: [] };
  }

  const queries: any[] = [];
  const queryIdMap: Array<{ functionName: string; metricType: string }> = [];

  for (let i = 0; i < functionNames.length; i++) {
    const fn = functionNames[i];
    const dim = { Name: 'FunctionName', Value: fn };

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
    const parts = id.split('_');
    const metricType = parts[0];
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

  for (const pt of lambdaTsMap.values()) {
    pt.successes = Math.max(0, pt.invocations - pt.errors);
  }

  const lambdaTimeSeries: LambdaTimeSeriesPoint[] = Array.from(lambdaTsMap.values()).sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  return { lambdaMetrics, lambdaTimeSeries };
}

async function processAndCacheMetrics(): Promise<void> {
  console.log('Processing API and Lambda metrics...');
  
  const [apiResult, lambdaResult] = await Promise.all([
    getApiMetrics('24h'),
    getLambdaMetrics('24h'),
  ]);

  const cachedData: CachedMetrics = {
    routes: apiResult.routes,
    timeSeries: apiResult.timeSeries,
    lambdaMetrics: lambdaResult.lambdaMetrics,
    lambdaTimeSeries: lambdaResult.lambdaTimeSeries,
    cachedAt: new Date().toISOString(),
  };

  await s3.send(new PutObjectCommand({
    Bucket: CACHE_BUCKET,
    Key:    CACHE_KEY,
    Body:   JSON.stringify(cachedData),
    ContentType: 'application/json',
  }));

  console.log(`Successfully cached metrics to s3://${CACHE_BUCKET}/${CACHE_KEY}`);
  console.log(`  - ${cachedData.routes.length} API routes`);
  console.log(`  - ${cachedData.timeSeries.length} time series points`);
  console.log(`  - ${cachedData.lambdaMetrics.length} Lambda functions`);
  console.log(`  - ${cachedData.lambdaTimeSeries.length} Lambda time series points`);
}

export const handler = async (event: ScheduledEvent): Promise<void> => {
  console.log('API Metrics Processor triggered by EventBridge');
  
  try {
    await processAndCacheMetrics();
    console.log('Metrics processing completed successfully');
  } catch (error) {
    console.error('Failed to process metrics:', error);
    throw error;
  }
};