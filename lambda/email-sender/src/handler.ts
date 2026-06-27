import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

const REGION = process.env.AWS_REGION ?? 'us-east-1';
const DYNAMODB_TABLE = process.env.DYNAMODB_TABLE!;
const ATTACHMENTS_BUCKET = process.env.ATTACHMENTS_BUCKET;

const ddbClient = new DynamoDBClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});
const s3Client = new S3Client({ region: REGION });

interface EmailRequest {
  recipients: string[];
  subject: string;
  body: string;
  user_id: string;
  attachment_keys?: string[]; // S3 keys for attachments
}

interface EmailResponse {
  total: number;
  success: number;
  failed: number;
  errors?: Array<{ email: string; error: string }>;
}

/**
 * Get Google OAuth tokens for a user from DynamoDB
 */
async function getGoogleTokens(userId: string): Promise<{ access_token: string; refresh_token: string } | null> {
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
    if (!token?.refresh_token) {
      return null;
    }

    return {
      access_token: '', // Will be refreshed
      refresh_token: token.refresh_token,
    };
  } catch (error) {
    console.error('Failed to get Google tokens:', error);
    return null;
  }
}

/**
 * Refresh Google access token using refresh token
 */
async function refreshAccessToken(refreshToken: string): Promise<string> {
  // Note: In production, store client_id and client_secret in SSM Parameter Store
  // For now, we'll need to get them from environment or SSM
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth credentials not configured');
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }),
  });

  const tokenJson = await tokenRes.json();
  
  if (!tokenRes.ok || tokenJson.error) {
    throw new Error(tokenJson.error_description || 'Failed to refresh access token');
  }

  return tokenJson.access_token;
}

/**
 * Send email using Gmail API
 */
async function sendEmailViaGmail(
  accessToken: string,
  to: string,
  subject: string,
  body: string,
  attachmentKeys?: string[],
): Promise<void> {
  // Build MIME message
  const boundary = 'boundary_' + Date.now();
  let mimeMessage = [
    `From: me`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    `Content-Type: text/html; charset=UTF-8`,
    '',
    body,
  ];

  // Add attachments if any
  if (attachmentKeys && attachmentKeys.length > 0 && ATTACHMENTS_BUCKET) {
    for (const key of attachmentKeys) {
      try {
        const s3Response = await s3Client.send(
          new GetObjectCommand({
            Bucket: ATTACHMENTS_BUCKET,
            Key: key,
          }),
        );

        const buffer = await streamToBuffer(s3Response.Body);
        const base64Content = buffer.toString('base64');
        const filename = key.split('/').pop() || 'attachment';

        mimeMessage = [
          ...mimeMessage,
          '',
          `--${boundary}`,
          `Content-Type: application/octet-stream`,
          `Content-Disposition: attachment; filename="${filename}"`,
          `Content-Transfer-Encoding: base64`,
          '',
          base64Content,
        ];
      } catch (error) {
        console.error(`Failed to fetch attachment ${key}:`, error);
      }
    }
  }

  mimeMessage = [...mimeMessage, '', `--${boundary}--`, ''];

  const encodedMessage = Buffer.from(mimeMessage.join('\n')).toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      raw: encodedMessage,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to send email via Gmail');
  }
}

/**
 * Convert stream to buffer
 */
async function streamToBuffer(stream: any): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const body = JSON.parse(event.body ?? '{}') as EmailRequest;
    const { recipients, subject, body: emailBody, user_id, attachment_keys } = body;

    if (!user_id) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'user_id is required' }),
      };
    }

    if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Invalid recipients list' }),
      };
    }

    if (!subject || !emailBody) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Subject and body are required' }),
      };
    }

    // Get Google OAuth tokens for the user
    const tokens = await getGoogleTokens(user_id);
    if (!tokens) {
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Google account not connected. Please connect your Gmail account first.' }),
      };
    }

    // Refresh access token
    let accessToken: string;
    try {
      accessToken = await refreshAccessToken(tokens.refresh_token);
    } catch (error) {
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Failed to authenticate with Google. Please reconnect your account.' }),
      };
    }

    // Send emails
    const errors: Array<{ email: string; error: string }> = [];
    let successCount = 0;
    let failedCount = 0;

    // Gmail API has rate limits, send in batches
    const batchSize = 10;
    for (let i = 0; i < recipients.length; i += batchSize) {
      const batch = recipients.slice(i, i + batchSize);
      
      await Promise.allSettled(
        batch.map(async (email) => {
          try {
            await sendEmailViaGmail(accessToken, email, subject, emailBody, attachment_keys);
            successCount++;
          } catch (error) {
            failedCount++;
            errors.push({
              email,
              error: error instanceof Error ? error.message : 'Unknown error',
            });
          }
        }),
      );

      // Add delay between batches to respect Gmail rate limits
      if (i + batchSize < recipients.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    const response: EmailResponse = {
      total: recipients.length,
      success: successCount,
      failed: failedCount,
    };

    if (errors.length > 0) {
      response.errors = errors;
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Email sender error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Failed to send emails',
        detail: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};
