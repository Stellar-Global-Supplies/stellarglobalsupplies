/// <reference lib="webworker" />
/* eslint-disable no-restricted-globals */

/**
 * src/sw.ts
 * ────────────────────────────────────────────────────────────────────────
 * Custom service worker logic for the Stellar Global Ops PWA.
 *
 * This file documents and implements the additional runtime behaviours
 * layered on top of the Workbox-generated `sw.js` (see vite.config.ts ->
 * VitePWA -> workbox.runtimeCaching for the precache/cache-first rules).
 *
 * Responsibilities handled here:
 *   1. Background Sync — queue failed chat / ingestion POST requests made
 *      while offline, and replay them once connectivity is restored.
 *   2. Offline fallback — serve a lightweight offline page for navigation
 *      requests that miss the precache (e.g. first visit while offline).
 *   3. Push-ready scaffolding — structure for future server-sent
 *      notifications (agent task completion, ingestion finished).
 *
 * NOTE: vite-plugin-pwa (generateSW strategy) produces the final `sw.js`
 * bundle from `workbox.runtimeCaching` config. This file is the source of
 * truth for the *custom* event listeners that are merged in via
 * `importScripts` during the build (see build note at bottom of file) —
 * if you switch to the `injectManifest` strategy, this file becomes the
 * direct entry point and should `import { precacheAndRoute } from
 * 'workbox-precaching'` plus `self.__WB_MANIFEST`.
 * ────────────────────────────────────────────────────────────────────────
 */

declare const self: ServiceWorkerGlobalScope;
interface SyncEvent extends ExtendableEvent {
  readonly tag: string;
}
const OFFLINE_FALLBACK_URL = '/offline.html';
const SYNC_QUEUE_DB        = 'sgs-ops-sync-queue';
const SYNC_QUEUE_STORE     = 'pending-requests';
const SYNC_TAG_CHAT        = 'sync-chat-messages';
const SYNC_TAG_INGEST      = 'sync-ingest-jobs';

// ────────────────────────────────────────────────────────────────────────────
// IndexedDB helpers for the offline request queue
// ────────────────────────────────────────────────────────────────────────────
interface QueuedRequest {
  id:        string;
  url:       string;
  method:    string;
  headers:   Record<string, string>;
  body:      string;
  timestamp: number;
  tag:       string;
}

function openQueueDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SYNC_QUEUE_DB, 1);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SYNC_QUEUE_STORE)) {
        db.createObjectStore(SYNC_QUEUE_STORE, { keyPath: 'id' });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function queueRequest(item: QueuedRequest): Promise<void> {
  const db = await openQueueDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(SYNC_QUEUE_STORE, 'readwrite');
    const store = tx.objectStore(SYNC_QUEUE_STORE);
    store.put(item);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

async function getQueuedRequests(tag: string): Promise<QueuedRequest[]> {
  const db = await openQueueDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(SYNC_QUEUE_STORE, 'readonly');
    const store = tx.objectStore(SYNC_QUEUE_STORE);
    const req   = store.getAll();
    req.onsuccess = () => {
      const all = (req.result as QueuedRequest[]) ?? [];
      resolve(all.filter((r) => r.tag === tag));
    };
    req.onerror = () => reject(req.error);
  });
}

