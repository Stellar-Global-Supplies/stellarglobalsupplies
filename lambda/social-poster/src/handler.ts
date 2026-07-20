import {
  DynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

// ────────────────────────────────────────────────────────────────────────────
// Config
// ────────────────────────────────────────────────────────────────────────────
const REGION              = process.env.AWS_REGION ?? 'us-east-1';
const DYNAMODB_TABLE      = process.env.DYNAMODB_TABLE!;
const ALLOWED_ORIGIN      = process.env.ALLOWED_ORIGIN ?? '*';
const ATTACHMENTS_BUCKET  = process.env.ATTACHMENTS_BUCKET!;
const LINKEDIN_CLIENT_ID_PARAM      = process.env.LINKEDIN_CLIENT_ID_PARAM!;
const LINKEDIN_CLIENT_SECRET_PARAM  = process.env.LINKEDIN_CLIENT_SECRET_PARAM!;
const LINKEDIN_REDIRECT_URI         = process.env.LINKEDIN_REDIRECT_URI!;
const FACEBOOK_PAGE_TOKEN_PARAM     = process.env.FACEBOOK_PAGE_TOKEN_PARAM!;
const FACEBOOK_PAGE_ID_PARAM        = process.env.FACEBOOK_PAGE_ID_PARAM!;
const INSTAGRAM_BUSINESS_ID_PARAM   = process.env.INSTAGRAM_BUSINESS_ID_PARAM!;
const FRONTEND_URL                  = process.env.FRONTEND_URL!;

const ddbClient = new DynamoDBClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions:   { removeUndefinedValues: true, convertEmptyValues: false },
  unmarshallOptions: { wrapNumbers: false },
});
const ssm = new SSMClient({ region: REGION });
const s3  = new S3Client({ region: REGION });

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

async function getSsmParam(name: string): Promise<string> {
  const resp = await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: true }));
  return resp.Parameter?.Value ?? '';
}

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

function corsHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin':  ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  };
}

function success(body: unknown): APIGatewayProxyResultV2 {
  return { statusCode: 200, headers: SECURITY_HEADERS, body: JSON.stringify(body) };
}

function redirect(url: string): APIGatewayProxyResultV2 {
  return { statusCode: 302, headers: { Location: url } };
}

function clientError(msg: string): APIGatewayProxyResultV2 {
  return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: msg }) };
}

// Extracts the S3 object key from an `attachments/...` image URL — handles
// both plain URLs and presigned URLs (which carry a query string that must
// be stripped, since it isn't part of the object key).
function extractAttachmentKey(imageUrl: string): string {
  let pathname = imageUrl;
  try {
    pathname = new URL(imageUrl).pathname; // drops query string + host
  } catch {
    // Not a full URL (e.g. already a bare key) — fall back to stripping
    // the query string manually.
    pathname = imageUrl.split('?')[0];
  }
  const match = pathname.match(/\/?(attachments\/.+)$/);
  return match ? match[1] : pathname.replace(/^\/+/, '');
}

interface LinkedInTokenRecord {
  PK: string;
  SK: string;
  entityType: string;
  access_token: string;
  refresh_token?: string;
  expires_at: number;
  linkedin_urn?: string;
  linkedin_page_name?: string;
  connected_at: string;
}

// ────────────────────────────────────────────────────────────────────────────
// LinkedIn OAuth
// ────────────────────────────────────────────────────────────────────────────

async function handleLinkedinConnectUrl(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const userId = event.queryStringParameters?.user_id;
  if (!userId) return clientError('Missing user_id');

  const clientId = await getSsmParam(LINKEDIN_CLIENT_ID_PARAM);
  const state = Buffer.from(JSON.stringify({ userId, platform: 'linkedin', ts: Date.now() })).toString('base64');

  const authUrl = new URL('https://www.linkedin.com/oauth/v2/authorization');
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', LINKEDIN_REDIRECT_URI);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('scope', 'w_organization_social r_organization_social openid profile email');

  return success({ url: authUrl.toString() });
}

