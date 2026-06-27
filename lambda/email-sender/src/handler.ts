import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

const REGION             = process.env.AWS_REGION        ?? 'us-east-1';
const DYNAMODB_TABLE     = process.env.DYNAMODB_TABLE!;
const ATTACHMENTS_BUCKET = process.env.ATTACHMENTS_BUCKET;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
  marshallOptions: { removeUndefinedValues: true },
});
const s3 = new S3Client({ region: REGION });

// ── Types ─────────────────────────────────────────────────────────────────────

/** Attachment encoded as a base64 data-URI by the frontend. */
interface IncomingAttachment {
  name: string;
  type: string;
  data: string; // "data:<mime>;base64,<b64>" or raw "<b64>"
}

interface EmailRequest {
  recipients:   string[];
  subject:      string;
  body:         string;
  user_id:      string;
  attachments?: IncomingAttachment[]; // base64 from frontend
  attachment_keys?: string[];         // legacy: direct S3 keys
}

interface EmailResponse {
  total:   number;
  success: number;
  failed:  number;
  errors?: Array<{ email: string; error: string }>;
}

// ── DynamoDB ──────────────────────────────────────────────────────────────────

async function getRefreshToken(userId: string): Promise<string | null> {
  try {
    const result = await ddb.send(
      new QueryCommand({
        TableName: DYNAMODB_TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `USER#${userId}`,
          ':sk': 'GOOGLE_TOKEN#',
        },
      }),
    );
    const token = result.Items?.[0];
    return token?.refresh_token ?? null;
  } catch (err) {
    console.error('getRefreshToken error:', err);
    return null;
  }
}

// ── Google OAuth ──────────────────────────────────────────────────────────────

async function refreshAccessToken(refreshToken: string): Promise<string> {
  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET env vars not set');
  }

  const res  = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      refresh_token: refreshToken,
      client_id:     clientId,
      client_secret: clientSecret,
      grant_type:    'refresh_token',
    }),
  });

  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(json.error_description ?? json.error ?? 'Token refresh failed');
  }
  return json.access_token as string;
}

// ── Attachments ───────────────────────────────────────────────────────────────

/** Upload a base64-encoded attachment to S3 and return its key. */
async function uploadToS3(att: IncomingAttachment, userId: string): Promise<string> {
  if (!ATTACHMENTS_BUCKET) throw new Error('ATTACHMENTS_BUCKET env var not set');

  // Strip data-URI prefix if present: "data:<mime>;base64,<b64>" → "<b64>"
  const b64    = att.data.includes(',') ? att.data.split(',')[1] : att.data;
  const buffer = Buffer.from(b64, 'base64');
  const safe   = att.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const key    = `attachments/${userId}/${Date.now()}-${safe}`;

  await s3.send(new PutObjectCommand({
    Bucket:      ATTACHMENTS_BUCKET,
    Key:         key,
    Body:        buffer,
    ContentType: att.type || 'application/octet-stream',
  }));

  return key;
}

async function streamToBuffer(stream: any): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// ── Gmail ─────────────────────────────────────────────────────────────────────

async function sendViaGmail(
  accessToken:    string,
  to:             string,
  subject:        string,
  body:           string,
  attachmentKeys: string[],
): Promise<void> {
  const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  const lines: string[] = [
    `From: me`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset=UTF-8`,
    ``,
    body,
  ];

  if (attachmentKeys.length > 0 && ATTACHMENTS_BUCKET) {
    for (const key of attachmentKeys) {
      try {
        const obj    = await s3.send(new GetObjectCommand({ Bucket: ATTACHMENTS_BUCKET, Key: key }));
        const buf    = await streamToBuffer(obj.Body);
        const fname  = key.split('/').pop() ?? 'attachment';
        lines.push(
          ``,
          `--${boundary}`,
          `Content-Type: ${obj.ContentType ?? 'application/octet-stream'}`,
          `Content-Disposition: attachment; filename="${fname}"`,
          `Content-Transfer-Encoding: base64`,
          ``,
          buf.toString('base64'),
        );
      } catch (err) {
        console.error(`Skipping attachment ${key}:`, err);
      }
    }
  }

  lines.push(``, `--${boundary}--`, ``);

  const raw = Buffer.from(lines.join('\r\n'))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method:  'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ raw }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? `Gmail API ${res.status}`);
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    // ── Parse & validate ───────────────────────────────────────────────────────
    let parsed: EmailRequest;
    try {
      parsed = JSON.parse(event.body ?? '{}') as EmailRequest;
    } catch {
      return reply(400, { error: 'Invalid JSON body' });
    }

    const { recipients, subject, body: emailBody, user_id, attachments = [], attachment_keys = [] } = parsed;

    if (!user_id?.trim())                                         return reply(400, { error: 'user_id is required' });
    if (!Array.isArray(recipients) || recipients.length === 0)   return reply(400, { error: 'recipients must be a non-empty array' });
    if (!subject?.trim() || !emailBody?.trim())                   return reply(400, { error: 'subject and body are required' });

    // ── Auth ───────────────────────────────────────────────────────────────────
    const refreshToken = await getRefreshToken(user_id);
    if (!refreshToken) {
      return reply(401, { error: 'Google account not connected. Please connect your Gmail account first.' });
    }

    let accessToken: string;
    try {
      accessToken = await refreshAccessToken(refreshToken);
    } catch (err) {
      console.error('Token refresh failed:', err);
      return reply(401, { error: 'Failed to authenticate with Google. Please reconnect your account.' });
    }

    // ── Upload base64 attachments → S3 ────────────────────────────────────────
    let allKeys: string[] = [...attachment_keys];

    if (attachments.length > 0) {
      if (!ATTACHMENTS_BUCKET) {
        console.warn('ATTACHMENTS_BUCKET not set — skipping attachment upload');
      } else {
        try {
          const uploaded = await Promise.all(attachments.map(att => uploadToS3(att, user_id)));
          allKeys = [...allKeys, ...uploaded];
        } catch (err) {
          console.error('Attachment upload failed:', err);
          return reply(500, { error: 'Failed to upload attachments. Please try again.' });
        }
      }
    }

    // ── Send in batches ────────────────────────────────────────────────────────
    const errors: Array<{ email: string; error: string }> = [];
    let successCount = 0;
    let failedCount  = 0;

    const BATCH = 10;
    for (let i = 0; i < recipients.length; i += BATCH) {
      await Promise.allSettled(
        recipients.slice(i, i + BATCH).map(async (email) => {
          try {
            await sendViaGmail(accessToken, email, subject.trim(), emailBody.trim(), allKeys);
            successCount++;
          } catch (err) {
            failedCount++;
            errors.push({ email, error: err instanceof Error ? err.message : 'Unknown error' });
          }
        }),
      );
      if (i + BATCH < recipients.length) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    const result: EmailResponse = { total: recipients.length, success: successCount, failed: failedCount };
    if (errors.length) result.errors = errors;
    return reply(200, result);

  } catch (err) {
    console.error('Unhandled handler error:', err);
    return reply(500, {
      error:  'Failed to send emails',
      detail: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

function reply(statusCode: number, body: unknown) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}