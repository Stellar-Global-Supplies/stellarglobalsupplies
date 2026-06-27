import { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import * as zlib from 'zlib';
import * as csv from 'csv-parser';

const REGION = process.env.AWS_REGION ?? 'us-east-1';
const RAW_BUCKET = process.env.RAW_CUR_BUCKET!;
const PROCESSED_BUCKET = process.env.PROCESSED_CUR_BUCKET!;

const s3Client = new S3Client({ region: REGION });

interface CURManifest {
  assemblyId: string;
  account: string;
  reportId: string;
  reportName: string;
  bucket: string;
  reportKeys: string[];
  billingPeriod: {
    start: string;
    end: string;
  };
}

interface CostRecord {
  identity: {
    LineItemId: string;
    TimeInterval: string;
  };
  bill: {
    InvoiceId: string;
    BillingPeriodStartDate: string;
    BillingPeriodEndDate: string;
    PayerAccountId: string;
  };
  lineItem: {
    UsageAccountId: string;
    LineItemType: string;
    UsageStartDate: string;
    UsageEndDate: string;
    ProductCode: string;
    UsageType: string;
    Operation: string;
    AvailabilityZone: string;
    UsageAmount: number;
    UnblendedRate: string;
    UnblendedCost: number;
    BlendedRate: string;
    BlendedCost: number;
    LineItemDescription: string;
  };
  product: {
    ProductName: string;
    productFamily: string;
    region: string;
    regionCode: string;
    servicename: string;
  };
}

/**
 * Parse CSV line by line
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Transform raw CUR CSV to simplified JSON format
 */
function transformCURRecord(headers: string[], values: string[]): any {
  const record: any = {};
  
  headers.forEach((header, index) => {
    const value = values[index] || '';
    
    // Parse numeric fields
    if (['UsageAmount', 'UnblendedCost', 'BlendedCost', 'NormalizedUsageAmount'].includes(header)) {
      record[header] = parseFloat(value) || 0;
    } else {
      record[header] = value;
    }
  });

  // Create simplified structure
  return {
    timestamp: record.UsageStartDate || record.BillingPeriodStartDate,
    account: record.UsageAccountId || record.PayerAccountId,
    service: record.ProductCode || record.servicename || 'Unknown',
    serviceName: record.ProductName || record.servicename || 'Unknown',
    region: record.regionCode || record.region || 'us-east-1',
    usageType: record.UsageType,
    operation: record.Operation,
    cost: record.UnblendedCost || 0,
    blendedCost: record.BlendedCost || 0,
    usageAmount: record.UsageAmount || 0,
    lineItemType: record.LineItemType,
  };
}

/**
 * Process CUR manifest and transform data
 */
async function processCURManifest(manifest: CURManifest): Promise<void> {
  console.log('Processing CUR manifest:', manifest.reportId);

  // Download and decompress the CSV file
  const reportKey = manifest.reportKeys[0];
  console.log('Downloading:', reportKey);

  const s3Object = await s3Client.send(
    new GetObjectCommand({
      Bucket: RAW_BUCKET,
      Key: reportKey,
    }),
  );

  if (!s3Object.Body) {
    throw new Error('No body in S3 object');
  }

  // Decompress gzip
  const chunks: Buffer[] = [];
  for await (const chunk of s3Object.Body as any) {
    chunks.push(chunk);
  }
  const compressedBuffer = Buffer.concat(chunks);
  const decompressedBuffer = zlib.gunzipSync(compressedBuffer);
  const csvText = decompressedBuffer.toString('utf-8');

  // Parse CSV
  const lines = csvText.split('\n').filter(line => line.trim());
  if (lines.length < 2) {
    console.log('No data rows in CSV');
    return;
  }

  const headers = parseCSVLine(lines[0]);
  console.log(`Processing ${lines.length - 1} records`);

  // Transform records
  const transformedRecords: any[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length === headers.length) {
      transformedRecords.push(transformCURRecord(headers, values));
    }
  }

  console.log(`Transformed ${transformedRecords.length} records`);

  // Aggregate by service and date
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

  // Save processed data
  const outputKey = `processed/${manifest.billingPeriod.start}-${manifest.billingPeriod.end}/costs.json`;
  
  await s3Client.send(
    new PutObjectCommand({
      Bucket: PROCESSED_BUCKET,
      Key: outputKey,
      Body: JSON.stringify(aggregatedArray, null, 2),
      ContentType: 'application/json',
    }),
  );

  console.log('Saved processed data to:', outputKey);

  // Also save monthly summary
  const monthlySummary = aggregateByMonth(aggregatedArray);
  const summaryKey = `processed/${manifest.billingPeriod.start}-${manifest.billingPeriod.end}/summary.json`;
  
  await s3Client.send(
    new PutObjectCommand({
      Bucket: PROCESSED_BUCKET,
      Key: summaryKey,
      Body: JSON.stringify(monthlySummary, null, 2),
      ContentType: 'application/json',
    }),
  );

  console.log('Saved monthly summary to:', summaryKey);
}

/**
 * Aggregate data by month for dashboard
 */
function aggregateByMonth(records: any[]): any[] {
  const monthly: Record<string, any> = {};

  records.forEach(record => {
    const month = record.date?.substring(0, 7) || 'unknown';
    
    if (!monthly[month]) {
      monthly[month] = {
        month,
        totalCost: 0,
        services: {},
      };
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

  return Object.values(monthly).map((month: any) => ({
    ...month,
    services: Object.values(month.services),
  }));
}

/**
 * Main handler
 */
export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    console.log('Event:', JSON.stringify(event, null, 2));

    // Handle S3 event (manifest.json uploaded)
    if (event.body && event.requestContext.http.method === 'POST') {
      const body = JSON.parse(event.body);
      
      // If it's a manifest file
      if (body.manifest || body.reportName === 'awscost') {
        const manifest: CURManifest = body;
        await processCURManifest(manifest);
        
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: true, message: 'CUR processed successfully' }),
        };
      }
    }

    // Handle S3 event notification
    if (event.body && event.requestContext.http.method === 'POST') {
      const snsMessage = JSON.parse(event.body);
      const s3Record = JSON.parse(snsMessage.Message).Records?.[0];
      
      if (s3Record?.s3?.object?.key?.endsWith('manifest.json')) {
        const manifestKey = s3Record.s3.object.key;
        console.log('Processing manifest:', manifestKey);

        // Download manifest
        const manifestObject = await s3Client.send(
          new GetObjectCommand({
            Bucket: RAW_BUCKET,
            Key: manifestKey,
          }),
        );

        const manifestText = await manifestObject.Body?.transformToString();
        const manifest: CURManifest = JSON.parse(manifestText || '{}');
        
        await processCURManifest(manifest);
        
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: true, message: 'CUR processed successfully' }),
        };
      }
    }

    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid request' }),
    };
  } catch (error) {
    console.error('CUR processor error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Failed to process CUR',
        detail: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};