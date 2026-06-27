import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import * as zlib from 'zlib';

const REGION = process.env.AWS_REGION ?? 'us-east-1';
const RAW_BUCKET = process.env.RAW_CUR_BUCKET ?? 'stellarglobal-costing-bucket';
const PROCESSED_BUCKET = process.env.PROCESSED_CUR_BUCKET ?? 'stellarglobal-costing-bucket';

const s3Client = new S3Client({ region: REGION });

interface CURManifest {
  assemblyId: string;
  account: string;
  reportId: string;
  reportName: string;
  bucket: string;
  reportKeys: string[];
  billingPeriod: { start: string; end: string };
}

/**
 * Parse a single CSV line, handling quoted fields correctly.
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

/**
 * Transform a CUR row (with prefixed headers like "lineItem/UnblendedCost")
 * into a simplified cost record.
 *
 * ROOT CAUSE FIX: AWS CUR exports column headers in "category/FieldName" format
 * (e.g. "lineItem/UnblendedCost", "product/ProductName"). The original handler
 * looked up bare names like "UnblendedCost" and "ProductCode", so every field
 * resolved to undefined/0, producing the all-zeros costs.json / summary.json.
 */
function transformCURRecord(headers: string[], values: string[]): any {
  const row: Record<string, string> = {};
  headers.forEach((h, i) => { row[h] = values[i] ?? ''; });

  const toFloat = (v: string) => parseFloat(v) || 0;

  const startDate = row['lineItem/UsageStartDate'] || row['bill/BillingPeriodStartDate'] || '';

  return {
    timestamp: startDate,
    account: row['lineItem/UsageAccountId'] || row['bill/PayerAccountId'] || '',
    service: row['lineItem/ProductCode'] || row['product/servicecode'] || 'Unknown',
    serviceName: row['product/ProductName'] || row['product/servicename'] || row['lineItem/ProductCode'] || 'Unknown',
    region: row['product/regionCode'] || row['product/region'] || 'us-east-1',
    usageType: row['lineItem/UsageType'] || '',
    operation: row['lineItem/Operation'] || '',
    lineItemType: row['lineItem/LineItemType'] || '',
    cost: toFloat(row['lineItem/UnblendedCost']),
    blendedCost: toFloat(row['lineItem/BlendedCost']),
    usageAmount: toFloat(row['lineItem/UsageAmount']),
  };
}

async function processCURManifest(manifest: CURManifest): Promise<void> {
  console.log('Processing CUR manifest:', manifest.reportId);

  const reportKey = manifest.reportKeys[0];
  console.log('Downloading:', reportKey);

  const s3Object = await s3Client.send(
    new GetObjectCommand({ Bucket: RAW_BUCKET, Key: reportKey }),
  );

  if (!s3Object.Body) throw new Error('No body in S3 object');

  const chunks: Buffer[] = [];
  for await (const chunk of s3Object.Body as any) chunks.push(chunk);
  const compressedBuffer = Buffer.concat(chunks);
  const decompressedBuffer = zlib.gunzipSync(compressedBuffer);
  const csvText = decompressedBuffer.toString('utf-8');

  const lines = csvText.split('\n').filter(l => l.trim());
  if (lines.length < 2) { console.log('No data rows in CSV'); return; }

  const headers = parseCSVLine(lines[0]);
  console.log(`CSV headers (first 5): ${headers.slice(0, 5).join(', ')}`);
  console.log(`Processing ${lines.length - 1} rows`);

  const transformedRecords: any[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length === headers.length) {
      transformedRecords.push(transformCURRecord(headers, values));
    }
  }

  console.log(`Transformed ${transformedRecords.length} records`);

  // Aggregate by date + service
  const aggregated: Record<string, any> = {};
  transformedRecords.forEach(record => {
    const date = record.timestamp?.split('T')[0] || 'unknown';
    const key = `${date}_${record.service}`;
    if (!aggregated[key]) {
      aggregated[key] = {
        date,
        service: record.service,
        serviceName: record.serviceName,
        region: record.region,
        totalCost: 0,
        totalBlendedCost: 0,
        totalUsage: 0,
        recordCount: 0,
      };
    }
    aggregated[key].totalCost += record.cost;
    aggregated[key].totalBlendedCost += record.blendedCost;
    aggregated[key].totalUsage += record.usageAmount;
    aggregated[key].recordCount++;
  });

  const aggregatedArray = Object.values(aggregated);
  console.log(`Aggregated to ${aggregatedArray.length} records`);

  const startDate = manifest.billingPeriod.start.replace(/T.*$/, '');
  const endDate   = manifest.billingPeriod.end.replace(/T.*$/, '');
  const billingPeriodPath = `${startDate}-${endDate}`;

  const outputKey = `processed/${billingPeriodPath}/costs.json`;
  await s3Client.send(new PutObjectCommand({
    Bucket: PROCESSED_BUCKET,
    Key: outputKey,
    Body: JSON.stringify(aggregatedArray, null, 2),
    ContentType: 'application/json',
  }));
  console.log('Saved processed data to:', outputKey);

  const monthlySummary = aggregateByMonth(aggregatedArray);
  const summaryKey = `processed/${billingPeriodPath}/summary.json`;
  await s3Client.send(new PutObjectCommand({
    Bucket: PROCESSED_BUCKET,
    Key: summaryKey,
    Body: JSON.stringify(monthlySummary, null, 2),
    ContentType: 'application/json',
  }));
  console.log('Saved monthly summary to:', summaryKey);
}

