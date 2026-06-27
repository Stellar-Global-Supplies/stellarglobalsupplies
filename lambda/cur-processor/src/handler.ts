import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import * as zlib from 'zlib';
import * as csv from 'csv-parser';

const REGION = process.env.AWS_REGION ?? 'us-east-1';
// Use existing bucket provided by user
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
 * Delete processed files older than specified days
 */
async function cleanupOldProcessedFiles(daysOld: number = 2): Promise<void> {
  console.log(`Cleaning up processed files older than ${daysOld} days...`);

  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    // List all processed files
    const listResponse = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: PROCESSED_BUCKET,
        Prefix: 'processed/',
        MaxKeys: 1000,
      }),
    );

    if (!listResponse.Contents || listResponse.Contents.length === 0) {
      console.log('No processed files to clean up');
      return;
    }

    const oldFiles = listResponse.Contents.filter(obj => 
      obj.LastModified && obj.LastModified < cutoffDate
    );

    if (oldFiles.length === 0) {
      console.log('No old files found to delete');
      return;
    }

    console.log(`Found ${oldFiles.length} files older than ${daysOld} days`);

    // Delete old files
    for (const file of oldFiles) {
      if (file.Key) {
        await s3Client.send(
          new DeleteObjectCommand({
            Bucket: PROCESSED_BUCKET,
            Key: file.Key,
          }),
        );
        console.log(`Deleted: ${file.Key}`);
      }
    }

    console.log(`Cleanup completed. Deleted ${oldFiles.length} files.`);
  } catch (error) {
    console.error('Cleanup error:', error);
  }
}

/**
 * Find and process the latest manifest file
 */
async function processLatestCUR(): Promise<void> {
  console.log('Starting scheduled CUR processing...');

  // List all manifest files in the correct path
  const listResponse = await s3Client.send(
    new ListObjectsV2Command({
      Bucket: RAW_BUCKET,
      Prefix: 'awscost/awscost/',
      MaxKeys: 100,
    }),
  );

  if (!listResponse.Contents || listResponse.Contents.length === 0) {
    console.log('No manifest files found');
    return;
  }

  // Filter for manifest.json files (case-insensitive) and sort by last modified
  const manifestFiles = listResponse.Contents
    .filter(obj => obj.Key?.toLowerCase().endsWith('manifest.json'))
    .sort((a, b) => (b.LastModified?.getTime() || 0) - (a.LastModified?.getTime() || 0));

  if (manifestFiles.length === 0) {
    console.log('No manifest files found');
    return;
  }

  // Get the latest manifest
  const latestManifestKey = manifestFiles[0].Key;
  console.log('Processing latest manifest:', latestManifestKey);

  // Download and parse manifest
  const manifestObject = await s3Client.send(
    new GetObjectCommand({
      Bucket: RAW_BUCKET,
      Key: latestManifestKey,
    }),
  );

  const manifestText = await manifestObject.Body?.transformToString();
  const manifest: CURManifest = JSON.parse(manifestText || '{}');
  
  await processCURManifest(manifest);
  
  console.log('CUR processing completed successfully');
}

/**
 * Main handler - supports both scheduled and manual invocation
 */
export const handler = async (event: any): Promise<any> => {
  try {
    console.log('Event:', JSON.stringify(event, null, 2));

    // Check if this is a scheduled EventBridge event
    if (event.source === 'aws.events' && event['detail-type'] === 'Scheduled Event') {
      console.log('Scheduled trigger detected');
      
      // First, cleanup old processed files
      await cleanupOldProcessedFiles(2);
      
      // Then process latest CUR
      await processLatestCUR();
      
      return {
        statusCode: 200,
        body: JSON.stringify({ success: true, message: 'CUR processed and cleanup completed' }),
      };
    }

    // Handle manual invocation (for testing)
    if (event.body) {
      try {
        const body = JSON.parse(event.body);
        
        // If it's a manifest file
        if (body.reportName === 'awscost' || body.assemblyId) {
          const manifest: CURManifest = body;
          await processCURManifest(manifest);
          
          return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ success: true, message: 'CUR processed successfully' }),
          };
        }
      } catch (e) {
        // Not JSON, continue to S3 event handling
      }
    }

    // Handle S3 event notification (backward compatibility)
    if (event.Records && event.Records[0]?.eventSource === 'aws:s3') {
      const s3Record = event.Records[0].s3;
      const objectKey = s3Record.object.key;
      
      if (objectKey?.endsWith('manifest.json')) {
        console.log('Processing manifest from S3 event:', objectKey);

        const manifestObject = await s3Client.send(
          new GetObjectCommand({
            Bucket: RAW_BUCKET,
            Key: objectKey,
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

    // Default: process latest CUR
    await processLatestCUR();

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, message: 'CUR processed successfully' }),
    };
  } catch (error) {
    console.error('CUR processor error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Failed to process CUR',
        detail: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};
