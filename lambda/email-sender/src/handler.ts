import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { SESClient, SendEmailCommand, SendRawEmailCommand } from '@aws-sdk/client-ses';

const REGION = process.env.AWS_REGION ?? 'us-east-1';
const SENDER_EMAIL = process.env.SENDER_EMAIL ?? 'noreply@stellarglobalsupplies.com';
const ATTACHMENTS_BUCKET = process.env.ATTACHMENTS_BUCKET;

const s3Client = new S3Client({ region: REGION });
const sesClient = new SESClient({ region: REGION });

interface EmailRequest {
  recipients: string[];
  subject: string;
  body: string;
  attachments?: File[];
}

interface EmailResponse {
  total: number;
  success: number;
  failed: number;
  errors?: Array<{ email: string; error: string }>;
}

/**
 * Upload attachment to S3 and return presigned URL
 */
async function uploadAttachment(file: Buffer, filename: string): Promise<string> {
  if (!ATTACHMENTS_BUCKET) {
    throw new Error('ATTACHMENTS_BUCKET not configured');
  }

  const key = `email-attachments/${Date.now()}-${filename}`;
  
  await s3Client.send(
    new PutObjectCommand({
      Bucket: ATTACHMENTS_BUCKET,
      Key: key,
      Body: file,
      ContentType: 'application/octet-stream',
    }),
  );

  // Return S3 URL (in production, use presigned URL)
  return `https://${ATTACHMENTS_BUCKET}.s3.${REGION}.amazonaws.com/${key}`;
}

/**
 * Send email using SES
 */
async function sendEmail(
  to: string,
  subject: string,
  body: string,
  attachmentUrls?: string[],
): Promise<void> {
  const params: any = {
    Source: SENDER_EMAIL,
    Destination: { ToAddresses: [to] },
    Message: {
      Subject: { Data: subject, Charset: 'UTF-8' },
      Body: {
        Html: { Data: body, Charset: 'UTF-8' },
      },
    },
  };

  // If there are attachments, use SendRawEmail
  if (attachmentUrls && attachmentUrls.length > 0) {
    // For simplicity, we'll use SendEmail without attachments for now
    // In production, you'd construct a MIME message with attachments
    await sesClient.send(new SendEmailCommand(params));
  } else {
    await sesClient.send(new SendEmailCommand(params));
  }
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const body = JSON.parse(event.body ?? '{}') as EmailRequest;
    const { recipients, subject, body: emailBody, attachments } = body;

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

    // Upload attachments if any
    let attachmentUrls: string[] = [];
    if (attachments && attachments.length > 0 && ATTACHMENTS_BUCKET) {
      for (const attachment of attachments) {
        // Note: In a real implementation, you'd receive the file data
        // For now, we'll skip actual upload
        console.log('Attachment:', attachment);
      }
    }

    // Send emails
    const errors: Array<{ email: string; error: string }> = [];
    let successCount = 0;
    let failedCount = 0;

    // SES has a rate limit, so we'll send in batches
    const batchSize = 10;
    for (let i = 0; i < recipients.length; i += batchSize) {
      const batch = recipients.slice(i, i + batchSize);
      
      await Promise.allSettled(
        batch.map(async (email) => {
          try {
            await sendEmail(email, subject, emailBody, attachmentUrls);
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

      // Add delay between batches to respect SES rate limits
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