import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { S3Client, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

const s3Client = new S3Client({ region: process.env.AWS_REGION ?? 'us-east-1' });
const PROCESSED_BUCKET = process.env.PROCESSED_CUR_BUCKET!;

/** Aggregate multiple months of cost data into a single service-level breakdown */
function aggregateByService(results: any[]): { service: string; serviceName?: string; cost: number }[] {
  const totals: Record<string, { cost: number; serviceName?: string }> = {};

  for (const month of results) {
    for (const group of month.Groups ?? []) {
      const service = (group.Keys && group.Keys[0]) || 'Unknown';
      const amount = Number(group.Metrics?.UnblendedCost?.Amount ?? '0');
      if (!totals[service]) totals[service] = { cost: 0, serviceName: group.ServiceName };
      totals[service].cost += amount;
    }
  }

  return Object.entries(totals)
    .map(([service, { cost, serviceName }]) => ({
      service,
      serviceName,
      cost: Math.round(cost * 1e6) / 1e6,   // keep 6 decimal places (costs can be < $0.001)
    }))
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
    const forecast = Math.max(0, Math.round((slope * forecastIndex + intercept) * 1e6) / 1e6);
    forecasts.push({
      forecastMonth: `${forecastDate.getFullYear()}-${String(forecastDate.getMonth() + 1).padStart(2, '0')}`,
      forecastCost: forecast,
    });
  }

  return forecasts;
}

/**
 * Extract the start date from a processed/ S3 key for sorting.
 *
 * BUG FIX: cur-processor writes paths like:
 *   processed/2026-06-01-2026-07-01/summary.json   (YYYY-MM-DD format)
 *
 * The old regex /processed\/(\d{8})[T-](\d{8})/ expected 8-digit dates
 * (YYYYMMDD) so it never matched, making sort order undefined and
 * potentially loading the wrong or no summary file.
 *
 * New regex handles both formats:
 *   YYYY-MM-DD-YYYY-MM-DD  (cur-processor output)
 *   YYYYMMDD-YYYYMMDD      (legacy compact format)
 *   YYYYMMDDT000000.000Z-YYYYMMDDT000000.000Z (old timestamp format)
 */
