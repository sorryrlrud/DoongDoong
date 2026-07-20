import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AuthenticationRequiredError,
  clearSupabaseSession,
  ensureSupabaseSession,
} from "@/features/ocean/services/supabase-client";
import {
  OceanError,
  type BottleDraft,
  type BottleResolution,
  type OceanGateway,
  type OceanSnapshot,
  type SeaId,
} from "@/features/ocean/types/ocean";
import { localeForLanguage, normalizeLanguageCode, type LanguageCode } from "@/i18n/languages";

interface DatabaseBottleContent {
  id: string;
  body: string;
  dateLabel?: string | null;
  signature?: string | null;
  senderCountryCode?: string | null;
  sourceLanguage?: string | null;
  displayLanguage?: string | null;
  isTranslated?: boolean | null;
}

interface DatabaseSnapshot {
  seaId: SeaId;
  countryCode?: string | null;
  languageCode?: string | null;
  defaultSignature?: string | null;
  reduceMotion?: boolean | null;
  autoIncludeDate?: boolean | null;
  remainingSends: number;
  nextCatchAt: string | null;
  bottleAvailable: boolean;
  waitingForNews?: boolean;
  activeBottle: (DatabaseBottleContent & {
    opened: boolean;
    caughtAt: string;
  }) | null;
  keptBottles: Array<DatabaseBottleContent & {
    keptAt: string;
    expiresAt: string;
  }>;
}

const ERROR_CODES = [
  "COOLDOWN",
  "DAILY_LIMIT",
  "NO_BOTTLE",
  "BOTTLE_GONE",
  "ACTIVE_BOTTLE",
  "ADMIN_ACCOUNT",
  "INVALID_DRAFT",
] as const;

const isMissingRpcFunction = (error: unknown, functionName: string): boolean =>
  typeof error === "object"
  && error !== null
  && "code" in error
  && "message" in error
  && error.code === "PGRST202"
  && typeof error.message === "string"
  && error.message.includes(`public.${functionName}`);

export class SupabaseOceanGateway implements OceanGateway {
  constructor(private readonly client: SupabaseClient) {}

  async getSnapshot(): Promise<OceanSnapshot> {
    return this.call("ocean_snapshot");
  }

  async sendBottle(draft: BottleDraft): Promise<OceanSnapshot> {
    const dateLabel = draft.includeDate
      ? new Intl.DateTimeFormat(localeForLanguage(draft.languageCode), { dateStyle: "long" }).format(new Date())
      : null;

    return this.call("ocean_send_message", {
      p_body: draft.body,
      p_sea_id: draft.seaId,
      p_signature: draft.signature?.trim() || null,
      p_date_label: dateLabel,
    });
  }

  async catchBottle(): Promise<OceanSnapshot> {
    const snapshot = await this.call("ocean_catch_message");
    if (snapshot.activeBottle) await this.ensureTranslation(snapshot.activeBottle.id);
    return snapshot;
  }

  async openBottle(id: string): Promise<OceanSnapshot> {
    await this.ensureTranslation(id);
    return this.call("ocean_open_message", { p_message_id: id });
  }

  async resolveBottle(id: string, resolution: BottleResolution): Promise<OceanSnapshot> {
    return this.call("ocean_resolve_message", {
      p_message_id: id,
      p_resolution: resolution,
    });
  }

  async completeOnboarding(
    countryCode: string,
    seaId: SeaId,
    defaultSignature: string,
    languageCode: LanguageCode,
  ): Promise<OceanSnapshot> {
    try {
      return await this.call("ocean_complete_onboarding", {
        p_country_code: countryCode,
        p_sea_id: seaId,
        p_default_signature: defaultSignature.trim() || null,
        p_language_code: languageCode,
      });
    } catch (error) {
      // Keep the deployed app usable until the accompanying migration reaches Supabase.
      // The legacy RPC can still persist the selected sea; country metadata begins
      // syncing automatically for newly onboarded users once the migration is applied.
      if (!isMissingRpcFunction(error, "ocean_complete_onboarding")) throw error;
      return this.call("ocean_complete_onboarding", {
        p_country_code: countryCode,
        p_sea_id: seaId,
        p_default_signature: defaultSignature.trim() || null,
      });
    }
  }

  async updateProfile(countryCode: string, languageCode: LanguageCode): Promise<OceanSnapshot> {
    const snapshot = await this.call("ocean_update_profile", {
      p_country_code: countryCode,
      p_language_code: languageCode,
    });
    const messageIds = [
      snapshot.activeBottle?.id,
      ...snapshot.keptBottles.map((bottle) => bottle.id),
    ].filter((messageId): messageId is string => Boolean(messageId));
    await Promise.all(messageIds.map((messageId) => this.ensureTranslation(messageId)));
    return messageIds.length > 0 ? this.getSnapshot() : snapshot;
  }

