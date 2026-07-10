"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/handler.ts
var handler_exports = {};
__export(handler_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(handler_exports);
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");
var import_client_ssm = require("@aws-sdk/client-ssm");
var REGION = process.env.AWS_REGION ?? "ap-south-1";
var DYNAMODB_TABLE = process.env.DYNAMODB_TABLE;
var CLIENT_ID_PARAM = process.env.GOOGLE_CLIENT_ID_PARAM;
var CLIENT_SECRET_PARAM = process.env.GOOGLE_CLIENT_SECRET_PARAM;
var REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;
var FRONTEND_URL = process.env.FRONTEND_URL;
var SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "openid",
  "email"
].join(" ");
var ddbClient = new import_client_dynamodb.DynamoDBClient({ region: REGION });
var ddb = import_lib_dynamodb.DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true }
});
var ssm = new import_client_ssm.SSMClient({ region: REGION });
var cachedClientId = null;
var cachedClientSecret = null;
async function getOAuthCredentials() {
  if (cachedClientId && cachedClientSecret) {
    return { clientId: cachedClientId, clientSecret: cachedClientSecret };
  }
  const [idResult, secretResult] = await Promise.all([
    ssm.send(new import_client_ssm.GetParameterCommand({ Name: CLIENT_ID_PARAM, WithDecryption: true })),
    ssm.send(new import_client_ssm.GetParameterCommand({ Name: CLIENT_SECRET_PARAM, WithDecryption: true }))
  ]);
  const clientId = idResult.Parameter?.Value;
  const clientSecret = secretResult.Parameter?.Value;
  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth client credentials not found in SSM.");
  }
  cachedClientId = clientId;
  cachedClientSecret = clientSecret;
  return { clientId, clientSecret };
}
var CORS_HEADERS = {
  "Access-Control-Allow-Origin": FRONTEND_URL,
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};
function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  };
}
function redirectResponse(location) {
  return {
    statusCode: 302,
    headers: { Location: location }
  };
}
async function storeRefreshToken(userId, refreshToken, scope, googleEmail) {
  const item = {
    PK: `USER#${userId}`,
    SK: "GOOGLE_TOKEN#v0",
    entityType: "GOOGLE_TOKEN",
    refresh_token: refreshToken,
    scope,
    google_email: googleEmail,
    connected_at: (/* @__PURE__ */ new Date()).toISOString()
  };
  await ddb.send(new import_lib_dynamodb.PutCommand({ TableName: DYNAMODB_TABLE, Item: item }));
}
async function handleAuthUrl(event) {
  const userId = event.queryStringParameters?.user_id;
  if (!userId) {
    return jsonResponse(400, { error: "`user_id` query parameter is required." });
  }
  let clientId;
  try {
    ({ clientId } = await getOAuthCredentials());
  } catch (err) {
    console.error("[google-auth] Failed to load OAuth credentials", err);
    return jsonResponse(500, { error: "OAuth is not configured." });
  }
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: userId
  });
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  return redirectResponse(authUrl);
}
async function handleCallback(event) {
  const qs = event.queryStringParameters ?? {};
  const code = qs.code;
  const state = qs.state;
  const error = qs.error;
  if (error) {
    console.warn("[google-auth] User denied consent or error returned", { error });
    return redirectResponse(`${FRONTEND_URL}/agents?google_connected=false&reason=${encodeURIComponent(error)}`);
  }
  if (!code || !state) {
    return jsonResponse(400, { error: "Missing `code` or `state` query parameter." });
  }
  const userId = state;
  let clientId;
  let clientSecret;
  try {
    ({ clientId, clientSecret } = await getOAuthCredentials());
  } catch (err) {
    console.error("[google-auth] Failed to load OAuth credentials", err);
    return redirectResponse(`${FRONTEND_URL}/agents?google_connected=false&reason=config_error`);
  }
  let tokenJson;
  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code"
      }).toString()
    });
    tokenJson = await tokenRes.json();
    if (!tokenRes.ok || tokenJson.error) {
      console.error("[google-auth] Token exchange failed", tokenJson);
      return redirectResponse(`${FRONTEND_URL}/agents?google_connected=false&reason=token_exchange_failed`);
    }
  } catch (err) {
    console.error("[google-auth] Token exchange network error", err);
    return redirectResponse(`${FRONTEND_URL}/agents?google_connected=false&reason=network_error`);
  }
  if (!tokenJson.refresh_token) {
    console.warn("[google-auth] No refresh_token returned", { scope: tokenJson.scope });
    return redirectResponse(`${FRONTEND_URL}/agents?google_connected=false&reason=no_refresh_token`);
  }
  let googleEmail;
  try {
    const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` }
    });
    if (userInfoRes.ok) {
      const userInfo = await userInfoRes.json();
      googleEmail = userInfo.email;
    }
  } catch {
  }
  try {
    await storeRefreshToken(userId, tokenJson.refresh_token, tokenJson.scope ?? SCOPES, googleEmail);
  } catch (err) {
    console.error("[google-auth] Failed to store refresh token", err);
    return redirectResponse(`${FRONTEND_URL}/agents?google_connected=false&reason=storage_error`);
  }
  console.info("[google-auth] Successfully connected Google account", { userId, googleEmail });
  return redirectResponse(
    `${FRONTEND_URL}/agents?google_connected=true&email=${encodeURIComponent(googleEmail ?? "")}`
  );
}
var handler = async (event) => {
  const method = event.requestContext.http.method.toUpperCase();
  const rawPath = event.rawPath ?? event.requestContext.http.path ?? "/";
  if (method === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }
  if (method === "GET" && rawPath === "/auth/google/url") {
    return handleAuthUrl(event);
  }
  if (method === "GET" && rawPath === "/auth/google/callback") {
    return handleCallback(event);
  }
  return jsonResponse(404, { error: `Route ${method} ${rawPath} not found.` });
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
