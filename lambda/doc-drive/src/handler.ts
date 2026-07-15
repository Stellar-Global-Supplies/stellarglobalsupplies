/**
 * lambda/docs-drive/src/handler.ts
 *
 * Single Lambda handler for all Documents Drive operations.
 *
 * Routes (matched from event.routeKey set by API Gateway HTTP API v2):
 *   GET    /docs/list            → listItems
 *   POST   /docs/folder          → createFolder
 *   POST   /docs/presign-upload  → presignUpload
 *   POST   /docs/presign-download→ presignDownload
 *   DELETE /docs/delete          → deleteItem
 *
 * Environment Variables:
 *   DOCS_BUCKET      - S3 bucket name for document storage
 *   DOCS_TABLE       - DynamoDB table name (stellarglobal-docs-<env>)
 *   AWS_REGION       - injected automatically by Lambda runtime
 *
 * DynamoDB Schema  (single-table, PK=pk, SK=sk):
 *   Folder entry:
 *     pk  = "FOLDER#<folderPath>"         e.g. "FOLDER#reports/2024/"
 *     sk  = "META"
 *     name, createdAt, type="folder"
 *
 *   File entry:
 *     pk  = "FILE#<s3Key>"
 *     sk  = "META"
 *     name, size, contentType, lastModified, parentPrefix, type="file"
 *
 *   List pattern (GSI: gsi1pk = "PREFIX#<parentPrefix>"):
 *     Allows efficient listing of items under a given prefix.
 */

import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  DynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';

// ─── AWS Clients ──────────────────────────────────────────────────────────────

const region = process.env.AWS_REGION ?? 'ap-south-1';
const BUCKET = process.env.DOCS_BUCKET!;
const TABLE  = process.env.DOCS_TABLE!;

const s3  = new S3Client({ region });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

// ─── CORS Headers ─────────────────────────────────────────────────────────────

const CORS = {
  'Access-Control-Allow-Origin': 'https://ops.stellarglobalsupplies.com',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  'Content-Type': 'application/json',
};

function ok(body: unknown, status = 200): APIGatewayProxyResultV2 {
  return { statusCode: status, headers: CORS, body: JSON.stringify(body) };
}

function err(message: string, status = 400): APIGatewayProxyResultV2 {
  return { statusCode: status, headers: CORS, body: JSON.stringify({ error: message }) };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  // Handle preflight
  if (event.requestContext.http.method === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  const route = event.routeKey; // e.g. "GET /docs/list"

  try {
    if (route === 'GET /docs/list') return await listItems(event);
    if (route === 'POST /docs/folder') return await createFolder(event);
    if (route === 'POST /docs/presign-upload') return await presignUpload(event);
    if (route === 'POST /docs/presign-download') return await presignDownload(event);
    if (route === 'DELETE /docs/delete') return await deleteItem(event);
    return err('Route not found', 404);
  } catch (e) {
    console.error('docs-drive error', e);
    return err((e as Error).message, 500);
  }
};

// ─── List Items ───────────────────────────────────────────────────────────────
/**
 * GET /docs/list?prefix=<folder-path>
 *
 * Returns all immediate children (folders + files) under the given prefix.
 * We use S3 ListObjectsV2 with Delimiter="/" as the source of truth;
 * DynamoDB metadata (size, contentType, lastModified) enriches the file entries.
 */
async function listItems(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const prefix = (event.queryStringParameters?.prefix ?? '').replace(/^\/+/, '');

  const s3Resp = await s3.send(new ListObjectsV2Command({
    Bucket: BUCKET,
    Prefix: prefix,
    Delimiter: '/',
  }));

  // Folders are the CommonPrefixes
  const folders = (s3Resp.CommonPrefixes ?? []).map(cp => {
    const key  = cp.Prefix!;
    const name = key.replace(prefix, '').replace(/\/$/, '');
    return { key, name, type: 'folder' as const };
  });

  // Files are the Contents (excluding the prefix key itself if it's a 0-byte folder marker)
  const files = (s3Resp.Contents ?? [])
    .filter(obj => obj.Key !== prefix && obj.Key !== prefix + '/')
    .map(obj => {
      const key  = obj.Key!;
      const name = key.replace(prefix, '');
      return {
        key,
        name,
        type: 'file'  as const,
        size: obj.Size,
        lastModified: obj.LastModified?.toISOString(),
      };
    });

  // Optionally enrich files with contentType from DynamoDB metadata
  // (written at upload presign time; skip gracefully if missing)
  const enriched = await Promise.all(files.map(async f => {
    try {
      const res = await ddb.send(new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'pk = :pk AND sk = :sk',
        ExpressionAttributeValues: { ':pk': `FILE#${f.key}`, ':sk': 'META' },
        Limit: 1,
      }));
      const meta = res.Items?.[0];
      if (meta) return { ...f, contentType: meta.contentType };
    } catch { /* ignore */ }
    return f;
  }));

  return ok({ items: [...folders, ...enriched] });
}

