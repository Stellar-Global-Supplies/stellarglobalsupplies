import type {
  AgentProfile,
  AnalyticsSummary,
  ChatRequest,
  ChatResponse,
  GoogleConnectionStatus,
  PresignRequest,
  PresignResponse,
} from '@/types';
import { supabase } from '@/lib/supabase';

const BASE_URL = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') ?? '';

class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = `${BASE_URL}${path}`;

  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });

  if (!response.ok) {
    let body: unknown;
    try { body = await response.json(); } catch { /* ignore */ }
    throw new ApiError(
      response.status,
      `API ${init.method ?? 'GET'} ${path} failed: ${response.status} ${response.statusText}`,
      body,
    );
  }

  // Return null for 204 No Content
  if (response.status === 204) return null as T;

  return response.json() as Promise<T>;
}

// ────────────────────────────────────────────────────────────────────────────
// Agents
// ────────────────────────────────────────────────────────────────────────────

export async function listAgents(): Promise<AgentProfile[]> {
  return request<AgentProfile[]>('/agents');
}

// ────────────────────────────────────────────────────────────────────────────
// Chat
// ────────────────────────────────────────────────────────────────────────────

export async function sendChatMessage(
  agentId: string,
  payload: ChatRequest,
): Promise<ChatResponse> {
  return request<ChatResponse>(`/agents/${agentId}/chat`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Analytics
// ────────────────────────────────────────────────────────────────────────────

import { fetchAnalyticsSummarySupabase } from '@/services/analytics';

export async function fetchAnalyticsSummary(
  months: number = 6,
): Promise<AnalyticsSummary> {
  return fetchAnalyticsSummarySupabase(months);
}

// ────────────────────────────────────────────────────────────────────────────
// Data Ingestion — Pre-signed URL + direct S3 upload
// ────────────────────────────────────────────────────────────────────────────

export async function requestPresignedUrl(
  payload: PresignRequest,
): Promise<PresignResponse> {
  return request<PresignResponse>('/upload/presign', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function uploadFileToS3(
  uploadUrl: string,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new ApiError(xhr.status, `S3 upload failed: ${xhr.status}`));
      }
    });

    xhr.addEventListener('error', () =>
      reject(new Error('S3 upload network error')),
    );
    xhr.addEventListener('abort', () =>
      reject(new Error('S3 upload aborted')),
    );

    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.send(file);
  });
}

export { ApiError };

// ────────────────────────────────────────────────────────────────────────────
// Google OAuth — personal Calendar/Gmail access (Executive Assistant agent)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Returns the full URL that should be opened (window.location.href = ...)
 * to start the Google OAuth consent flow. This is a direct GET to the
 * `google-auth` Lambda, which responds with a 302 redirect to Google.
 */
export function getGoogleConnectUrl(userId: string): string {
  return `${BASE_URL}/auth/google/url?user_id=${encodeURIComponent(userId)}`;
}

export async function getGoogleConnectionStatus(
  userId: string,
): Promise<GoogleConnectionStatus> {
  return request<GoogleConnectionStatus>(
    `/auth/google/status?user_id=${encodeURIComponent(userId)}`,
  );
}