async function handleLinkedinCallback(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const params = event.queryStringParameters || {};
  const { code, state, error } = params;

  if (error) {
    return redirect(`${FRONTEND_URL}/tasks?social=linkedin&error=${encodeURIComponent(error)}`);
  }
  if (!code || !state) return clientError('Missing authorization code or state');

  let userId: string;
  try {
    const decoded = JSON.parse(Buffer.from(state, 'base64').toString());
    userId = decoded.userId;
  } catch {
    return clientError('Invalid state parameter');
  }

  const clientId     = await getSsmParam(LINKEDIN_CLIENT_ID_PARAM);
  const clientSecret = await getSsmParam(LINKEDIN_CLIENT_SECRET_PARAM);

  const tokenResp = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: LINKEDIN_REDIRECT_URI,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!tokenResp.ok) {
    const errBody = await tokenResp.text();
    console.error('LinkedIn token exchange failed:', errBody);
    return redirect(`${FRONTEND_URL}/tasks?social=linkedin&error=token_exchange_failed`);
  }

  const tokenData: any = await tokenResp.json();

  // Get the organization URN (for company page posting)
  let orgUrn = '';
  let orgName = '';
  try {
    const orgResp = await fetch('https://api.linkedin.com/v2/organizationalEntityAcls?q=roleAssignee&role=ADMINISTRATOR', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (orgResp.ok) {
      const orgData: any = await orgResp.json();
      if (orgData.elements?.[0]) {
        orgUrn = orgData.elements[0].organizationalTarget;
        orgName = orgUrn.split(':').pop() || '';
      }
    }
  } catch (e) {
    console.error('Failed to fetch LinkedIn organization:', e);
  }

  const now = new Date().toISOString();
  const expiresAt = Math.floor(Date.now() / 1000) + (tokenData.expires_in || 5184000);

  await ddb.send(new PutCommand({
    TableName: DYNAMODB_TABLE,
    Item: {
      PK: `USER#${userId}`,
      SK: 'LINKEDIN_TOKEN#v0',
      entityType: 'LINKEDIN_TOKEN',
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token || '',
      expires_at: expiresAt,
      linkedin_urn: orgUrn,
      linkedin_page_name: orgName,
      connected_at: now,
    },
  }));

  return redirect(`${FRONTEND_URL}/tasks?social=linkedin&connected=true`);
}

async function handleLinkedinStatus(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const userId = event.queryStringParameters?.user_id;
  if (!userId) return clientError('Missing user_id');

  try {
    const result = await ddb.send(new GetCommand({
      TableName: DYNAMODB_TABLE,
      Key: { PK: `USER#${userId}`, SK: 'LINKEDIN_TOKEN#v0' },
    }));

    const item = result.Item as LinkedInTokenRecord | undefined;
    if (!item) {
      return success({ connected: false });
    }

    return success({
      connected: true,
      linkedin_page_name: item.linkedin_page_name,
      linkedin_urn: item.linkedin_urn,
      connected_at: item.connected_at,
    });
  } catch {
    return success({ connected: false });
  }
}

async function handleLinkedinDisconnect(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const body: any = event.body ? JSON.parse(event.body) : {};
  const { user_id } = body;
  if (!user_id) return clientError('Missing user_id');

  await ddb.send(new DeleteCommand({
    TableName: DYNAMODB_TABLE,
    Key: { PK: `USER#${user_id}`, SK: 'LINKEDIN_TOKEN#v0' },
  }));

  return success({ success: true });
}

// ────────────────────────────────────────────────────────────────────────────
// Facebook/Instagram — Static Token (configured at deploy time via SSM)
// ────────────────────────────────────────────────────────────────────────────

async function handleFacebookStatus(_event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const pageToken = await getSsmParam(FACEBOOK_PAGE_TOKEN_PARAM);
  const pageId = await getSsmParam(FACEBOOK_PAGE_ID_PARAM);

  if (!pageToken || !pageId) {
    return success({ connected: false });
  }

  try {
    const verifyResp = await fetch(`https://graph.facebook.com/v20.0/${pageId}?fields=name&access_token=${pageToken}`);
    if (!verifyResp.ok) {
      return success({ connected: false, error: 'Token invalid or expired' });
    }
    const pageData: any = await verifyResp.json();
    return success({
      connected: true,
      facebook_page_id: pageId,
      facebook_page_name: pageData.name || 'Facebook Page',
    });
  } catch {
    return success({ connected: false, error: 'Failed to verify token' });
  }
}