// ─── Create Folder ────────────────────────────────────────────────────────────
/**
 * POST /docs/folder
 * Body: { folderPath: string }   e.g. "reports/q1/"
 *
 * Creates a 0-byte S3 object as folder marker and writes DynamoDB metadata.
 */
async function createFolder(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const body = JSON.parse(event.body ?? '{}');
  const folderPath: string = (body.folderPath ?? '').replace(/^\/+/, '');

  if (!folderPath || !folderPath.endsWith('/')) {
    return err('folderPath must be a non-empty string ending with "/"');
  }

  // S3 folder marker (0-byte object)
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: folderPath,
    Body: '',
    ContentType: 'application/x-directory',
  }));

  // DynamoDB metadata
  const name = folderPath.split('/').filter(Boolean).pop() ?? folderPath;
  const parentPrefix = folderPath.split('/').slice(0, -2).join('/');
  const gsi1pk = `PREFIX#${parentPrefix ? parentPrefix + '/' : ''}`;

  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: {
      pk: `FOLDER#${folderPath}`,
      sk: 'META',
      gsi1pk,
      name,
      type: 'folder',
      folderPath,
      createdAt: new Date().toISOString(),
    },
  }));

  return ok({ folderPath, name });
}

// ─── Presign Upload ───────────────────────────────────────────────────────────
/**
 * POST /docs/presign-upload
 * Body: { key: string, contentType: string }
 *
 * Returns a pre-signed S3 PUT URL valid for 15 minutes.
 * Also writes DynamoDB metadata so listing can surface contentType.
 */
async function presignUpload(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const body = JSON.parse(event.body ?? '{}');
  const key: string         = (body.key ?? '').replace(/^\/+/, '');
  const contentType: string = body.contentType ?? 'application/octet-stream';

  if (!key) return err('key is required');

  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType,
  });

  const url = await getSignedUrl(s3, command, { expiresIn: 900 }); // 15 min

  // Write DynamoDB metadata (best-effort — file isn't uploaded yet but that's fine)
  const name         = key.split('/').pop() ?? key;
  const parentParts  = key.split('/');
  parentParts.pop();
  const parentPrefix = parentParts.length ? parentParts.join('/') + '/' : '';
  const gsi1pk       = `PREFIX#${parentPrefix}`;

  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: {
      pk: `FILE#${key}`,
      sk: 'META',
      gsi1pk,
      name,
      type: 'file',
      key,
      contentType,
      parentPrefix,
      lastModified: new Date().toISOString(),
    },
  })).catch(e => console.warn('DDB metadata write failed (non-fatal):', e));

  return ok({ url, key });
}

// ─── Presign Download ─────────────────────────────────────────────────────────
/**
 * POST /docs/presign-download
 * Body: { key: string }
 *
 * Returns a pre-signed S3 GET URL valid for 5 minutes.
 */
async function presignDownload(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const body = JSON.parse(event.body ?? '{}');
  const key: string = (body.key ?? '').replace(/^\/+/, '');

  if (!key) return err('key is required');

  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  const url = await getSignedUrl(s3, command, { expiresIn: 300 }); // 5 min

  return ok({ url, key });
}

// ─── Delete ───────────────────────────────────────────────────────────────────
/**
 * DELETE /docs/delete
 * Body: { key: string }
 *
 * Deletes a file or folder (for folders, deletes all objects under the prefix).
 */
async function deleteItem(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const body = JSON.parse(event.body ?? '{}');
  const key: string = (body.key ?? '').replace(/^\/+/, '');

  if (!key) return err('key is required');

  const isFolder = key.endsWith('/');

  if (isFolder) {
    // List and delete all objects under prefix
    let continuationToken: string | undefined;
    const keysToDelete: string[] = [];

    do {
      const listResp = await s3.send(new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: key,
        ContinuationToken: continuationToken,
      }));
      for (const obj of listResp.Contents ?? []) {
        if (obj.Key) keysToDelete.push(obj.Key);
      }
      continuationToken = listResp.NextContinuationToken;
    } while (continuationToken);

    // Batch delete (S3 DeleteObjects supports up to 1000 per call)
    // For simplicity, delete one-by-one (production could use DeleteObjectsCommand)
    await Promise.all(keysToDelete.map(k =>
      s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: k }))
    ));

    // Remove DynamoDB folder metadata
    await ddb.send(new DeleteCommand({
      TableName: TABLE,
      Key: { pk: `FOLDER#${key}`, sk: 'META' },
    })).catch(() => {});

  } else {
    // Single file
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));

    // Remove DynamoDB file metadata
    await ddb.send(new DeleteCommand({
      TableName: TABLE,
      Key: { pk: `FILE#${key}`, sk: 'META' },
    })).catch(() => {});
  }

  return ok({ deleted: key });
}
