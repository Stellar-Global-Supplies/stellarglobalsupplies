import {
  DynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { randomUUID } from 'crypto';

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
const FACEBOOK_CLIENT_ID_PARAM      = process.env.FACEBOOK_CLIENT_ID_PARAM!;
const FACEBOOK_CLIENT_SECRET_PARAM  = process.env.FACEBOOK_CLIENT_SECRET_PARAM!;
const FACEBOOK_REDIRECT_URI         = process.env.FACEBOOK_REDIRECT_URI!;
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

function corsHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin':  ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  };
}

function success(body: unknown): APIGatewayProxyResultV2 {
  return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify(body) };
}

function redirect(url: string): APIGatewayProxyResultV2 {
  return { statusCode: 302, headers: { Location: url } };
}

function clientError(msg: string): APIGatewayProxyResultV2 {
  return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: msg }) };
}

interface SocialTokenRecord {
  PK: string;                    // "USER#<user_id>"
  SK: string;                    // "LINKEDIN_TOKEN#v0" | "FACEBOOK_TOKEN#v0"
  entityType: string;            // "LINKEDIN_TOKEN" | "FACEBOOK_TOKEN"
  access_token: string;
  refresh_token?: string;
  expires_at: number;
  token_type?: string;
  scope?: string;
  // LinkedIn-specific
  linkedin_urn?: string;         // "urn:li:organization:xxxxx"
  linkedin_page_name?: string;
  // Facebook-specific
  facebook_page_id?: string;
  facebook_page_name?: string;
  facebook_page_access_token?: string;
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

  // Exchange code for access token
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

  // Store token in DynamoDB
  const now = new Date().toISOString();
  const expiresAt = Math.floor(Date.now() / 1000) + (tokenData.expires_in || 5184000); // default 60 days

