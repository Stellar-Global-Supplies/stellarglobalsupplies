export type AwsCost = { service: string; cost: number };
export type MonthlyTotal = { month: string; total: number };
export type Forecast = { forecastMonth: string; forecastCost: number };
export type AwsCostResponse = {
  services: AwsCost[];
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
  if (year) params.set('year', String(year));
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

const mockServices: AwsCost[] = [
  { service: 'EC2', cost: 120.5 },
  { service: 'S3', cost: 42.3 },
  { service: 'RDS', cost: 18.9 },
  { service: 'CloudFront', cost: 6.25 },
  { service: 'Lambda', cost: 3.1 },
  { service: 'API Gateway', cost: 1.8 },
];

const mockTotals: MonthlyTotal[] = [
  { month: '2026-01', total: 180.0 },
  { month: '2026-02', total: 185.0 },
  { month: '2026-03', total: 192.0 },
  { month: '2026-04', total: 190.0 },
  { month: '2026-05', total: 198.0 },
  { month: '2026-06', total: 195.0 },
];

const mockResponse: AwsCostResponse = {
  services: mockServices,
  monthly_totals: mockTotals,
  forecasts: {
    next_month: [{ forecastMonth: '2026-07', forecastCost: 200.0 }],
    three_months: [
      { forecastMonth: '2026-07', forecastCost: 200.0 },
      { forecastMonth: '2026-08', forecastCost: 205.0 },
      { forecastMonth: '2026-09', forecastCost: 210.0 },
    ],
    six_months: [
      { forecastMonth: '2026-07', forecastCost: 200.0 },
      { forecastMonth: '2026-08', forecastCost: 205.0 },
      { forecastMonth: '2026-09', forecastCost: 210.0 },
      { forecastMonth: '2026-10', forecastCost: 215.0 },
      { forecastMonth: '2026-11', forecastCost: 220.0 },
      { forecastMonth: '2026-12', forecastCost: 225.0 },
    ],
    twelve_months: [
      { forecastMonth: '2026-07', forecastCost: 200.0 },
      { forecastMonth: '2026-08', forecastCost: 205.0 },
      { forecastMonth: '2026-09', forecastCost: 210.0 },
      { forecastMonth: '2026-10', forecastCost: 215.0 },
      { forecastMonth: '2026-11', forecastCost: 220.0 },
      { forecastMonth: '2026-12', forecastCost: 225.0 },
      { forecastMonth: '2027-01', forecastCost: 230.0 },
      { forecastMonth: '2027-02', forecastCost: 235.0 },
      { forecastMonth: '2027-03', forecastCost: 240.0 },
      { forecastMonth: '2027-04', forecastCost: 245.0 },
      { forecastMonth: '2027-05', forecastCost: 250.0 },
      { forecastMonth: '2027-06', forecastCost: 255.0 },
    ],
  },
};
