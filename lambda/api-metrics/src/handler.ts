import { CloudWatchClient, GetMetricDataCommand, MetricDataQuery } from '@aws-sdk/client-cloudwatch';
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

const REGION = process.env.AWS_REGION ?? 'us-east-1';
const API_NAME = process.env.API_NAME ?? '';

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

function getPeriodInSeconds(period: string): number {
  switch (period) {
    case '1h': return 3600;
    case '24h': return 86400;
    case '7d': return 604800;
    default: return 86400;
  }
}

function getStartTime(period: string): Date {
  const now = new Date();
  switch (period) {
    case '1h': now.setHours(now.getHours() - 1); break;
    case '24h': now.setDate(now.getDate() - 1); break;
    case '7d': now.setDate(now.getDate() - 7); break;
  }
  return now;
}

async function getApiMetrics(period: string): Promise<{ routes: RouteMetric[]; timeSeries: TimeSeriesPoint[] }> {
  const startTime = getStartTime(period);
  const endTime = new Date();
  const periodSeconds = getPeriodInSeconds(period);

  // API Gateway provides these metrics for free
  const metricQueries: MetricDataQuery[] = [
    // Total requests
    {
      Id: 'totalCalls',
      MetricStat: {
        Metric: {
          Namespace: 'AWS/ApiGateway',
          MetricName: 'Count',
          Dimensions: [
            { Name: 'ApiName', Value: API_NAME },
          ],
        },
        Period: periodSeconds,
        Stat: 'Sum',
      },
      ReturnData: true,
    },
    // 4xx errors
    {
      Id: '4xxErrors',
      MetricStat: {
        Metric: {
          Namespace: 'AWS/ApiGateway',
          MetricName: '4XXError',
          Dimensions: [
            { Name: 'ApiName', Value: API_NAME },
          ],
        },
        Period: periodSeconds,
        Stat: 'Sum',
      },
      ReturnData: true,
    },
    // 5xx errors
    {
      Id: '5xxErrors',
      MetricStat: {
        Metric: {
          Namespace: 'AWS/ApiGateway',
          MetricName: '5XXError',
          Dimensions: [
            { Name: 'ApiName', Value: API_NAME },
          ],
        },
        Period: periodSeconds,
        Stat: 'Sum',
      },
      ReturnData: true,
    },
    // Latency
    {
      Id: 'latency',
      MetricStat: {
        Metric: {
          Namespace: 'AWS/ApiGateway',
          MetricName: 'Latency',
          Dimensions: [
            { Name: 'ApiName', Value: API_NAME },
          ],
        },
        Period: periodSeconds,
        Stat: 'Average',
      },
      ReturnData: true,
    },
    // P99 Latency
    {
      Id: 'p99Latency',
      MetricStat: {
        Metric: {
          Namespace: 'AWS/ApiGateway',
          MetricName: 'Latency',
          Dimensions: [
            { Name: 'ApiName', Value: API_NAME },
          ],
        },
        Period: periodSeconds,
        Stat: 'p99',
      },
      ReturnData: true,
    },
  ];

  const command = new GetMetricDataCommand({
    MetricDataQueries: metricQueries,
    StartTime: startTime,
    EndTime: endTime,
  });

  const response = await cw.send(command);

  // Process results
  const totalCallsSeries = response.MetricDataResults?.find(r => r.Id === 'totalCalls');
  const errors4xxSeries = response.MetricDataResults?.find(r => r.Id === '4xxErrors');
  const errors5xxSeries = response.MetricDataResults?.find(r => r.Id === '5xxErrors');
  const latencySeries = response.MetricDataResults?.find(r => r.Id === 'latency');
  const p99LatencySeries = response.MetricDataResults?.find(r => r.Id === 'p99Latency');

  // Build time series
  const timeSeries: TimeSeriesPoint[] = [];
  const timestamps = totalCallsSeries?.Timestamps ?? [];
  
  for (let i = 0; i < timestamps.length; i++) {
    const calls = totalCallsSeries?.Values?.[i] ?? 0;
    const errors4xx = errors4xxSeries?.Values?.[i] ?? 0;
    const errors5xx = errors5xxSeries?.Values?.[i] ?? 0;
    const errors = errors4xx + errors5xx;
    const successes = calls - errors;

    timeSeries.push({
      timestamp: timestamps[i].toISOString(),
      calls: Math.round(calls),
      successes: Math.round(successes),
      errors: Math.round(errors),
    });
  }

  // Calculate aggregate metrics
  const totalCalls = timeSeries.reduce((sum, t) => sum + t.calls, 0);
  const totalSuccess = timeSeries.reduce((sum, t) => sum + t.successes, 0);
  const totalErrors = timeSeries.reduce((sum, t) => sum + t.errors, 0);
  const avgLatency = latencySeries?.Values?.reduce((a, b) => a + b, 0) ?? 0;
  const p99Latency = p99LatencySeries?.Values?.[p99LatencySeries.Values.length - 1] ?? 0;

  // Since CloudWatch API Gateway metrics don't break down by route without custom metrics,
  // we'll return a single aggregate row
  const routes: RouteMetric[] = [{
    route: API_NAME ? `${API_NAME}/*` : 'all',
    method: 'ALL',
    totalCalls: Math.round(totalCalls),
    successCount: Math.round(totalSuccess),
    errorCount: Math.round(totalErrors),
    successRate: totalCalls > 0 ? (totalSuccess / totalCalls) * 100 : 0,
    avgLatency: Math.round(avgLatency / (latencySeries?.Values?.length ?? 1)),
    p99Latency: Math.round(p99Latency),
  }];

  return { routes, timeSeries };
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const period = event.queryStringParameters?.period ?? '24h';

    if (!API_NAME) {
      return success({
        routes: [],
        timeSeries: [],
        message: 'API_NAME not configured - no metrics available'
      });
    }

    const metrics = await getApiMetrics(period);
    return success(metrics);
  } catch (error) {
    console.error('Failed to fetch API metrics:', error);
    return serverError(error instanceof Error ? error.message : 'Failed to fetch metrics');
  }
};