function extractSortKey(key: string): string {
  // YYYY-MM-DD-YYYY-MM-DD  →  capture first YYYY-MM-DD
  const dashDate = key.match(/processed\/(\d{4}-\d{2}-\d{2})/);
  if (dashDate) return dashDate[1];                         // e.g. "2026-06-01"

  // YYYYMMDD (compact/timestamp format)
  const compactDate = key.match(/processed\/(\d{8})/);
  if (compactDate) return compactDate[1];                   // e.g. "20260601"

  return '';
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const now = new Date();
    const yearParam  = event.queryStringParameters?.year;
    const monthParam = event.queryStringParameters?.month;

    const selectedYear  = yearParam  ? parseInt(yearParam,  10) : now.getFullYear();
    const selectedMonth = monthParam ? parseInt(monthParam, 10) : now.getMonth() + 1;

    const month = Math.min(Math.max(selectedMonth, 1), 12);
    const year  = selectedYear;

    const startDate = new Date(year, month - 1, 1).toISOString().slice(0, 10);
    const endDate   = new Date(year, month, 0).toISOString().slice(0, 10);

    let aggregated: { service: string; serviceName?: string; cost: number }[] = [];
    let contextResults: any[] = [];
    let curDataLoaded = false;

    try {
      const listResponse = await s3Client.send(
        new ListObjectsV2Command({ Bucket: PROCESSED_BUCKET, Prefix: 'processed/', MaxKeys: 100 }),
      );

      if (listResponse.Contents && listResponse.Contents.length > 0) {
        // FIX: use extractSortKey() instead of the broken 8-digit regex
        const latestSummary = listResponse.Contents
          .filter(obj => obj.Key?.endsWith('summary.json'))
          .sort((a, b) => extractSortKey(b.Key || '').localeCompare(extractSortKey(a.Key || '')))[0];

        if (latestSummary?.Key) {
          console.log('Loading summary from:', latestSummary.Key);

          const summaryObject = await s3Client.send(
            new GetObjectCommand({ Bucket: PROCESSED_BUCKET, Key: latestSummary.Key }),
          );

          const summaryText = await summaryObject.Body?.transformToString();
          const summaryData: any[] = JSON.parse(summaryText || '[]');

          const selectedMonthKey = `${year}-${String(month).padStart(2, '0')}`;
          const selectedMonthData = summaryData.find((m: any) => m.month === selectedMonthKey);

          if (selectedMonthData) {
            // FIX: map serviceName through so the response carries it
            aggregated = selectedMonthData.services.map((s: any) => ({
              service:     s.service,
              serviceName: s.serviceName,
              cost:        s.cost,
            }));
            curDataLoaded = true;
          }

          // Build contextResults from all months in summary (for forecasting)
          contextResults = summaryData.slice(-7).map((m: any) => ({
            TimePeriod: { Start: `${m.month}-01`, End: `${m.month}-28` },
            Groups: m.services.map((s: any) => ({
              Keys:        [s.service],
              ServiceName: s.serviceName,
              Metrics:     { UnblendedCost: { Amount: String(s.cost) } },
            })),
          }));
        }
      }
    } catch (error) {
      console.error('Failed to load CUR data from S3:', error);
    }

    // FIX: only fall back to mock data when NO summary file was found at all,
    // not when aggregated is empty (which happens legitimately when real costs
    // are all $0.00 for the selected month).
    if (!curDataLoaded) {
      console.log('No CUR data found — using mock data');
      const mockResults = [{
        TimePeriod: { Start: startDate, End: endDate },
        Groups: [
          { Keys: ['EC2'],         Metrics: { UnblendedCost: { Amount: '120.50' } } },
          { Keys: ['S3'],          Metrics: { UnblendedCost: { Amount: '42.30'  } } },
          { Keys: ['RDS'],         Metrics: { UnblendedCost: { Amount: '18.90'  } } },
          { Keys: ['CloudFront'],  Metrics: { UnblendedCost: { Amount: '6.25'   } } },
          { Keys: ['Lambda'],      Metrics: { UnblendedCost: { Amount: '3.10'   } } },
          { Keys: ['API Gateway'], Metrics: { UnblendedCost: { Amount: '1.80'   } } },
        ],
      }];

      aggregated = aggregateByService(mockResults);

      contextResults = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(year, month - i, 1);
        const variation = 0.9 + Math.random() * 0.2;
        contextResults.push({
          TimePeriod: {
            Start: d.toISOString().slice(0, 10),
            End: new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10),
          },
          Groups: [
            { Keys: ['EC2'],         Metrics: { UnblendedCost: { Amount: String(120.50 * variation) } } },
            { Keys: ['S3'],          Metrics: { UnblendedCost: { Amount: String(42.30  * variation) } } },
            { Keys: ['RDS'],         Metrics: { UnblendedCost: { Amount: String(18.90  * variation) } } },
            { Keys: ['CloudFront'],  Metrics: { UnblendedCost: { Amount: String(6.25   * variation) } } },
            { Keys: ['Lambda'],      Metrics: { UnblendedCost: { Amount: String(3.10   * variation) } } },
            { Keys: ['API Gateway'], Metrics: { UnblendedCost: { Amount: String(1.80   * variation) } } },
          ],
        });
      }
    }

    const contextMonthlyTotals = contextResults.map((r: any) => ({
      month: r.TimePeriod?.Start?.slice(0, 7) ?? 'unknown',
      total: (r.Groups ?? []).reduce(
        (sum: number, g: any) => sum + Number(g.Metrics?.UnblendedCost?.Amount ?? 0),
        0,
      ),
    }));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        services:        aggregated,
        selected_period: `${year}-${String(month).padStart(2, '0')}`,
        monthly_totals:  contextMonthlyTotals,
        forecasts: {
          next_month:    forecastCosts(contextMonthlyTotals, 1),
          three_months:  forecastCosts(contextMonthlyTotals, 3),
          six_months:    forecastCosts(contextMonthlyTotals, 6),
          twelve_months: forecastCosts(contextMonthlyTotals, 12),
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