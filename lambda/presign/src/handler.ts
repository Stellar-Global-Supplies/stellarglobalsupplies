import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { randomUUID } from 'crypto';

// ────────────────────────────────────────────────────────────────────────────
// Config
// ────────────────────────────────────────────────────────────────────────────
const REGION             = process.env.AWS_REGION        ?? 'ap-south-1';
const DATA_BUCKET        = process.env.DATA_BUCKET!;
const ATTACHMENTS_BUCKET = process.env.ATTACHMENTS_BUCKET!;
const ALLOWED_ORIGIN     = process.env.ALLOWED_ORIGIN    ?? '*';
const PRESIGN_TTL        = 15 * 60;           // 15 minutes (upload window)
const READ_TTL           = 30 * 60;           // 30 minutes (window for Meta/Graph API to fetch the image)
const MAX_BYTES          = 100 * 1024 * 1024; // 100 MB

const s3 = new S3Client({ region: REGION });

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────
interface PresignRequest {
  filename:     string;
  content_type: 'text/csv' | 'application/json' | string;
  file_size:    number;
}

interface PresignResponse {
  upload_url: string;
  key:        string;
  expires_in: number;
  read_url?:  string; // presigned GET URL, only for image uploads (so Meta/LinkedIn can fetch it)
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────
const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type':                 'application/json',
};

function respond(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body:    JSON.stringify(body),
  };
}

function sanitizeFilename(name: string): string {
  // Strip path traversal, keep only safe chars
  return name
    .replace(/^.*[\\/]/, '')          // strip directory components
    .replace(/[^a-zA-Z0-9._-]/g, '_') // replace unsafe chars
    .slice(0, 200);                   // cap length
}

const IMAGE_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

function isImageUpload(ct: string): boolean {
  return IMAGE_CONTENT_TYPES.includes(ct);
}

function validateContentType(ct: string): boolean {
  return ['text/csv', 'application/json', 'text/plain', ...IMAGE_CONTENT_TYPES].includes(ct);
}

function getFileExtension(filename: string, contentType: string): string | null {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext === 'csv' || contentType === 'text/csv' || contentType === 'text/plain') return 'csv';
  if (ext === 'json' || contentType === 'application/json') return 'json';
  if (isImageUpload(contentType)) {
    if (ext && ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) return ext;
    return contentType.split('/')[1] || 'jpg';
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// Lambda handler
// ────────────────────────────────────────────────────────────────────────────
export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  // Handle CORS preflight
  if (event.requestContext.http.method === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  if (!event.body) {
    return respond(400, { error: 'Request body is required.' });
  }

  // Parse body
  let payload: PresignRequest;
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf-8')
      : event.body;
    payload = JSON.parse(raw) as PresignRequest;
  } catch {
    return respond(400, { error: 'Invalid JSON in request body.' });
  }

  // Validate required fields
  const { filename, content_type, file_size } = payload;

  if (!filename || typeof filename !== 'string' || filename.trim() === '') {
    return respond(400, { error: '`filename` is required and must be a non-empty string.' });
  }
  if (!content_type || typeof content_type !== 'string') {
    return respond(400, { error: '`content_type` is required.' });
  }
  if (typeof file_size !== 'number' || file_size <= 0) {
    return respond(400, { error: '`file_size` must be a positive number.' });
  }

  // Validate content type
  if (!validateContentType(content_type)) {
    return respond(415, {
      error: `Unsupported content type "${content_type}". Only text/csv, application/json, and image/* (jpeg, png, webp, gif) are accepted.`,
    });
  }

  // Validate file size
  if (file_size > MAX_BYTES) {
    return respond(413, {
      error: `File size ${file_size} bytes exceeds the ${MAX_BYTES / (1024 * 1024)} MB limit.`,
    });
  }

  // Determine extension
  const safeFilename = sanitizeFilename(filename);
  const ext = getFileExtension(safeFilename, content_type);
  if (!ext) {
    return respond(400, {
      error: `Cannot determine file extension. Use a .csv or .json filename.`,
    });
  }

  // Build S3 key — images go to the attachments bucket so they can be
  // fetched by external services (Meta Graph API / LinkedIn); data files
  // go to the private data bucket for ingestion.
  const uploadId  = randomUUID();
  const isImage   = isImageUpload(content_type);
  const bucket    = isImage ? ATTACHMENTS_BUCKET : DATA_BUCKET;
  const key       = isImage
    ? `attachments/${uploadId}/${safeFilename}`
    : `raw-ingest/${uploadId}/${safeFilename}`;

  // Generate pre-signed URL
  try {
    const command = new PutObjectCommand({
      Bucket:        bucket,
      Key:           key,
      ContentType:   content_type,
      ContentLength: file_size,
      Metadata: {
        'x-upload-id':    uploadId,
        'x-original-name': safeFilename,
        'x-file-size':    String(file_size),
        'x-requested-at': new Date().toISOString(),
      },
    });

    const upload_url = await getSignedUrl(s3, command, {
      expiresIn:          PRESIGN_TTL,
      signableHeaders:    new Set(['content-type']),
      unhoistableHeaders: new Set(['content-length']),
    });

    const responseBody: PresignResponse = {
      upload_url,
      key,
      expires_in: PRESIGN_TTL,
    };

    // For images, also hand back a presigned GET URL so the frontend can
    // pass a publicly-fetchable link straight to /social/instagram/post or
    // /social/facebook/post — these buckets stay private, the URL itself
    // carries the (time-limited) auth.
    if (isImage) {
      responseBody.read_url = await getSignedUrl(
        s3,
        new GetObjectCommand({ Bucket: bucket, Key: key }),
        { expiresIn: READ_TTL },
      );
    }

    console.info('[presign] Generated pre-signed URL', {
      key,
      bucket,
      upload_id:    uploadId,
      file_size,
      content_type,
    });

    return respond(200, responseBody);
  } catch (err) {
    console.error('[presign] Failed to generate pre-signed URL', err);
    return respond(500, { error: 'Failed to generate upload URL. Please try again.' });
  }
};