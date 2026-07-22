/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEPLOYMENT_ENV?: "development" | "production";
  readonly VITE_PUBLIC_APP_URL?: string;
  readonly VITE_BASE_PATH?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  /** Public Web Push application-server key. Never place a VAPID private key here. */
  readonly VITE_VAPID_PUBLIC_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
