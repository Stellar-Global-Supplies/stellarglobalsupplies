export type AwsCost = { service: string; cost: number };

export async function fetchAwsCosts(): Promise<AwsCost[]> {
  // This expects an endpoint at /api/aws-costs returning JSON array: [{ service: string, cost: number }, ...]
  // Example response:
  // [{ "service": "EC2", "cost": 123.45 }, { "service": "S3", "cost": 45.67 }]

  try {
    const res = await fetch('/api/aws-costs');
    if (!res.ok) {
      // If API is not available, return a small mock dataset so the UI still works locally.
      console.warn('/api/aws-costs returned', res.status);
      return [
        { service: 'EC2', cost: 120.5 },
        { service: 'S3', cost: 42.3 },
        { service: 'RDS', cost: 18.9 },
        { service: 'CloudFront', cost: 6.25 },
      ];
    }
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('Invalid payload from /api/aws-costs');
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