function aggregateByMonth(records: any[]): any[] {
  const monthly: Record<string, any> = {};
  records.forEach(record => {
    const month = record.date?.substring(0, 7) || 'unknown';
    if (!monthly[month]) {
      monthly[month] = { month, totalCost: 0, services: {} };
    }
    monthly[month].totalCost += record.totalCost;
    if (!monthly[month].services[record.service]) {
      monthly[month].services[record.service] = {
        service: record.service,
        serviceName: record.serviceName,
        cost: 0,
      };
    }
    monthly[month].services[record.service].cost += record.totalCost;
  });
  return Object.values(monthly).map((m: any) => ({
    ...m,
    services: Object.values(m.services),
  }));
}

async function cleanupOldProcessedFiles(daysOld: number = 2): Promise<void> {
  console.log(`Cleaning up processed files older than ${daysOld} days...`);
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    const listResponse = await s3Client.send(new ListObjectsV2Command({
      Bucket: PROCESSED_BUCKET, Prefix: 'processed/', MaxKeys: 1000,
    }));
    if (!listResponse.Contents?.length) { console.log('No processed files to clean up'); return; }
    const oldFiles = listResponse.Contents.filter(obj => obj.LastModified && obj.LastModified < cutoffDate);
    console.log(`Deleting ${oldFiles.length} old files`);
    for (const file of oldFiles) {
      if (file.Key) await s3Client.send(new DeleteObjectCommand({ Bucket: PROCESSED_BUCKET, Key: file.Key }));
    }
  } catch (error) {
    console.error('Cleanup error:', error);
  }
}

async function processLatestCUR(): Promise<void> {
  console.log('Starting CUR processing...');
  const listResponse = await s3Client.send(new ListObjectsV2Command({
    Bucket: RAW_BUCKET, Prefix: 'awscost/awscost/', MaxKeys: 100,
  }));
  if (!listResponse.Contents?.length) { console.log('No files found'); return; }

  const manifestFiles = listResponse.Contents
    .filter(obj => obj.Key?.toLowerCase().endsWith('manifest.json'))
    .sort((a, b) => (b.LastModified?.getTime() || 0) - (a.LastModified?.getTime() || 0));

  if (!manifestFiles.length) { console.log('No manifest files found'); return; }

  const latestManifestKey = manifestFiles[0].Key!;
  console.log('Processing manifest:', latestManifestKey);

  const manifestObject = await s3Client.send(new GetObjectCommand({ Bucket: RAW_BUCKET, Key: latestManifestKey }));
  const manifestText = await manifestObject.Body?.transformToString();
  const manifest: CURManifest = JSON.parse(manifestText || '{}');
  await processCURManifest(manifest);
  console.log('CUR processing completed successfully');
}

export const handler = async (event: any): Promise<any> => {
  try {
    console.log('Event:', JSON.stringify(event, null, 2));

    if (event.source === 'aws.events' && event['detail-type'] === 'Scheduled Event') {
      await cleanupOldProcessedFiles(2);
      await processLatestCUR();
      return { statusCode: 200, body: JSON.stringify({ success: true, message: 'CUR processed and cleanup completed' }) };
    }

    if (event.body) {
      try {
        const body = JSON.parse(event.body);
        if (body.reportName === 'awscost' || body.assemblyId) {
          await processCURManifest(body as CURManifest);
          return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: true, message: 'CUR processed successfully' }) };
        }
      } catch (e) { /* not JSON, fall through */ }
    }

    if (event.Records?.[0]?.eventSource === 'aws:s3') {
      const objectKey = event.Records[0].s3.object.key;
      if (objectKey?.endsWith('manifest.json')) {
        const manifestObject = await s3Client.send(new GetObjectCommand({ Bucket: RAW_BUCKET, Key: objectKey }));
        const manifestText = await manifestObject.Body?.transformToString();
        const manifest: CURManifest = JSON.parse(manifestText || '{}');
        await processCURManifest(manifest);
        return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: true, message: 'CUR processed successfully' }) };
      }
    }

    await processLatestCUR();
    return { statusCode: 200, body: JSON.stringify({ success: true, message: 'CUR processed successfully' }) };
  } catch (error) {
    console.error('CUR processor error:', error);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to process CUR', detail: error instanceof Error ? error.message : 'Unknown error' }) };
  }
};