async function handlePostToFacebook(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const body: any = event.body ? JSON.parse(event.body) : {};
  const { message, media_url, media_type } = body;
  if (!message) return clientError('Missing message');

  const pageToken = await getSsmParam(FACEBOOK_PAGE_TOKEN_PARAM);
  const pageId = await getSsmParam(FACEBOOK_PAGE_ID_PARAM);

  if (!pageToken) return clientError('Facebook not configured - no page token');
  if (!pageId) return clientError('Facebook not configured - no page ID');

  let postId: string;

  if (media_url) {
    try {
      const s3Media = await s3.send(new GetObjectCommand({
        Bucket: ATTACHMENTS_BUCKET,
        Key: extractAttachmentKey(media_url),
      }));
      const mediaBuffer = await s3Media.Body?.transformToByteArray();

      if (mediaBuffer) {
        const formData = new FormData();
        formData.append('access_token', pageToken);
        formData.append('message', message);
        formData.append('source', new Blob([mediaBuffer]));
        formData.append('published', 'true');

        // Use /videos endpoint for videos, /photos for images
        const endpoint = media_type === 'video' 
          ? `https://graph.facebook.com/v20.0/${pageId}/videos`
          : `https://graph.facebook.com/v20.0/${pageId}/photos`;

        const mediaResp = await fetch(endpoint, {
          method: 'POST',
          body: formData,
        });

        if (!mediaResp.ok) {
          const errBody = await mediaResp.text();
          throw new Error(errBody);
        }

        const mediaData: any = await mediaResp.json();
        postId = mediaData.id;
      } else {
        throw new Error('Failed to read media from S3');
      }
    } catch (e) {
      console.error('Facebook media post failed, falling back to text:', e);
      const feedResp = await fetch(`https://graph.facebook.com/v20.0/${pageId}/feed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, access_token: pageToken }),
      });
      const feedData: any = await feedResp.json();
      postId = feedData.id;
    }
  } else {
    const feedResp = await fetch(`https://graph.facebook.com/v20.0/${pageId}/feed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, access_token: pageToken }),
    });

    if (!feedResp.ok) {
      const errBody = await feedResp.text();
      console.error('Facebook post failed:', errBody);
      return clientError(`Facebook post failed: ${errBody}`);
    }

    const feedData: any = await feedResp.json();
    postId = feedData.id;
  }

  return success({ success: true, postId, platform: 'facebook' });
}