  await ddb.send(new PutCommand({
    TableName: DYNAMODB_TABLE,
    Item: {
      PK: `USER#${userId}`,
      SK: 'LINKEDIN_TOKEN#v0',
      entityType: 'LINKEDIN_TOKEN',
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token || '',
      expires_at: expiresAt,
      token_type: tokenData.token_type || '',
      scope: tokenData.scope || '',
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

    const item = result.Item as SocialTokenRecord | undefined;
    if (!item) {
      return success({ connected: false });
    }

    return success({
      connected: true,
      linkedin_page_name: item.linkedin_page_name,
      linkedin_urn: item.linkedin_urn,
      connected_at: item.connected_at,
      scope: item.scope,
    });
  } catch (err) {
    console.error('LinkedIn status error:', err);
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
// Facebook OAuth
// ────────────────────────────────────────────────────────────────────────────

async function handleFacebookConnectUrl(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const userId = event.queryStringParameters?.user_id;
  if (!userId) return clientError('Missing user_id');

  const clientId = await getSsmParam(FACEBOOK_CLIENT_ID_PARAM);
  const state = Buffer.from(JSON.stringify({ userId, platform: 'facebook', ts: Date.now() })).toString('base64');

  const authUrl = new URL('https://www.facebook.com/v20.0/dialog/oauth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', FACEBOOK_REDIRECT_URI);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('scope', 'pages_manage_posts pages_show_list pages_read_engagement business_management');

  return success({ url: authUrl.toString() });
}

async function handleFacebookCallback(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const params = event.queryStringParameters || {};
  const { code, state, error } = params;

  if (error) {
    return redirect(`${FRONTEND_URL}/tasks?social=facebook&error=${encodeURIComponent(error)}`);
  }
  if (!code || !state) return clientError('Missing authorization code or state');

  let userId: string;
  try {
    const decoded = JSON.parse(Buffer.from(state, 'base64').toString());
    userId = decoded.userId;
  } catch {
    return clientError('Invalid state parameter');
  }

  const clientId     = await getSsmParam(FACEBOOK_CLIENT_ID_PARAM);
  const clientSecret = await getSsmParam(FACEBOOK_CLIENT_SECRET_PARAM);

  // Exchange code for access token
  const tokenResp = await fetch('https://graph.facebook.com/v20.0/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: FACEBOOK_REDIRECT_URI,
      code,
    }),
  });

  if (!tokenResp.ok) {
    const errBody = await tokenResp.text();
    console.error('Facebook token exchange failed:', errBody);
    return redirect(`${FRONTEND_URL}/tasks?social=facebook&error=token_exchange_failed`);
  }

  const tokenData: any = await tokenResp.json();

  // Get user's pages
  let pageId = '';
  let pageName = '';
  let pageAccessToken = '';
  try {
    const pagesResp = await fetch(`https://graph.facebook.com/v20.0/me/accounts?access_token=${tokenData.access_token}`);
    if (pagesResp.ok) {
      const pagesData: any = await pagesResp.json();
      if (pagesData.data?.[0]) {
        pageId = pagesData.data[0].id;
        pageName = pagesData.data[0].name;
        pageAccessToken = pagesData.data[0].access_token;
      }
    }
  } catch (e) {
    console.error('Failed to fetch Facebook pages:', e);
  }

  const now = new Date().toISOString();
  const expiresAt = Math.floor(Date.now() / 1000) + (tokenData.expires_in || 5184000);

  await ddb.send(new PutCommand({
    TableName: DYNAMODB_TABLE,
    Item: {
      PK: `USER#${userId}`,
      SK: 'FACEBOOK_TOKEN#v0',
      entityType: 'FACEBOOK_TOKEN',
      access_token: tokenData.access_token,
      refresh_token: '',
      expires_at: expiresAt,
      scope: 'pages_manage_posts pages_show_list',
      facebook_page_id: pageId,
      facebook_page_name: pageName,
      facebook_page_access_token: pageAccessToken,
      connected_at: now,
    },
  }));

  return redirect(`${FRONTEND_URL}/tasks?social=facebook&connected=true`);
}

async function handleFacebookStatus(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const userId = event.queryStringParameters?.user_id;
  if (!userId) return clientError('Missing user_id');

  try {
    const result = await ddb.send(new GetCommand({
      TableName: DYNAMODB_TABLE,
      Key: { PK: `USER#${userId}`, SK: 'FACEBOOK_TOKEN#v0' },
    }));

    const item = result.Item as SocialTokenRecord | undefined;
    if (!item) {
      return success({ connected: false });
    }

    return success({
      connected: true,
      facebook_page_id: item.facebook_page_id,
      facebook_page_name: item.facebook_page_name,
      connected_at: item.connected_at,
    });
  } catch (err) {
    console.error('Facebook status error:', err);
    return success({ connected: false });
  }
}

async function handleFacebookDisconnect(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const body: any = event.body ? JSON.parse(event.body) : {};
  const { user_id } = body;
  if (!user_id) return clientError('Missing user_id');

  await ddb.send(new DeleteCommand({
    TableName: DYNAMODB_TABLE,
    Key: { PK: `USER#${user_id}`, SK: 'FACEBOOK_TOKEN#v0' },
  }));

  return success({ success: true });
}

// ────────────────────────────────────────────────────────────────────────────
// Posting
// ────────────────────────────────────────────────────────────────────────────

async function handlePostToLinkedIn(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const body: any = event.body ? JSON.parse(event.body) : {};
  const { user_id, content, image_url } = body;
  if (!user_id || !content) return clientError('Missing user_id or content');

  // Get stored token
  const result = await ddb.send(new GetCommand({
    TableName: DYNAMODB_TABLE,
    Key: { PK: `USER#${user_id}`, SK: 'LINKEDIN_TOKEN#v0' },
  }));

  const token = result.Item as SocialTokenRecord | undefined;
  if (!token?.access_token) return clientError('LinkedIn not connected');

  if (!token.linkedin_urn) return clientError('No LinkedIn organization found. Ensure you have admin access to a Company Page.');

  // Check if token is expired
  if (Date.now() / 1000 > token.expires_at) {
    return clientError('LinkedIn token expired. Please reconnect.');
  }

  // Build the post
  const postBody: any = {
    author: token.linkedin_urn,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: {
          text: content,
        },
        shareMediaCategory: 'NONE',
      },
    },
    visibility: {
      'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
    },
  };

