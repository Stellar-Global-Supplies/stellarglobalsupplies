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
var import_client_s3 = require("@aws-sdk/client-s3");
var REGION = process.env.AWS_REGION ?? "us-east-1";
var DYNAMODB_TABLE = process.env.DYNAMODB_TABLE;
var ATTACHMENTS_BUCKET = process.env.ATTACHMENTS_BUCKET;
var ddb = import_lib_dynamodb.DynamoDBDocumentClient.from(new import_client_dynamodb.DynamoDBClient({ region: REGION }), {
  marshallOptions: { removeUndefinedValues: true }
});
var s3 = new import_client_s3.S3Client({ region: REGION });
async function getRefreshToken(userId) {
  try {
    const result = await ddb.send(
      new import_lib_dynamodb.QueryCommand({
        TableName: DYNAMODB_TABLE,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: {
          ":pk": `USER#${userId}`,
          ":sk": "GOOGLE_TOKEN#"
        }
      })
    );
    const token = result.Items?.[0];
    return token?.refresh_token ?? null;
  } catch (err) {
    console.error("getRefreshToken error:", err);
    return null;
  }
}
async function refreshAccessToken(refreshToken) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET env vars not set");
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token"
    })
  });
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(json.error_description ?? json.error ?? "Token refresh failed");
  }
  return json.access_token;
}
async function uploadToS3(att, userId) {
  if (!ATTACHMENTS_BUCKET) throw new Error("ATTACHMENTS_BUCKET env var not set");
  const b64 = att.data.includes(",") ? att.data.split(",")[1] : att.data;
  const buffer = Buffer.from(b64, "base64");
  const safe = att.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const key = `attachments/${userId}/${Date.now()}-${safe}`;
  await s3.send(new import_client_s3.PutObjectCommand({
    Bucket: ATTACHMENTS_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: att.type || "application/octet-stream"
  }));
  return key;
}
async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}
async function sendViaGmail(accessToken, to, subject, body, attachmentKeys) {
  const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const lines = [
    `From: me`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset=UTF-8`,
    ``,
    body
  ];
  if (attachmentKeys.length > 0 && ATTACHMENTS_BUCKET) {
    for (const key of attachmentKeys) {
      try {
        const obj = await s3.send(new import_client_s3.GetObjectCommand({ Bucket: ATTACHMENTS_BUCKET, Key: key }));
        const buf = await streamToBuffer(obj.Body);
        const fname = key.split("/").pop() ?? "attachment";
        lines.push(
          ``,
          `--${boundary}`,
          `Content-Type: ${obj.ContentType ?? "application/octet-stream"}`,
          `Content-Disposition: attachment; filename="${fname}"`,
          `Content-Transfer-Encoding: base64`,
          ``,
          buf.toString("base64")
        );
      } catch (err) {
        console.error(`Skipping attachment ${key}:`, err);
      }
    }
  }
  lines.push(``, `--${boundary}--`, ``);
  const raw = Buffer.from(lines.join("\r\n")).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? `Gmail API ${res.status}`);
  }
}
var handler = async (event) => {
  try {
    let parsed;
    try {
      parsed = JSON.parse(event.body ?? "{}");
    } catch {
      return reply(400, { error: "Invalid JSON body" });
    }
    const { recipients, subject, body: emailBody, user_id, attachments = [], attachment_keys = [] } = parsed;
    if (!user_id?.trim()) return reply(400, { error: "user_id is required" });
    if (!Array.isArray(recipients) || recipients.length === 0) return reply(400, { error: "recipients must be a non-empty array" });
    if (!subject?.trim() || !emailBody?.trim()) return reply(400, { error: "subject and body are required" });
    const refreshToken = await getRefreshToken(user_id);
    if (!refreshToken) {
      return reply(401, { error: "Google account not connected. Please connect your Gmail account first." });
    }
    let accessToken;
    try {
      accessToken = await refreshAccessToken(refreshToken);
    } catch (err) {
      console.error("Token refresh failed:", err);
      return reply(401, { error: "Failed to authenticate with Google. Please reconnect your account." });
    }
    let allKeys = [...attachment_keys];
    if (attachments.length > 0) {
      if (!ATTACHMENTS_BUCKET) {
        console.warn("ATTACHMENTS_BUCKET not set \u2014 skipping attachment upload");
      } else {
        try {
          const uploaded = await Promise.all(attachments.map((att) => uploadToS3(att, user_id)));
          allKeys = [...allKeys, ...uploaded];
        } catch (err) {
          console.error("Attachment upload failed:", err);
          return reply(500, { error: "Failed to upload attachments. Please try again." });
        }
      }
    }
    const errors = [];
    let successCount = 0;
    let failedCount = 0;
    const BATCH = 10;
    for (let i = 0; i < recipients.length; i += BATCH) {
      await Promise.allSettled(
        recipients.slice(i, i + BATCH).map(async (email) => {
          try {
            await sendViaGmail(accessToken, email, subject.trim(), emailBody.trim(), allKeys);
            successCount++;
          } catch (err) {
            failedCount++;
            errors.push({ email, error: err instanceof Error ? err.message : "Unknown error" });
          }
        })
      );
      if (i + BATCH < recipients.length) {
        await new Promise((r) => setTimeout(r, 1e3));
      }
    }
    const result = { total: recipients.length, success: successCount, failed: failedCount };
    if (errors.length) result.errors = errors;
    return reply(200, result);
  } catch (err) {
    console.error("Unhandled handler error:", err);
    return reply(500, {
      error: "Failed to send emails",
      detail: err instanceof Error ? err.message : "Unknown error"
    });
  }
};
function reply(statusCode, body) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
