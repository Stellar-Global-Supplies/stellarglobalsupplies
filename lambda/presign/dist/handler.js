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
var import_client_s3 = require("@aws-sdk/client-s3");
var import_s3_request_presigner = require("@aws-sdk/s3-request-presigner");
var import_crypto = require("crypto");
var REGION = process.env.AWS_REGION ?? "ap-south-1";
var DATA_BUCKET = process.env.DATA_BUCKET;
var ATTACHMENTS_BUCKET = process.env.ATTACHMENTS_BUCKET;
var ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? "*";
var PRESIGN_TTL = 15 * 60;
var READ_TTL = 30 * 60;
var MAX_BYTES = 100 * 1024 * 1024;
var s3 = new import_client_s3.S3Client({ region: REGION });
var CORS_HEADERS = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json"
};
function respond(statusCode, body) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body)
  };
}
function sanitizeFilename(name) {
  return name.replace(/^.*[\\/]/, "").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
}
var IMAGE_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
function isImageUpload(ct) {
  return IMAGE_CONTENT_TYPES.includes(ct);
}
function validateContentType(ct) {
  return ["text/csv", "application/json", "text/plain", ...IMAGE_CONTENT_TYPES].includes(ct);
}
function getFileExtension(filename, contentType) {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext === "csv" || contentType === "text/csv" || contentType === "text/plain") return "csv";
  if (ext === "json" || contentType === "application/json") return "json";
  if (isImageUpload(contentType)) {
    if (ext && ["jpg", "jpeg", "png", "webp", "gif"].includes(ext)) return ext;
    return contentType.split("/")[1] || "jpg";
  }
  return null;
}
var handler = async (event) => {
  if (event.requestContext.http.method === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }
  if (!event.body) {
    return respond(400, { error: "Request body is required." });
  }
  let payload;
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf-8") : event.body;
    payload = JSON.parse(raw);
  } catch {
    return respond(400, { error: "Invalid JSON in request body." });
  }
  const { filename, content_type, file_size } = payload;
  if (!filename || typeof filename !== "string" || filename.trim() === "") {
    return respond(400, { error: "`filename` is required and must be a non-empty string." });
  }
  if (!content_type || typeof content_type !== "string") {
    return respond(400, { error: "`content_type` is required." });
  }
  if (typeof file_size !== "number" || file_size <= 0) {
    return respond(400, { error: "`file_size` must be a positive number." });
  }
  if (!validateContentType(content_type)) {
    return respond(415, {
      error: `Unsupported content type "${content_type}". Only text/csv, application/json, and image/* (jpeg, png, webp, gif) are accepted.`
    });
  }
  if (file_size > MAX_BYTES) {
    return respond(413, {
      error: `File size ${file_size} bytes exceeds the ${MAX_BYTES / (1024 * 1024)} MB limit.`
    });
  }
  const safeFilename = sanitizeFilename(filename);
  const ext = getFileExtension(safeFilename, content_type);
  if (!ext) {
    return respond(400, {
      error: `Cannot determine file extension. Use a .csv or .json filename.`
    });
  }
  const uploadId = (0, import_crypto.randomUUID)();
  const isImage = isImageUpload(content_type);
  const bucket = isImage ? ATTACHMENTS_BUCKET : DATA_BUCKET;
  const key = isImage ? `attachments/${uploadId}/${safeFilename}` : `raw-ingest/${uploadId}/${safeFilename}`;
  try {
    const command = new import_client_s3.PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: content_type,
      ContentLength: file_size,
      Metadata: {
        "x-upload-id": uploadId,
        "x-original-name": safeFilename,
        "x-file-size": String(file_size),
        "x-requested-at": (/* @__PURE__ */ new Date()).toISOString()
      }
    });
    const upload_url = await (0, import_s3_request_presigner.getSignedUrl)(s3, command, {
      expiresIn: PRESIGN_TTL,
      signableHeaders: /* @__PURE__ */ new Set(["content-type"]),
      unhoistableHeaders: /* @__PURE__ */ new Set(["content-length"])
    });
    const responseBody = {
      upload_url,
      key,
      expires_in: PRESIGN_TTL
    };
    if (isImage) {
      responseBody.read_url = await (0, import_s3_request_presigner.getSignedUrl)(
        s3,
        new import_client_s3.GetObjectCommand({ Bucket: bucket, Key: key }),
        { expiresIn: READ_TTL }
      );
    }
    console.info("[presign] Generated pre-signed URL", {
      key,
      bucket,
      upload_id: uploadId,
      file_size,
      content_type
    });
    return respond(200, responseBody);
  } catch (err) {
    console.error("[presign] Failed to generate pre-signed URL", err);
    return respond(500, { error: "Failed to generate upload URL. Please try again." });
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
