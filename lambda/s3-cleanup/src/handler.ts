import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

const REGION = process.env.AWS_REGION ?? 'us-east-1';

// Bucket configurations: bucket name, optional prefix, and retention days
interface BucketConfig {
  bucket: string;
  prefix?: string;
  retentionDays: number;
}

const BUCKETS: BucketConfig[] = [
  { bucket: 'stellarglobal-cf-logs', prefix: 'AWSLogs/471112840461/CloudFront/', retentionDays: 7 },
  { bucket: 'stellar-global-prod-data-9856add5', retentionDays: 2 },
  { bucket: 'stellar-global-prod-attachments-20260627040526193400000001', retentionDays: 2 },
  { bucket: 'stellarglobal-costing-bucket', prefix: 'awscost/', retentionDays: 2 },
  { bucket: 'stellarglobal-costing-bucket', prefix: 'processed/', retentionDays: 2 },
];

const s3 = new S3Client({ region: REGION });

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? 'https://ops.stellarglobalsupplies.com';

function corsHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function success(body: unknown): APIGatewayProxyResultV2 {
  return { statusCode: 200, headers: SECURITY_HEADERS, body: JSON.stringify(body) };
}

function errorResponse(status: number, message: string): APIGatewayProxyResultV2 {
  return { statusCode: status, headers: corsHeaders(), body: JSON.stringify({ error: message }) };
}

interface CleanupResult {
  bucket: string;
  prefix: string;
  deletedCount: number;
  errors: string[];
}

async function cleanupBucket(config: BucketConfig): Promise<CleanupResult> {
  const result: CleanupResult = {
    bucket: config.bucket,
    prefix: config.prefix ?? '',
    deletedCount: 0,
    errors: [],
  };

  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - config.retentionDays);
    const cutoffTimestamp = cutoffDate.getTime();

    console.log(`Cleaning up ${config.bucket}${config.prefix ? `/${config.prefix}` : ''} - files older than ${cutoffDate.toISOString()} (retention: ${config.retentionDays} days)`);

    // List objects
    let continuationToken: string | undefined;
    let totalObjects = 0;

    do {
      const listCommand = new ListObjectsV2Command({
        Bucket: config.bucket,
        Prefix: config.prefix,
        ContinuationToken: continuationToken,
      });

      const listResponse = await s3.send(listCommand);
      const objects = listResponse.Contents ?? [];

      if (objects.length === 0) {
        console.log(`No objects found in ${config.bucket}${config.prefix ? `/${config.prefix}` : ''}`);
        break;
      }

      totalObjects += objects.length;

      // Filter objects older than retention period
      const objectsToDelete = objects.filter((obj) => {
        if (!obj.LastModified) return false;
        const lastModifiedTimestamp = obj.LastModified.getTime();
        return lastModifiedTimestamp < cutoffTimestamp;
      });

      console.log(`Found ${objects.length} objects, ${objectsToDelete.length} older than ${config.retentionDays} days`);

      // Delete objects in batches of 1000 (S3 limit)
      if (objectsToDelete.length > 0) {
        const deleteObjects = objectsToDelete.map((obj) => ({
          Key: obj.Key,
        }));

        // Split into batches of 1000
        const batchSize = 1000;
        for (let i = 0; i < deleteObjects.length; i += batchSize) {
          const batch = deleteObjects.slice(i, i + batchSize);
          
          const deleteCommand = new DeleteObjectsCommand({
            Bucket: config.bucket,
            Delete: {
              Objects: batch.map((key) => ({ Key: key.Key })),
              Quiet: true,
            },
          });

          try {
            const deleteResponse = await s3.send(deleteCommand);
            const deleted = deleteResponse.Deleted?.length ?? 0;
            const errors = deleteResponse.Errors?.length ?? 0;
            
            result.deletedCount += deleted;
            
            if (errors > 0) {
              result.errors.push(`${errors} objects failed to delete in batch ${i / batchSize + 1}`);
            }

            console.log(`Deleted ${deleted} objects in batch ${i / batchSize + 1}`);
          } catch (deleteError) {
            const errorMsg = `Failed to delete batch ${i / batchSize + 1}: ${deleteError instanceof Error ? deleteError.message : 'Unknown error'}`;
            result.errors.push(errorMsg);
            console.error(errorMsg);
          }
        }
      }

      continuationToken = listResponse.IsTruncated ? listResponse.NextContinuationToken : undefined;
    } while (continuationToken);

    console.log(`Cleanup complete for ${config.bucket}: deleted ${result.deletedCount} objects out of ${totalObjects} total`);
  } catch (error) {
    const errorMsg = `Failed to cleanup ${config.bucket}: ${error instanceof Error ? error.message : 'Unknown error'}`;
    result.errors.push(errorMsg);
    console.error(errorMsg);
  }

  return result;
}

export const handler = async (_event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    console.log('Starting S3 cleanup with per-bucket retention policies');
    console.log('Buckets to clean:', JSON.stringify(BUCKETS, null, 2));

    // Cleanup all buckets in parallel
    const results = await Promise.all(BUCKETS.map((config) => cleanupBucket(config)));

    const totalDeleted = results.reduce((sum, r) => sum + r.deletedCount, 0);
    const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);

    console.log(`Cleanup complete: ${totalDeleted} objects deleted, ${totalErrors} errors`);

    return success({
      message: 'S3 cleanup completed',
      results,
      summary: {
        totalDeleted,
        totalErrors,
        bucketsProcessed: results.length,
      },
    });
  } catch (error) {
    console.error('S3 cleanup failed:', error);
    return errorResponse(500, error instanceof Error ? error.message : 'Cleanup failed');
  }
};