/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL:   string;
  readonly VITE_APP_VERSION:    string;
  readonly VITE_ENVIRONMENT:    'production' | 'staging' | 'development';
  readonly VITE_NR_LICENSE_KEY: string;  // New Relic ingest key for OTLP export
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __APP_VERSION__: string;

declare function createDOMPurify(window: Window): {
  sanitize(dirty: string, options?: { USE_PROFILES?: { html?: boolean } }): string;
};