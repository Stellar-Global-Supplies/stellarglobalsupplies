export type AwsCost = { service: string; cost: number };

/**
 * Fetches AWS cost data from the shared API Gateway (/aws-costs route).
 * Uses VITE_API_BASE_URL (the same API Gateway used by all other lambdas)
 * — no separate gateway is needed.
 */
export async function fetchAwsCosts(): Promise<AwsCost[]> {
  const base = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';
  const endpoint = `${base}/aws-costs`;

  try {
    const res = await fetch(endpoint);
    if (!res.ok) {
      console.warn(`${endpoint} returned`, res.status);
      return mockData;
    }
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error(`Invalid payload from ${endpoint}`);
    return data.map((r: any) => ({ service: String(r.service), cost: Number(r.cost ?? 0) }));
  } catch (err) {
    console.error('fetchAwsCosts error', err);
    return mockData;
  }
}

const mockData: AwsCost[] = [
  { service: 'EC2', cost: 120.5 },
  { service: 'S3', cost: 42.3 },
  { service: 'RDS', cost: 18.9 },
  { service: 'CloudFront', cost: 6.25 },
  { service: 'Lambda', cost: 3.1 },
  { service: 'API Gateway', cost: 1.8 },
];
