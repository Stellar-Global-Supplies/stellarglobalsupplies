import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

// ────────────────────────────────────────────────────────────────────────────
// Config
// ────────────────────────────────────────────────────────────────────────────
const REGION              = process.env.AWS_REGION ?? 'ap-south-1';
const DYNAMODB_TABLE      = process.env.DYNAMODB_TABLE!;
const CLIENT_ID_PARAM     = process.env.GOOGLE_CLIENT_ID_PARAM!;
const CLIENT_SECRET_PARAM = process.env.GOOGLE_CLIENT_SECRET_PARAM!;
const REDIRECT_URI        = process.env.GOOGLE_REDIRECT_URI!;
const FRONTEND_URL        = process.env.FRONTEND_URL!;

// Scopes requested for the Executive Assistant agent.
// - calendar.events: create/read/update calendar events (not full calendar settings)
// - gmail.send:      send email drafted by the agent
// - gmail.readonly:  read recent messages for meeting-synopsis context
const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
  'openid',
  'email',
].join(' ');

const ddbClient = new DynamoDBClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});

const ssm = new SSMClient({ region: REGION });

// ────────────────────────────────────────────────────────────────────────────
// Cached SSM secrets
// ────────────────────────────────────────────────────────────────────────────
let cachedClientId:     string | null = null;
let cachedClientSecret: string | null = null;

async function getOAuthCredentials(): Promise<{ clientId: string; clientSecret: string }> {
  if (cachedClientId && cachedClientSecret) {
    return { clientId: cachedClientId, clientSecret: cachedClientSecret };
  }

  const [idResult, secretResult] = await Promise.all([
    ssm.send(new GetParameterCommand({ Name: CLIENT_ID_PARAM, WithDecryption: true })),
    ssm.send(new GetParameterCommand({ Name: CLIENT_SECRET_PARAM, WithDecryption: true })),
  ]);

  const clientId     = idResult.Parameter?.Value;
  const clientSecret = secretResult.Parameter?.Value;

  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth client credentials not found in SSM.');
  }

  cachedClientId     = clientId;
  cachedClientSecret = clientSecret;
  return { clientId, clientSecret };
}

// ────────────────────────────────────────────────────────────────────────────
// CORS
// ────────────────────────────────────────────────────────────────────────────
const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  FRONTEND_URL,
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonResponse(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  };
}

