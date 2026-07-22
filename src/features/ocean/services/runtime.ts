import { SupabaseAdminGateway } from "@/features/admin/services/supabase-admin-gateway";
import type { AdminGateway } from "@/features/admin/types/admin";
import { readAppRoute } from "@/app/use-hash-route";
import { SupabaseAuthGateway } from "@/features/auth/services/supabase-auth-gateway";
import type { AuthGateway } from "@/features/auth/types/auth";
import { createBrowserSupabaseClient } from "@/features/ocean/services/supabase-client";
import { SupabaseOceanGateway } from "@/features/ocean/services/supabase-ocean-gateway";
import type { OceanGateway } from "@/features/ocean/types/ocean";
import {
  ConservativeLocalSafetyProvider,
  DisabledTranslationProvider,
} from "@/features/ocean/services/safety-provider";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const isAdminAuthRoute = typeof window !== "undefined" && readAppRoute() === "admin";
const adminSessionStorage = (() => {
  if (typeof window === "undefined") return undefined;
  try {
    return window.sessionStorage;
  } catch {
    // Browsers that block sessionStorage still retain the separate admin key.
    return undefined;
  }
})();

const supabaseClient = supabaseUrl && supabasePublishableKey
  ? createBrowserSupabaseClient(supabaseUrl, supabasePublishableKey, {
    detectSessionInUrl: !isAdminAuthRoute,
  })
  : null;

const adminSupabaseClient = supabaseUrl && supabasePublishableKey
  ? createBrowserSupabaseClient(supabaseUrl, supabasePublishableKey, {
    detectSessionInUrl: isAdminAuthRoute,
    storageKey: `doongdoong-admin-${new URL(supabaseUrl).hostname}`,
    storage: adminSessionStorage,
  })
  : null;

const missingConfiguration = async (): Promise<never> => {
  throw new Error("Supabase 환경 설정이 필요합니다.");
};

const unavailableOceanGateway: OceanGateway = {
  getSnapshot: missingConfiguration,
  sendBottle: missingConfiguration,
  catchBottle: missingConfiguration,
  openBottle: missingConfiguration,
  resolveBottle: missingConfiguration,
  reportBottle: missingConfiguration,
  completeOnboarding: missingConfiguration,
  updateProfile: missingConfiguration,
  updateDefaultSignature: missingConfiguration,
  updateAppPreferences: missingConfiguration,
  updateSea: missingConfiguration,
  updateTimeZone: missingConfiguration,
  upsertPushSubscription: missingConfiguration,
  deletePushSubscription: missingConfiguration,
  updateNotificationPreferences: missingConfiguration,
  deleteAccount: missingConfiguration,
};

export const oceanGateway: OceanGateway = supabaseClient
  ? new SupabaseOceanGateway(supabaseClient)
  : unavailableOceanGateway;

export const adminGateway: AdminGateway | null = adminSupabaseClient
  ? new SupabaseAdminGateway(adminSupabaseClient)
  : null;
export const authGateway: AuthGateway | null = supabaseClient
  ? new SupabaseAuthGateway(supabaseClient)
  : null;
export const adminAuthGateway: AuthGateway | null = adminSupabaseClient
  ? new SupabaseAuthGateway(adminSupabaseClient)
  : null;
export const safetyProvider = new ConservativeLocalSafetyProvider();
export const translationProvider = new DisabledTranslationProvider();
