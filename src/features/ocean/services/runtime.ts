import { SupabaseAdminGateway } from "@/features/admin/services/supabase-admin-gateway";
import type { AdminGateway } from "@/features/admin/types/admin";
import { createBrowserSupabaseClient } from "@/features/ocean/services/supabase-client";
import { SupabaseOceanGateway } from "@/features/ocean/services/supabase-ocean-gateway";
import type { OceanGateway } from "@/features/ocean/types/ocean";
import {
  ConservativeLocalSafetyProvider,
  DisabledTranslationProvider,
} from "@/features/ocean/services/safety-provider";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const supabaseClient = supabaseUrl && supabasePublishableKey
  ? createBrowserSupabaseClient(supabaseUrl, supabasePublishableKey)
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
  completeOnboarding: missingConfiguration,
  updateDefaultSignature: missingConfiguration,
  updateSea: missingConfiguration,
};

export const oceanGateway: OceanGateway = supabaseClient
  ? new SupabaseOceanGateway(supabaseClient)
  : unavailableOceanGateway;

export const adminGateway: AdminGateway | null = supabaseClient
  ? new SupabaseAdminGateway(supabaseClient)
  : null;
export const safetyProvider = new ConservativeLocalSafetyProvider();
export const translationProvider = new DisabledTranslationProvider();