function redirectResponse(location: string): APIGatewayProxyResultV2 {
  return {
    statusCode: 302,
    headers: { Location: location },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Token storage
// ────────────────────────────────────────────────────────────────────────────
interface GoogleTokenItem {
  PK:            string; // USER#<user_id>
  SK:            string; // GOOGLE_TOKEN#v0
  entityType:    'GOOGLE_TOKEN';
  refresh_token: string;
  scope:         string;
  google_email?: string;
  connected_at:  string;
}

async function storeRefreshToken(
  userId: string,
  refreshToken: string,
  scope: string,
  googleEmail?: string,
): Promise<void> {
  const item: GoogleTokenItem = {
    PK:            `USER#${userId}`,
    SK:            'GOOGLE_TOKEN#v0',
    entityType:    'GOOGLE_TOKEN',
    refresh_token: refreshToken,
    scope,
    google_email:  googleEmail,
    connected_at:  new Date().toISOString(),
  };

  await ddb.send(new PutCommand({ TableName: DYNAMODB_TABLE, Item: item }));
}

// ────────────────────────────────────────────────────────────────────────────
// Route: GET /auth/google/url
// Generates the Google consent screen URL and redirects the browser there.
// ────────────────────────────────────────────────────────────────────────────
async function handleAuthUrl(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const userId = event.queryStringParameters?.user_id;
  if (!userId) {
    return jsonResponse(400, { error: '`user_id` query parameter is required.' });
  }

  let clientId: string;
  try {
    ({ clientId } = await getOAuthCredentials());
  } catch (err) {
    console.error('[google-auth] Failed to load OAuth credentials', err);
    return jsonResponse(500, { error: 'OAuth is not configured.' });
  }

  // NOTE: `state` carries the internal user_id so the callback knows whose
  // refresh token this is. For an internal single-user tool this is an
  // acceptable trade-off; for multi-tenant use, also bind a signed nonce.
  const params = new URLSearchParams({
    client_id:              clientId,
    redirect_uri:           REDIRECT_URI,
    response_type:          'code',
    scope:                  SCOPES,
    access_type:            'offline',
    prompt:                 'consent',
    include_granted_scopes: 'true',
    state:                  userId,
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

  return redirectResponse(authUrl);
}

// ────────────────────────────────────────────────────────────────────────────
// Route: GET /auth/google/callback
// Exchanges the authorization code for tokens, stores the refresh token,
// then redirects back to the frontend.
// ────────────────────────────────────────────────────────────────────────────
async function handleCallback(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const qs    = event.queryStringParameters ?? {};
  const code  = qs.code;
  const state = qs.state; // user_id
  const error = qs.error;

  if (error) {
    console.warn('[google-auth] User denied consent or error returned', { error });
    return redirectResponse(`${FRONTEND_URL}/agents?google_connected=false&reason=${encodeURIComponent(error)}`);
  }

  if (!code || !state) {
    return jsonResponse(400, { error: 'Missing `code` or `state` query parameter.' });
  }

  const userId = state;

  let clientId: string;
  let clientSecret: string;
  try {
    ({ clientId, clientSecret } = await getOAuthCredentials());
  } catch (err) {
    console.error('[google-auth] Failed to load OAuth credentials', err);
    return redirectResponse(`${FRONTEND_URL}/agents?google_connected=false&reason=config_error`);
  }

  // ── Exchange authorization code for tokens ──────────────────────────────
  let tokenJson: {
    access_token?:      string;
    refresh_token?:     string;
    scope?:             string;
    expires_in?:        number;
    id_token?:          string;
    error?:             string;
    error_description?: string;
  };

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id:     clientId,
        client_secret: clientSecret,
        redirect_uri:  REDIRECT_URI,
        grant_type:    'authorization_code',
      }).toString(),
    });

    tokenJson = (await tokenRes.json()) as {
      access_token?: string; refresh_token?: string; scope?: string;
      expires_in?: number; id_token?: string;
      error?: string; error_description?: string;
    };

    if (!tokenRes.ok || tokenJson.error) {
      console.error('[google-auth] Token exchange failed', tokenJson);
      return redirectResponse(`${FRONTEND_URL}/agents?google_connected=false&reason=token_exchange_failed`);
    }
  } catch (err) {
    console.error('[google-auth] Token exchange network error', err);
    return redirectResponse(`${FRONTEND_URL}/agents?google_connected=false&reason=network_error`);
  }

  if (!tokenJson.refresh_token) {
    // `prompt=consent` should always cause Google to return a refresh_token,
    // but guard anyway with a clear message for the rare edge case.
    console.warn('[google-auth] No refresh_token returned', { scope: tokenJson.scope });
    return redirectResponse(`${FRONTEND_URL}/agents?google_connected=false&reason=no_refresh_token`);
  }

  // ── Fetch the connected Google account's email (for display only) ──────
  let googleEmail: string | undefined;
  try {
    const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    });
    if (userInfoRes.ok) {
      const userInfo = await userInfoRes.json() as { email?: string };
      googleEmail = userInfo.email;
    }
  } catch {
    // Non-fatal — display name is cosmetic
  }

  // ── Store refresh token ──────────────────────────────────────────────────
  try {
    await storeRefreshToken(userId, tokenJson.refresh_token, tokenJson.scope ?? SCOPES, googleEmail);
  } catch (err) {
    console.error('[google-auth] Failed to store refresh token', err);
    return redirectResponse(`${FRONTEND_URL}/agents?google_connected=false&reason=storage_error`);
  }

  console.info('[google-auth] Successfully connected Google account', { userId, googleEmail });

  return redirectResponse(
    `${FRONTEND_URL}/agents?google_connected=true&email=${encodeURIComponent(googleEmail ?? '')}`,
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Main handler
// ────────────────────────────────────────────────────────────────────────────
export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const method  = event.requestContext.http.method.toUpperCase();
  const rawPath = event.rawPath ?? event.requestContext.http.path ?? '/';

  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  if (method === 'GET' && rawPath === '/auth/google/url') {
    return handleAuthUrl(event);
  }

  if (method === 'GET' && rawPath === '/auth/google/callback') {
    return handleCallback(event);
  }

  return jsonResponse(404, { error: `Route ${method} ${rawPath} not found.` });
};