  // If there's an image, upload it first
  if (image_url) {
    try {
      // Register image upload
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
            serviceRelationships: [{
              relationshipType: 'OWNER',
              identifier: 'urn:li:userGeneratedContent',
            }],
          },
        }),
      });

      const registerData: any = await registerResp.json();
      const uploadUrl = registerData.value?.uploadMechanism?.['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest']?.uploadUrl;
      const assetUrn = registerData.value?.asset;

      if (uploadUrl && assetUrn) {
        // Download image from S3 and upload to LinkedIn
        const s3Image = await s3.send(new GetObjectCommand({
          Bucket: ATTACHMENTS_BUCKET,
          Key: image_url.replace(/^.*\/attachments\//, 'attachments/'),
        }));
        const imageBuffer = await s3Image.Body?.transformToByteArray();
        
        if (imageBuffer) {
          await fetch(uploadUrl, {
            method: 'POST',
            body: new Uint8Array(imageBuffer),
          });

          postBody.specificContent['com.linkedin.ugc.ShareContent'].shareMediaCategory = 'IMAGE';
          postBody.specificContent['com.linkedin.ugc.ShareContent'].media = [{
            status: 'READY',
            description: { text: 'Image' },
            media: assetUrn,
          }];
        }
      }
    } catch (e) {
      console.error('LinkedIn image upload failed:', e);
      // Continue with text-only post
    }
  }

  // Post to LinkedIn
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
  return success({
    success: true,
    postId: postData.id || `urn:li:ugcPost:${Date.now()}`,
    platform: 'linkedin',
  });
}

async function handlePostToFacebook(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const body: any = event.body ? JSON.parse(event.body) : {};
  const { user_id, message, image_url } = body;
  if (!user_id || !message) return clientError('Missing user_id or message');

  // Get stored token
  const result = await ddb.send(new GetCommand({
    TableName: DYNAMODB_TABLE,
    Key: { PK: `USER#${user_id}`, SK: 'FACEBOOK_TOKEN#v0' },
  }));

  const token = result.Item as SocialTokenRecord | undefined;
  if (!token?.facebook_page_access_token) return clientError('Facebook not connected');
  if (!token.facebook_page_id) return clientError('No Facebook Page found');

  let postId: string;

  if (image_url) {
    // Post with photo
    try {
      const s3Image = await s3.send(new GetObjectCommand({
        Bucket: ATTACHMENTS_BUCKET,
        Key: image_url.replace(/^.*\/attachments\//, 'attachments/'),
      }));
      const imageBuffer = await s3Image.Body?.transformToByteArray();
      
      if (imageBuffer) {
        // Upload photo first
        const formData = new FormData();
        formData.append('access_token', token.facebook_page_access_token);
        formData.append('message', message);
        formData.append('source', new Blob([imageBuffer]));
        formData.append('published', 'true');

        const photoResp = await fetch(`https://graph.facebook.com/v20.0/${token.facebook_page_id}/photos`, {
          method: 'POST',
          body: formData,
        });

        if (!photoResp.ok) {
          const errBody = await photoResp.text();
          throw new Error(errBody);
        }

        const photoData: any = await photoResp.json();
        postId = photoData.id;
      } else {
        throw new Error('Failed to read image from S3');
      }
    } catch (e) {
      console.error('Facebook photo post failed, falling back to text:', e);
      // Fall through to text-only post
      const feedResp = await fetch(`https://graph.facebook.com/v20.0/${token.facebook_page_id}/feed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          access_token: token.facebook_page_access_token,
        }),
      });
      const feedData: any = await feedResp.json();
      postId = feedData.id;
    }
  } else {
    // Text-only post
    const feedResp = await fetch(`https://graph.facebook.com/v20.0/${token.facebook_page_id}/feed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        access_token: token.facebook_page_access_token,
      }),
    });

    if (!feedResp.ok) {
      const errBody = await feedResp.text();
      console.error('Facebook post failed:', errBody);
      return clientError(`Facebook post failed: ${errBody}`);
    }

    const feedData: any = await feedResp.json();
    postId = feedData.id;
  }

  return success({
    success: true,
    postId,
    platform: 'facebook',
  });
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

      // Facebook
      case 'GET /social/facebook/url':
        return await handleFacebookConnectUrl(event);
      case 'GET /social/facebook/callback':
        return await handleFacebookCallback(event);
      case 'GET /social/facebook/status':
        return await handleFacebookStatus(event);
      case 'POST /social/facebook/disconnect':
        return await handleFacebookDisconnect(event);
      case 'POST /social/facebook/post':
        return await handlePostToFacebook(event);

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