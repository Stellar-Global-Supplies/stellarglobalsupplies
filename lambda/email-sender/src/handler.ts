import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

const REGION            = process.env.AWS_REGION           ?? 'us-east-1';
const DYNAMODB_TABLE    = process.env.DYNAMODB_TABLE!;
const ATTACHMENTS_BUCKET = process.env.ATTACHMENTS_BUCKET;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
  marshallOptions: { removeUndefinedValues: true },
});
const s3Client = new S3Client({ region: REGION });

// ── Types ─────────────────────────────────────────────────────────────────────

/** An attachment encoded by the frontend as a base64 data-URI. */
interface IncomingAttachment {
  name: string;   // original filename
  type: string;   // MIME type
  data: string;   // "data:<mime>;base64,<b64>" OR just "<b64>"
}

interface EmailRequest {
  recipients:   string[];
  subject:      string;
  body:         string;
  user_id:      string;
  attachments?: IncomingAttachment[];   // base64-encoded files from the frontend
  /** Legacy: direct S3 keys — still supported for server-to-server callers. */
  attachment_keys?: string[];
}

interface EmailResponse {
  total:    number;
  success:  number;
  failed:   number;
  errors?:  Array<{ email: string; error: string }>;
}

// ── Google OAuth helpers ──────────────────────────────────────────────────────

async function getGoogleTokens(userId: string): Promise<{ refresh_token: string } | null> {
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
    return token?.refresh_token ? { refresh_token: token.refresh_token } : null;
  } catch (err) {
    console.error('getGoogleTokens error:', err);
    return null;
  }
}

async function refreshAccessToken(refreshToken: string): Promise<string> {
  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Google OAuth credentials not configured');

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
  if (!res.ok || json.error) throw new Error(json.error_description ?? 'Failed to refresh access token');
  return json.access_token as string;
}

// ── Attachment helpers ────────────────────────────────────────────────────────

/**
 * Upload a base64-encoded attachment to S3 and return its key.
 * The data field may arrive as a full data-URI ("data:<mime>;base64,<b64>")
 * or as a raw base64 string — both are handled.
 */
async function uploadAttachmentToS3(att: IncomingAttachment, userId: string): Promise<string> {
  if (!ATTACHMENTS_BUCKET) throw new Error('ATTACHMENTS_BUCKET env var not set');

  // Strip the data-URI prefix if present
  const base64 = att.data.includes(',') ? att.data.split(',')[1] : att.data;
  const buffer = Buffer.from(base64, 'base64');

  const key = `attachments/${userId}/${Date.now()}-${att.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  await s3Client.send(
    new PutObjectCommand({
      Bucket:      ATTACHMENTS_BUCKET,
      Key:         key,
      Body:        buffer,
      ContentType: att.type || 'application/octet-stream',
    }),
  );
  return key;
}

async function streamToBuffer(stream: any): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// ── Gmail send ────────────────────────────────────────────────────────────────

async function sendEmailViaGmail(
  accessToken:    string,
  to:             string,
  subject:        string,
  body:           string,
  attachmentKeys: string[],
): Promise<void> {
  const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  const parts: string[] = [
    `From: me`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    `Content-Type: text/html; charset=UTF-8`,
    `Content-Transfer-Encoding: quoted-printable`,
    '',
    body,
  ];

  if (attachmentKeys.length > 0 && ATTACHMENTS_BUCKET) {
    for (const key of attachmentKeys) {
      try {
        const s3Res  = await s3Client.send(new GetObjectCommand({ Bucket: ATTACHMENTS_BUCKET, Key: key }));
        const buffer = await streamToBuffer(s3Res.Body);
        const filename = key.split('/').pop() ?? 'attachment';

        parts.push(
          '',
          `--${boundary}`,
          `Content-Type: ${s3Res.ContentType ?? 'application/octet-stream'}`,
          `Content-Disposition: attachment; filename="${filename}"`,
          `Content-Transfer-Encoding: base64`,
          '',
          buffer.toString('base64'),
        );
      } catch (err) {
        console.error(`Failed to attach ${key}:`, err);
      }
    }
  }

  parts.push('', `--${boundary}--`, '');

  const raw = Buffer.from(parts.join('\r\n'))
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
    throw new Error(err?.error?.message ?? `Gmail API error ${res.status}`);
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    // Parse body — guard against missing / malformed JSON
    let body: EmailRequest;
    try {
      body = JSON.parse(event.body ?? '{}') as EmailRequest;
    } catch {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Invalid JSON body' }),
      };
    }

    const { recipients, subject, body: emailBody, user_id, attachments = [], attachment_keys = [] } = body;

    // ── Validate inputs ───────────────────────────────────────────────────────
    if (!user_id?.trim()) {
      return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'user_id is required' }) };
    }
    if (!Array.isArray(recipients) || recipients.length === 0) {
      return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'recipients must be a non-empty array' }) };
    }
    if (!subject?.trim() || !emailBody?.trim()) {
      return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'subject and body are required' }) };
    }

    // ── Auth ──────────────────────────────────────────────────────────────────
    const tokens = await getGoogleTokens(user_id);
    if (!tokens) {
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Google account not connected. Please connect your Gmail account first.' }),
      };
    }

    let accessToken: string;
    try {
      accessToken = await refreshAccessToken(tokens.refresh_token);
    } catch (err) {
      console.error('Token refresh error:', err);
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Failed to authenticate with Google. Please reconnect your account.' }),
      };
    }

    // ── Upload base64 attachments → S3, merge with any pre-existing S3 keys ──
    let allAttachmentKeys: string[] = [...attachment_keys];

    if (attachments.length > 0 && ATTACHMENTS_BUCKET) {
      try {
        const uploadedKeys = await Promise.all(
          attachments.map((att) => uploadAttachmentToS3(att, user_id)),
        );
        allAttachmentKeys = [...allAttachmentKeys, ...uploadedKeys];
      } catch (err) {
        console.error('Attachment upload error:', err);
        return {
          statusCode: 500,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Failed to upload attachments. Please try again.' }),
        };
      }
    }

    // ── Send emails in batches ────────────────────────────────────────────────
    const errors: Array<{ email: string; error: string }> = [];
    let successCount = 0;
    let failedCount  = 0;

    const BATCH_SIZE  = 10;
    const BATCH_DELAY = 1000; // ms — respect Gmail rate limits

    for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
      const batch = recipients.slice(i, i + BATCH_SIZE);

      await Promise.allSettled(
        batch.map(async (email) => {
          try {
            await sendEmailViaGmail(accessToken, email, subject.trim(), emailBody.trim(), allAttachmentKeys);
            successCount++;
          } catch (err) {
            failedCount++;
            errors.push({ email, error: err instanceof Error ? err.message : 'Unknown error' });
          }
        }),
      );

      if (i + BATCH_SIZE < recipients.length) {
        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
      }
    }

    const response: EmailResponse = { total: recipients.length, success: successCount, failed: failedCount };
    if (errors.length > 0) response.errors = errors;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(response),
    };
  } catch (err) {
    console.error('Email sender unhandled error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Failed to send emails',
        detail: err instanceof Error ? err.message : 'Unknown error',
      }),
    };
  }
};