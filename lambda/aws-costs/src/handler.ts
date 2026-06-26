import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { CostExplorerClient, GetCostAndUsageCommand } from '@aws-sdk/client-cost-explorer';

const client = new CostExplorerClient({ region: process.env.AWS_REGION ?? 'us-east-1' });

/** Fetch AWS costs for a given number of months back, grouped by service */
async function fetchCostsForPeriod(monthsBack: number) {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10); // last day of current month
  const start = new Date(now.getFullYear(), now.getMonth() - monthsBack + 1, 1).toISOString().slice(0, 10);

  const cmd = new GetCostAndUsageCommand({
    TimePeriod: { Start: start, End: end },
    Granularity: 'MONTHLY',
    Metrics: ['UnblendedCost'],
    GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
  });

  const resp = await client.send(cmd);
  return resp.ResultsByTime ?? [];
}

/** Aggregate multiple months of cost data into a single service-level breakdown */
function aggregateByService(results: any[]): { service: string; cost: number }[] {
  const totals: Record<string, number> = {};

  for (const month of results) {
    for (const group of month.Groups ?? []) {
      const service = (group.Keys && group.Keys[0]) || 'Unknown';
      const amount = Number(group.Metrics?.UnblendedCost?.Amount ?? '0');
      totals[service] = (totals[service] ?? 0) + amount;
    }
  }

  return Object.entries(totals)
    .map(([service, cost]) => ({ service, cost: Math.round(cost * 100) / 100 }))
    .sort((a, b) => b.cost - a.cost);
}

/** Calculate a linear regression forecast based on monthly totals */
function forecastCosts(
  monthlyTotals: { month: string; total: number }[],
  monthsToForecast: number,
): { forecastMonth: string; forecastCost: number }[] {
  if (monthlyTotals.length < 2) return [];

  const n = monthlyTotals.length;
  const indices = monthlyTotals.map((_, i) => i);
  const totals = monthlyTotals.map((m) => m.total);

  // Linear regression: y = mx + b
  const sumX = indices.reduce((a, b) => a + b, 0);
  const sumY = totals.reduce((a, b) => a + b, 0);
  const sumXY = indices.reduce((a, i) => a + i * totals[i], 0);
  const sumX2 = indices.reduce((a, i) => a + i * i, 0);

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  const forecasts: { forecastMonth: string; forecastCost: number }[] = [];
  const lastDate = new Date(monthlyTotals[n - 1].month + '-01');
  
  for (let i = 1; i <= monthsToForecast; i++) {
    const forecastDate = new Date(lastDate.getFullYear(), lastDate.getMonth() + i, 1);
    const forecastIndex = n + i - 1;
    const forecast = Math.max(0, Math.round((slope * forecastIndex + intercept) * 100) / 100);
    forecasts.push({
      forecastMonth: `${forecastDate.getFullYear()}-${String(forecastDate.getMonth() + 1).padStart(2, '0')}`,
      forecastCost: forecast,
    });
  }

  return forecasts;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    // Parse year and month query params (default: current month)
    const now = new Date();
    const yearParam = event.queryStringParameters?.year;
    const monthParam = event.queryStringParameters?.month;
    
    const selectedYear = yearParam ? parseInt(yearParam, 10) : now.getFullYear();
    const selectedMonth = monthParam ? parseInt(monthParam, 10) : now.getMonth() + 1;
    
    // Validate month range
    const month = Math.min(Math.max(selectedMonth, 1), 12);
    const year = selectedYear;

    // Calculate start and end dates for the selected month
    const startDate = new Date(year, month - 1, 1).toISOString().slice(0, 10);
    const endDate = new Date(year, month, 0).toISOString().slice(0, 10); // Last day of selected month

    // Fetch data for the selected month
    const cmd = new GetCostAndUsageCommand({
      TimePeriod: { Start: startDate, End: endDate },
      Granularity: 'MONTHLY',
      Metrics: ['UnblendedCost'],
      GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
    });

    const resp = await client.send(cmd);
    const results = [resp.ResultsByTime?.[0] ?? {}];
    
    // Also fetch last 6 months for trend/forecast context
    const contextMonths = 6;
    const contextStart = new Date(year, month - contextMonths, 1).toISOString().slice(0, 10);
    const contextCmd = new GetCostAndUsageCommand({
      TimePeriod: { Start: contextStart, End: endDate },
      Granularity: 'MONTHLY',
      Metrics: ['UnblendedCost'],
      GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
    });
    const contextResp = await client.send(contextCmd);
    const contextResults = contextResp.ResultsByTime ?? [];
    const aggregated = aggregateByService(results);

    // Monthly totals for trend/forecast
    const monthlyTotals = results.map((r: any) => ({
      month: r.TimePeriod?.Start?.slice(0, 7) ?? 'unknown',
      total: (r.Groups ?? []).reduce(
        (sum: number, g: any) => sum + Number(g.Metrics?.UnblendedCost?.Amount ?? 0),
        0,
      ),
    }));

    // Generate forecasts based on context data
    const contextMonthlyTotals = contextResults.map((r: any) => ({
      month: r.TimePeriod?.Start?.slice(0, 7) ?? 'unknown',
      total: (r.Groups ?? []).reduce(
        (sum: number, g: any) => sum + Number(g.Metrics?.UnblendedCost?.Amount ?? 0),
        0,
      ),
    }));

    const forecastNextMonth = forecastCosts(contextMonthlyTotals, 1);
    const forecast3Month = forecastCosts(contextMonthlyTotals, 3);
    const forecast6Month = forecastCosts(contextMonthlyTotals, 6);
    const forecast12Month = forecastCosts(contextMonthlyTotals, 12);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        services: aggregated,
        selected_period: `${year}-${String(month).padStart(2, '0')}`,
        monthly_totals: contextMonthlyTotals,
        forecasts: {
          next_month: forecastNextMonth,
          three_months: forecast3Month,
          six_months: forecast6Month,
          twelve_months: forecast12Month,
        },
      }),
    };
  } catch (err) {
    console.error('aws-costs lambda error', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to fetch AWS cost data' }),
    };
  }
};
