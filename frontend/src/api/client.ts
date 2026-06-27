import type {
  AgentProfile,
  AnalyticsSummary,
  ChatRequest,
  ChatResponse,
  GoogleConnectionStatus,
  PresignRequest,
  PresignResponse,
} from '@/types';

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

export interface BulkEmailRequest {
  recipients: string[];
  subject: string;
  body: string;
  attachments?: File[];
}

export interface BulkEmailResponse {
  total: number;
  success: number;
  failed: number;
  errors?: Array<{ email: string; error: string }>;
}

export async function sendBulkEmail(payload: BulkEmailRequest): Promise<BulkEmailResponse> {
  // For now, return mock success
  // In production, this would upload attachments to S3 and call a Lambda
  console.log('Sending bulk email:', payload);
  
  return {
    total: payload.recipients.length,
    success: payload.recipients.length,
    failed: 0,
  };
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