export async function disconnectGoogleAccount(userId: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>('/auth/google/disconnect', {
    method: 'POST',
    body:   JSON.stringify({ user_id: userId }),
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Web analytics and Meta marketing (reads from analytics S3 bucket via Lambda)
// ────────────────────────────────────────────────────────────────────────────
import type { WebAnalyticsData, MetaAnalyticsData, AnalyticsPeriod } from '@/types';

export async function fetchWebAnalytics(period: AnalyticsPeriod = 'weekly'): Promise<WebAnalyticsData> {
  return request<WebAnalyticsData>(`/analytics/web?period=${period}`);
}

// ────────────────────────────────────────────────────────────────────────────
// Bulk Email Campaigns
// ────────────────────────────────────────────────────────────────────────────

/** An attachment encoded as a base64 data-URI, safe for JSON transport. */
export interface EncodedAttachment {
  name: string;
  type: string;
  data: string; // "data:<mime>;base64,<b64>"
}

export interface BulkEmailRequest {
  recipients:  string[];
  subject:     string;
  body:        string;
  /** Pass File objects — sendBulkEmail encodes them to base64 before sending. */
  attachments?: File[];
}

export interface BulkEmailResponse {
  total:    number;
  success:  number;
  failed:   number;
  errors?:  Array<{ email: string; error: string }>;
}

/** Encode a File to a base64 data-URI string. */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export async function sendBulkEmail(payload: BulkEmailRequest): Promise<BulkEmailResponse> {
  const base = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';

  // Resolve user_id from Supabase session
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user?.id) {
    throw new Error('User not authenticated');
  }

  // Encode File attachments to base64 — File objects are not JSON-serialisable.
  let encodedAttachments: EncodedAttachment[] = [];
  if (payload.attachments && payload.attachments.length > 0) {
    encodedAttachments = await Promise.all(
      payload.attachments.map(async (file): Promise<EncodedAttachment> => ({
        name: file.name,
        type: file.type || 'application/octet-stream',
        data: await fileToBase64(file),
      })),
    );
  }

  const endpoint = `${base}/email/send`;

  try {
    const res = await fetch(endpoint, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipients:  payload.recipients,
        subject:     payload.subject,
        body:        payload.body,
        user_id:     session.user.id,
        attachments: encodedAttachments,
      }),
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error?.error || error?.message || `HTTP ${res.status}`);
    }

    return await res.json() as BulkEmailResponse;
  } catch (err) {
    console.error('sendBulkEmail error', err);
    throw err;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Social Media — LinkedIn & Facebook posting
// ────────────────────────────────────────────────────────────────────────────

export interface LinkedInConnectionStatus {
  connected: boolean;
  linkedin_page_name?: string;
  linkedin_urn?: string;
  connected_at?: string;
  scope?: string;
}

export interface FacebookConnectionStatus {
  connected: boolean;
  facebook_page_id?: string;
  facebook_page_name?: string;
  connected_at?: string;
}

export function getLinkedInConnectUrl(userId: string): string {
  return `${BASE_URL}/social/linkedin/url?user_id=${encodeURIComponent(userId)}`;
}

export async function getLinkedInStatus(userId: string): Promise<LinkedInConnectionStatus> {
  return request<LinkedInConnectionStatus>(
    `/social/linkedin/status?user_id=${encodeURIComponent(userId)}`,
  );
}

export async function disconnectLinkedIn(userId: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>('/social/linkedin/disconnect', {
    method: 'POST',
    body: JSON.stringify({ user_id: userId }),
  });
}

export async function postToLinkedIn(userId: string, content: string, imageUrl?: string): Promise<{ success: boolean; postId?: string; platform: string }> {
  return request<{ success: boolean; postId?: string; platform: string }>('/social/linkedin/post', {
    method: 'POST',
    body: JSON.stringify({ user_id: userId, content, image_url: imageUrl }),
  });
}

export function getFacebookConnectUrl(userId: string): string {
  return `${BASE_URL}/social/facebook/url?user_id=${encodeURIComponent(userId)}`;
}

export async function getFacebookStatus(userId: string): Promise<FacebookConnectionStatus> {
  return request<FacebookConnectionStatus>(
    `/social/facebook/status?user_id=${encodeURIComponent(userId)}`,
  );
}

export async function disconnectFacebook(userId: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>('/social/facebook/disconnect', {
    method: 'POST',
    body: JSON.stringify({ user_id: userId }),
  });
}

export async function postToFacebook(userId: string, message: string, imageUrl?: string): Promise<{ success: boolean; postId?: string; platform: string }> {
  return request<{ success: boolean; postId?: string; platform: string }>('/social/facebook/post', {
    method: 'POST',
    body: JSON.stringify({ user_id: userId, message, image_url: imageUrl }),
  });
}

export async function fetchMetaAnalytics(period: AnalyticsPeriod = 'weekly'): Promise<MetaAnalyticsData> {
  try {
    const data = await request<MetaAnalyticsData>(`/analytics/meta?period=${period}`);
    const hasLegacyShape = typeof data?.summary?.total_requests === 'number';
    const hasNativeMetaShape = Boolean((data as any)?.instagram || (data as any)?.facebook || (data as any)?.ads);
    if (!hasLegacyShape && !hasNativeMetaShape) {
      throw new Error('Meta analytics API returned an empty payload.');
    }
    return data;
  } catch (err) {
    console.warn('[analytics] Falling back to bundled Meta analytics JSON', err);
    const fallback = await fetch(`/meta/${period}.json`, { cache: 'no-store' });
    if (!fallback.ok) throw err;
    return fallback.json() as Promise<MetaAnalyticsData>;
  }
}