async function handlePostToInstagram(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const body: any = event.body ? JSON.parse(event.body) : {};
  const { caption, media_url, media_type } = body;
  if (!caption || !media_url) return clientError('Missing caption or media_url');

  const pageToken = await getSsmParam(FACEBOOK_PAGE_TOKEN_PARAM);
  const instagramBusinessId = await getSsmParam(INSTAGRAM_BUSINESS_ID_PARAM);

  if (!pageToken) return clientError('Facebook/Instagram not configured - no token');
  if (!instagramBusinessId) return clientError('Instagram not configured - no Instagram Business ID. You need to find your Instagram Business Account ID (different from Facebook Page ID)');

  try {
    // Step 1: Create media container on Instagram (using Instagram Business ID, NOT Facebook Page ID)
    // For videos, use video_url and media_type: 'VIDEO'
    // For images, use image_url
    const mediaPayload: any = {
      caption,
      access_token: pageToken,
    };

    if (media_type === 'video') {
      mediaPayload.video_url = media_url;
      mediaPayload.media_type = 'VIDEO';
    } else {
      mediaPayload.image_url = media_url;
    }

    const mediaResp = await fetch(`https://graph.facebook.com/v20.0/${instagramBusinessId}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mediaPayload),
    });

    if (!mediaResp.ok) {
      const errBody = await mediaResp.text();
      throw new Error(errBody);
    }

    const mediaData: any = await mediaResp.json();
    const containerId = mediaData.id;

    // Step 2: Publish the media container
    const publishResp = await fetch(`https://graph.facebook.com/v20.0/${instagramBusinessId}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creation_id: containerId,
        access_token: pageToken,
      }),
    });

    if (!publishResp.ok) {
      const errBody = await publishResp.text();
      throw new Error(errBody);
    }

    const publishData: any = await publishResp.json();
    return success({ success: true, postId: publishData.id, platform: 'instagram' });
  } catch (e: any) {
    console.error('Instagram post failed:', e);
    return clientError(`Instagram post failed: ${e.message || e}`);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// LinkedIn Posting
// ────────────────────────────────────────────────────────────────────────────

async function handlePostToLinkedIn(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const body: any = event.body ? JSON.parse(event.body) : {};
  const { user_id, content, image_url } = body;
  if (!user_id || !content) return clientError('Missing user_id or content');

  const result = await ddb.send(new GetCommand({
    TableName: DYNAMODB_TABLE,
    Key: { PK: `USER#${user_id}`, SK: 'LINKEDIN_TOKEN#v0' },
  }));

  const token = result.Item as LinkedInTokenRecord | undefined;
  if (!token?.access_token) return clientError('LinkedIn not connected');
  if (!token.linkedin_urn) return clientError('No LinkedIn organization found');
  if (Date.now() / 1000 > token.expires_at) return clientError('LinkedIn token expired. Please reconnect.');

  const postBody: any = {
    author: token.linkedin_urn,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: { text: content },
        shareMediaCategory: 'NONE',
      },
    },
    visibility: {
      'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
    },
  };

  if (image_url) {
    try {
      const registerResp = await fetch('https://api.linkedin.com/v2/assets?action=registerUpload', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token.access_token}`,
          'Content-Type': 'application/json',
          'X-Restli-Protocol-Version': '2.0.0',
        },
        body: JSON.stringify({
          registerUploadRequest: {
            recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
            owner: token.linkedin_urn,
            serviceRelationships: [{ relationshipType: 'OWNER', identifier: 'urn:li:userGeneratedContent' }],
          },
        }),
      });

      const registerData: any = await registerResp.json();
      const uploadUrl = registerData.value?.uploadMechanism?.['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest']?.uploadUrl;
      const assetUrn = registerData.value?.asset;

      if (uploadUrl && assetUrn) {
        const s3Image = await s3.send(new GetObjectCommand({
          Bucket: ATTACHMENTS_BUCKET,
          Key: extractAttachmentKey(image_url),
        }));
        const imageBuffer = await s3Image.Body?.transformToByteArray();

        if (imageBuffer) {
          await fetch(uploadUrl, { method: 'POST', body: new Uint8Array(imageBuffer) });
          postBody.specificContent['com.linkedin.ugc.ShareContent'].shareMediaCategory = 'IMAGE';
          postBody.specificContent['com.linkedin.ugc.ShareContent'].media = [{ status: 'READY', description: { text: 'Image' }, media: assetUrn }];
        }
      }
    } catch (e) {
      console.error('LinkedIn image upload failed:', e);
    }
  }

  const postResp = await fetch('https://api.linkedin.com/v2/ugcPosts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
    },
    body: JSON.stringify(postBody),
  });

  if (!postResp.ok) {
    const errBody = await postResp.text();
    console.error('LinkedIn post failed:', errBody);
    return clientError(`LinkedIn post failed: ${errBody}`);
  }

  const postData: any = await postResp.json();
  return success({ success: true, postId: postData.id || `urn:li:ugcPost:${Date.now()}`, platform: 'linkedin' });
}

// ────────────────────────────────────────────────────────────────────────────
// Main Router
// ────────────────────────────────────────────────────────────────────────────

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const routeKey = event.routeKey;
    console.log('Social poster route:', routeKey);

    switch (routeKey) {
      // LinkedIn
      case 'GET /social/linkedin/url':
        return await handleLinkedinConnectUrl(event);
      case 'GET /social/linkedin/callback':
        return await handleLinkedinCallback(event);
      case 'GET /social/linkedin/status':
        return await handleLinkedinStatus(event);
      case 'POST /social/linkedin/disconnect':
        return await handleLinkedinDisconnect(event);
      case 'POST /social/linkedin/post':
        return await handlePostToLinkedIn(event);

      // Facebook (static token)
      case 'GET /social/facebook/status':
        return await handleFacebookStatus(event);
      case 'POST /social/facebook/post':
        return await handlePostToFacebook(event);

      // Instagram (via Facebook Graph API)
      case 'POST /social/instagram/post':
        return await handlePostToInstagram(event);

      default:
        return clientError(`Unknown route: ${routeKey}`);
    }
  } catch (err) {
    console.error('Social poster error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({
        error: err instanceof Error ? err.message : 'Internal server error',
      }),
    };
  }
};