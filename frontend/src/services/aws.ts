export type AwsCost = { service: string; cost: number };

export async function fetchAwsCosts(): Promise<AwsCost[]> {
  // Build base URL from Vite env var if present (set during CI build), otherwise use relative /api
  // Vite exposes env vars prefixed with VITE_ via import.meta.env
  const env = (import.meta as any)?.env ?? {};
  const base = (env.VITE_API_BASE_URL as string) || '';
  const endpoint = base ? `${base.replace(/\/$/, '')}/aws-costs` : '/api/aws-costs';

  try {
    const res = await fetch(endpoint);
    if (!res.ok) {
      // If API is not available, return a small mock dataset so the UI still works locally.
      console.warn(`${endpoint} returned`, res.status);
      return [
        { service: 'EC2', cost: 120.5 },
        { service: 'S3', cost: 42.3 },
        { service: 'RDS', cost: 18.9 },
        { service: 'CloudFront', cost: 6.25 },
      ];
    }
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error(`Invalid payload from ${endpoint}`);
    return data.map((r: any) => ({ service: String(r.service), cost: Number(r.cost ?? 0) }));
  } catch (err) {
    console.error('fetchAwsCosts error', err);
    // Fallback mock data
    return [
      { service: 'EC2', cost: 120.5 },
      { service: 'S3', cost: 42.3 },
      { service: 'RDS', cost: 18.9 },
      { service: 'CloudFront', cost: 6.25 },
    ];
  }
}
