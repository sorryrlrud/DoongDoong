import { DemoOceanGateway } from "@/features/ocean/services/demo-ocean-gateway";
import { SupabaseOceanGateway } from "@/features/ocean/services/supabase-ocean-gateway";
import {
  ConservativeLocalSafetyProvider,
  DisabledTranslationProvider,
} from "@/features/ocean/services/safety-provider";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const oceanGateway = supabaseUrl && supabasePublishableKey
  ? new SupabaseOceanGateway(supabaseUrl, supabasePublishableKey)
  : new DemoOceanGateway(window.localStorage);
export const safetyProvider = new ConservativeLocalSafetyProvider();
export const translationProvider = new DisabledTranslationProvider();
