/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Full URL of the API, e.g. https://cloudvault-api.example.workers.dev/api. Defaults to /api. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
