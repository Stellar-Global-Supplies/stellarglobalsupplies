export type AwsCost = {
  service: string;
  serviceName?: string;   // added: human-readable name from CUR (e.g. "Amazon Route 53")
  cost: number;
};
export type MonthlyTotal = { month: string; total: number };
export type Forecast = { forecastMonth: string; forecastCost: number };
export type AwsCostResponse = {
  services: AwsCost[];
  selected_period: string;
  monthly_totals: MonthlyTotal[];
  forecasts: {
    next_month: Forecast[];
    three_months: Forecast[];
    six_months: Forecast[];
    twelve_months: Forecast[];
  };
};

/**
 * Fetches AWS cost data from the shared API Gateway (/aws-costs route).
 * Supports ?year=N&month=N query params for specific month selection.
 */
export async function fetchAwsCosts(year?: number, month?: number): Promise<AwsCostResponse> {
  const base = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';
  const params = new URLSearchParams();
  if (year)  params.set('year',  String(year));
  if (month) params.set('month', String(month));
  const endpoint = `${base}/aws-costs?${params.toString()}`;

  try {
    const res = await fetch(endpoint);
    if (!res.ok) {
      console.warn(`${endpoint} returned`, res.status);
      return mockResponse;
    }
    const data = await res.json();
    return data as AwsCostResponse;
  } catch (err) {
    console.error('fetchAwsCosts error', err);
    return mockResponse;
  }
}

// ── Mock data (used when the API is unreachable) ─────────────────────────────
const mockServices: AwsCost[] = [
  { service: 'AWSCostExplorer',  serviceName: 'AWS Cost Explorer',              cost: 0.61   },
  { service: 'AmazonRoute53',    serviceName: 'Amazon Route 53',                cost: 0.594  },
  { service: 'AmazonS3',        serviceName: 'Amazon Simple Storage Service',   cost: 0.046  },
  { service: 'AmazonBedrock',   serviceName: 'Amazon Bedrock',                  cost: 0.034  },
  { service: 'AmazonDynamoDB',  serviceName: 'Amazon DynamoDB',                 cost: 0.002  },
  { service: 'AmazonApiGateway',serviceName: 'Amazon API Gateway',              cost: 0.001  },
];

const mockTotals: MonthlyTotal[] = [
  { month: '2026-06', total: 1.29 },
];

const mockResponse: AwsCostResponse = {
  services: mockServices,
  selected_period: '2026-06',
  monthly_totals: mockTotals,
  forecasts: {
    next_month:    [{ forecastMonth: '2026-07', forecastCost: 1.49 }],
    three_months:  [
      { forecastMonth: '2026-07', forecastCost: 1.49 },
      { forecastMonth: '2026-08', forecastCost: 1.49 },
      { forecastMonth: '2026-09', forecastCost: 1.49 },
    ],
    six_months:    Array.from({ length: 6 }, (_, i) => ({
      forecastMonth: `2026-${String(7 + i).padStart(2, '0')}`,
      forecastCost: 1.49,
    })),
    twelve_months: Array.from({ length: 12 }, (_, i) => {
      const d = new Date(2026, 6 + i, 1);
      return {
        forecastMonth: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        forecastCost: 1.49,
      };
    }),
  },
};