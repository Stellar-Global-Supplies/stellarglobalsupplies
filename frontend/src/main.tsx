import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './index.css';
import { initTracing } from './tracing';

// ────────────────────────────────────────────────────────────────────────────
// OTLP Tracing — initialise BEFORE React mounts so the document-load span
// captures the full page lifecycle and all subsequent fetch spans are recorded.
// ────────────────────────────────────────────────────────────────────────────
initTracing();

// ────────────────────────────────────────────────────────────────────────────
// PWA Service Worker Registration
// ────────────────────────────────────────────────────────────────────────────
const updateSW = registerSW({
  onNeedRefresh() {
    const event = new CustomEvent('pwa:update-available');
    window.dispatchEvent(event);
    console.info('[SW] New content available — call updateSW() to activate.');
  },
  onOfflineReady() {
    const event = new CustomEvent('pwa:offline-ready');
    window.dispatchEvent(event);
    console.info('[SW] App is ready for offline use.');
  },
  onRegistered(swRegistration) {
    console.info('[SW] Service Worker registered:', swRegistration?.scope);
    if (swRegistration) {
      setInterval(() => swRegistration.update(), 60 * 60 * 1000);
    }
  },
  onRegisterError(err) {
    console.error('[SW] Service Worker registration failed:', err);
  },
  immediate: true,
});

(window as Window & { __updateSW?: () => Promise<void> }).__updateSW = updateSW;

// ────────────────────────────────────────────────────────────────────────────
// React Query Client
// ────────────────────────────────────────────────────────────────────────────
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime:            5 * 60 * 1000,
      gcTime:               30 * 60 * 1000,
      retry:                2,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 1,
    },
  },
});

// ────────────────────────────────────────────────────────────────────────────
// Mount
// ────────────────────────────────────────────────────────────────────────────
const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found in DOM.');

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
