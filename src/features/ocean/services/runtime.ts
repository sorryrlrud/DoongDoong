import { DemoOceanGateway } from "@/features/ocean/services/demo-ocean-gateway";
import {
  ConservativeLocalSafetyProvider,
  DisabledTranslationProvider,
} from "@/features/ocean/services/safety-provider";

export const oceanGateway = new DemoOceanGateway(window.localStorage);
export const safetyProvider = new ConservativeLocalSafetyProvider();
export const translationProvider = new DisabledTranslationProvider();
