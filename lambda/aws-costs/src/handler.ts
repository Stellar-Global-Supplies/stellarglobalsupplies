import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { CostExplorerClient, GetCostAndUsageCommand } from '@aws-sdk/client-cost-explorer';

const client = new CostExplorerClient({ region: process.env.AWS_REGION ?? 'us-east-1' });

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10); // YYYY-MM-01
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10); // last day

    const cmd = new GetCostAndUsageCommand({
      TimePeriod: { Start: start, End: end },
      Granularity: 'MONTHLY',
      Metrics: ['UnblendedCost'],
      GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
    });

    const resp = await client.send(cmd);

    const groups = resp.ResultsByTime?.[0]?.Groups ?? [];
    const out = groups.map((g) => {
      const service = (g.Keys && g.Keys[0]) || 'Unknown';
      const amountStr = g.Metrics?.UnblendedCost?.Amount ?? '0';
      return { service, cost: Number(amountStr) };
    }).sort((a, b) => b.cost - a.cost);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(out),
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