async function removeQueuedRequest(id: string): Promise<void> {
  const db = await openQueueDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(SYNC_QUEUE_STORE, 'readwrite');
    const store = tx.objectStore(SYNC_QUEUE_STORE);
    store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Fetch interception — queue failed POSTs to /agents/*/chat and /upload/*
// ────────────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event: FetchEvent) => {
  const { request } = event;
  const url = new URL(request.url);

  const isChatPost   = request.method === 'POST' && /\/agents\/[^/]+\/chat$/.test(url.pathname);
  const isIngestPost = request.method === 'POST' && url.pathname === '/upload/presign';
  const isApiCall    = url.pathname.startsWith('/api/');

  // For API calls, always use network-first (no caching)
  if (isApiCall) {
    event.respondWith(fetch(request));
    return;
  }

  if (!isChatPost && !isIngestPost) {
    return; // let Workbox / network handle everything else
  }

  event.respondWith(
    (async () => {
      try {
        // Try the network first — most cases succeed
        const response = await fetch(request.clone());
        return response;
      } catch (err) {
        // Offline — queue the request for background sync
        const body = await request.clone().text();
        const headers: Record<string, string> = {};
        request.headers.forEach((v, k) => { headers[k] = v; });

        const queued: QueuedRequest = {
          id:        `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          url:       request.url,
          method:    request.method,
          headers,
          body,
          timestamp: Date.now(),
          tag:       isChatPost ? SYNC_TAG_CHAT : SYNC_TAG_INGEST,
        };

        await queueRequest(queued);

        // Register a background sync if supported
        if ('sync' in self.registration) {
          try {
            await (self.registration as ServiceWorkerRegistration & {
              sync: { register: (tag: string) => Promise<void> };
            }).sync.register(queued.tag);
          } catch {
            // Background Sync API unsupported — request stays queued
            // and will be retried on next 'online' fetch attempt.
          }
        }

        // Return a synthetic 202 so the UI can show "queued for sync"
        return new Response(
          JSON.stringify({
            queued:  true,
            message: 'You are offline. This request has been queued and will be sent automatically once connectivity is restored.',
          }),
          {
            status:  202,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }
    })(),
  );
});

// ────────────────────────────────────────────────────────────────────────────
// Background Sync — replay queued requests
// ────────────────────────────────────────────────────────────────────────────
self.addEventListener('sync', ((event: Event) => {
  const syncEvent = event as SyncEvent;

  if (
    syncEvent.tag === SYNC_TAG_CHAT ||
    syncEvent.tag === SYNC_TAG_INGEST
  ) {
    syncEvent.waitUntil(
      replayQueue(syncEvent.tag)
    );
  }
}) as EventListener);

async function replayQueue(tag: string): Promise<void> {
  const items = await getQueuedRequests(tag);

  for (const item of items) {
    try {
      const response = await fetch(item.url, {
        method:  item.method,
        headers: item.headers,
        body:    item.body,
      });

      if (response.ok) {
        await removeQueuedRequest(item.id);

        // Notify open clients so the UI can refresh state
        const clientsList = await self.clients.matchAll({ type: 'window' });
        for (const client of clientsList) {
          client.postMessage({
            type:    'sync-replay-success',
            tag,
            queued_id: item.id,
            url:     item.url,
          });
        }
      }
      // Non-OK responses are left in the queue for the next sync attempt
    } catch {
      // Still offline — leave in queue, will retry on next sync event
      break;
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Navigation fallback — offline.html for uncached navigations
// ────────────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event: FetchEvent) => {
  if (event.request.mode !== 'navigate') return;

  event.respondWith(
    (async () => {
      try {
        return await fetch(event.request);
      } catch {
        const cache = await caches.open('offline-fallback');
        const cached = await cache.match(OFFLINE_FALLBACK_URL);
        return cached ?? Response.error();
      }
    })(),
  );
});

// Pre-cache the offline fallback page on install
self.addEventListener('install', (event: ExtendableEvent) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open('offline-fallback');
      try {
        await cache.add(OFFLINE_FALLBACK_URL);
      } catch {
        // offline.html may not exist in dev — non-fatal
      }
    })(),
  );
});

// ────────────────────────────────────────────────────────────────────────────
// Push notifications (scaffolding for future agent-task / ingest-complete
// notifications triggered server-side via Web Push)
// ────────────────────────────────────────────────────────────────────────────
self.addEventListener('push', (event: PushEvent) => {
  if (!event.data) return;

  let payload: { title: string; body: string; url?: string };
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'SGS Ops', body: event.data.text() };
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      data: { url: payload.url ?? '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  const targetUrl = (event.notification.data as { url?: string })?.url ?? '/';

  event.waitUntil(
    (async () => {
      const clientsList = await self.clients.matchAll({ type: 'window' });
      const existing = clientsList.find((c) => c.url.includes(targetUrl));
      if (existing) {
        await existing.focus();
      } else {
        await self.clients.openWindow(targetUrl);
      }
    })(),
  );
});

export {};