  async updateDefaultSignature(defaultSignature: string): Promise<OceanSnapshot> {
    return this.call("ocean_update_default_signature", {
      p_default_signature: defaultSignature.trim() || null,
    });
  }

  async updateAppPreferences(
    reduceMotion: boolean,
    autoIncludeDate: boolean,
  ): Promise<OceanSnapshot> {
    return this.call("ocean_update_app_preferences", {
      p_reduce_motion: reduceMotion,
      p_auto_include_date: autoIncludeDate,
    });
  }

  async updateSea(seaId: SeaId): Promise<OceanSnapshot> {
    return this.call("ocean_update_sea", { p_sea_id: seaId });
  }

  private async ensureTranslation(messageId: string): Promise<void> {
    try {
      await ensureSupabaseSession(this.client);
      const { error } = await this.client.functions.invoke("translate-message", {
        body: { messageId },
      });
      if (error) throw error;
    } catch {
      // Translation is an enhancement: the immutable original remains readable
      // if Azure or the edge function is temporarily unavailable.
    }
  }

  private async call(
    functionName: string,
    args?: Record<string, unknown>,
  ): Promise<OceanSnapshot> {
    await ensureSupabaseSession(this.client);
    const { data, error } = await this.client.rpc(functionName, args);

    if (error) {
      if (
        error.message.includes("ACCOUNT_DELETED")
        || error.message.includes("SOCIAL_AUTH_REQUIRED")
      ) {
        await clearSupabaseSession(this.client);
        throw new AuthenticationRequiredError();
      }
      const code = ERROR_CODES.find((candidate) => error.message.includes(candidate));
      if (code) throw new OceanError(code, error.message.replace(`${code}:`, "").trim());
      throw error;
    }

    return this.toSnapshot(data as DatabaseSnapshot);
  }

  private toSnapshot(snapshot: DatabaseSnapshot): OceanSnapshot {
    const activeBottle = snapshot.activeBottle
      ? {
          id: snapshot.activeBottle.id,
          opened: snapshot.activeBottle.opened,
          caughtAt: new Date(snapshot.activeBottle.caughtAt).getTime(),
          content: snapshot.activeBottle.opened
            ? {
                id: snapshot.activeBottle.id,
                body: snapshot.activeBottle.body,
                dateLabel: snapshot.activeBottle.dateLabel ?? undefined,
                signature: snapshot.activeBottle.signature ?? undefined,
                senderCountryCode: snapshot.activeBottle.senderCountryCode ?? undefined,
                sourceLanguage: snapshot.activeBottle.sourceLanguage
                  ? normalizeLanguageCode(snapshot.activeBottle.sourceLanguage)
                  : undefined,
                displayLanguage: snapshot.activeBottle.displayLanguage
                  ? normalizeLanguageCode(snapshot.activeBottle.displayLanguage)
                  : undefined,
                isTranslated: snapshot.activeBottle.isTranslated ?? false,
              }
            : undefined,
        }
      : null;

    return {
      seaId: snapshot.seaId,
      countryCode: snapshot.countryCode ?? undefined,
      languageCode: normalizeLanguageCode(snapshot.languageCode),
      defaultSignature: snapshot.defaultSignature ?? "",
      reduceMotion: snapshot.reduceMotion ?? false,
      autoIncludeDate: snapshot.autoIncludeDate ?? false,
      remainingSends: snapshot.remainingSends,
      nextCatchAt: snapshot.nextCatchAt ? new Date(snapshot.nextCatchAt).getTime() : null,
      bottleAvailable: snapshot.bottleAvailable,
      waitingForNews: snapshot.waitingForNews ?? false,
      activeBottle,
      keptBottles: snapshot.keptBottles.map((message) => ({
        id: message.id,
        body: message.body,
        dateLabel: message.dateLabel ?? undefined,
        signature: message.signature ?? undefined,
        senderCountryCode: message.senderCountryCode ?? undefined,
        sourceLanguage: message.sourceLanguage ? normalizeLanguageCode(message.sourceLanguage) : undefined,
        displayLanguage: message.displayLanguage ? normalizeLanguageCode(message.displayLanguage) : undefined,
        isTranslated: message.isTranslated ?? false,
        keptAt: new Date(message.keptAt).getTime(),
        expiresAt: new Date(message.expiresAt).getTime(),
      })),
    };
  }
}
