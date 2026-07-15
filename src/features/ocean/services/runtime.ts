import { SupabaseAdminGateway } from "@/features/admin/services/supabase-admin-gateway";
import type { AdminGateway } from "@/features/admin/types/admin";
import { DemoOceanGateway } from "@/features/ocean/services/demo-ocean-gateway";
import { createBrowserSupabaseClient } from "@/features/ocean/services/supabase-client";
import { SupabaseOceanGateway } from "@/features/ocean/services/supabase-ocean-gateway";
import {
  ConservativeLocalSafetyProvider,
  DisabledTranslationProvider,
} from "@/features/ocean/services/safety-provider";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const supabaseClient = supabaseUrl && supabasePublishableKey
  ? createBrowserSupabaseClient(supabaseUrl, supabasePublishableKey)
  : null;

export const oceanGateway = supabaseClient
  ? new SupabaseOceanGateway(supabaseClient)
  : new DemoOceanGateway(window.localStorage);

export const adminGateway: AdminGateway | null = supabaseClient
  ? new SupabaseAdminGateway(supabaseClient)
  : null;
export const safetyProvider = new ConservativeLocalSafetyProvider();
export const translationProvider = new DisabledTranslationProvider();
