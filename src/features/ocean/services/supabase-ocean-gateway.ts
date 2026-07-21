import type { SupabaseClient } from "@supabase/supabase-js";
import {
  clearSupabaseSession,
  ensureSupabaseSession,
} from "@/features/ocean/services/supabase-client";
import { AuthenticationRequiredError } from "@/features/ocean/services/errors";
import {
  OceanError,
  type BottleDraft,
  type BottleResolution,
  type NotificationPreferences,
  type OceanErrorCode,
  type OceanGateway,
  type OceanSnapshot,
  type PushSubscriptionInput,
  type ReportReason,
  type SeaId,
} from "@/features/ocean/types/ocean";
import { normalizeLanguageCode, type LanguageCode } from "@/i18n/languages";

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
  bottleArrivedEnabled?: boolean | null;
  activeBottle: (DatabaseBottleContent & {
    opened: boolean;
    caughtAt: string;
  }) | null;
  keptBottles: Array<DatabaseBottleContent & {
    keptAt: string;
    expiresAt: string;
  }>;
}

interface EdgeErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
    retryable?: boolean;
    requestId?: string;
  };
}

const ERROR_CODES = [
  "COOLDOWN",
  "DAILY_LIMIT",
  "NO_BOTTLE",
  "BOTTLE_GONE",
  "ACTIVE_BOTTLE",
  "ADMIN_ACCOUNT",
  "INVALID_DRAFT",
  "AUTH_REQUIRED",
  "ACCOUNT_INACTIVE",
  "CONTENT_REJECTED",
  "RATE_LIMITED",
  "MODERATION_UNAVAILABLE",
  "CONFIRMATION_REQUIRED",
  "ACCOUNT_DELETE_IN_PROGRESS",
  "ACCOUNT_DELETE_FAILED",
  "MESSAGE_NOT_OWNED",
  "INVALID_REPORT_REASON",
  "REPORT_ALREADY_EXISTS",
] as const satisfies readonly OceanErrorCode[];

const isMissingRpcFunction = (error: unknown, functionName: string): boolean =>
  typeof error === "object"
  && error !== null
  && "code" in error
  && "message" in error
  && error.code === "PGRST202"
  && typeof error.message === "string"
  && error.message.includes(`public.${functionName}`);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const messageFromUnknownError = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (isRecord(error) && typeof error.message === "string") return error.message;
  return "The request could not be completed.";
};

const asEdgeEnvelope = (value: unknown): EdgeErrorEnvelope | null => {
  if (!isRecord(value) || !isRecord(value.error)) return null;
  return {
    error: {
      code: typeof value.error.code === "string" ? value.error.code : undefined,
      message: typeof value.error.message === "string" ? value.error.message : undefined,
      retryable: typeof value.error.retryable === "boolean" ? value.error.retryable : undefined,
      requestId: typeof value.error.requestId === "string" ? value.error.requestId : undefined,
    },
  };
};

const readEdgeErrorEnvelope = async (error: unknown): Promise<EdgeErrorEnvelope | null> => {
  if (!isRecord(error) || !("context" in error)) return null;
  const context = error.context;
  if (!isRecord(context) || typeof context.json !== "function") return null;

  try {
    const response = typeof context.clone === "function" ? context.clone() : context;
    return asEdgeEnvelope(await response.json());
  } catch {
    return null;
  }
};

export class SupabaseOceanGateway implements OceanGateway {
  constructor(private readonly client: SupabaseClient) {}

  async getSnapshot(): Promise<OceanSnapshot> {
    return this.call("ocean_snapshot");
  }

  async sendBottle(draft: BottleDraft): Promise<OceanSnapshot> {
    const payload = await this.invokeEdge<{ snapshot?: DatabaseSnapshot }>("send-message", {
      body: draft.body.trim(),
      seaId: draft.seaId,
      signature: draft.signature?.trim() || undefined,
      includeDate: draft.includeDate,
    });

    if (!payload.snapshot) throw new Error("The send-message response did not include a snapshot.");
    return this.toSnapshot(payload.snapshot);
  }

  /**
   * Kept only for the short rollout compatibility window. New clients never
   * claim from a global pool; they simply open their server-assigned bottle.
   */
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

  async reportBottle(id: string, reason: ReportReason, blockAuthor: boolean): Promise<OceanSnapshot> {
    return this.call("ocean_report_message", {
      p_message_id: id,
      p_reason: reason,
      p_block_author: blockAuthor,
    });
  }

  async completeOnboarding(
    countryCode: string,
    seaId: SeaId,
    defaultSignature: string,
    languageCode: LanguageCode,
  ): Promise<OceanSnapshot> {
    try {
      const snapshot = await this.call("ocean_complete_onboarding", {
        p_country_code: countryCode,
        p_sea_id: seaId,
        p_default_signature: defaultSignature.trim() || null,
        p_language_code: languageCode,
      });
      return this.ensureOnboardingLanguage(snapshot, countryCode, languageCode);
    } catch (error) {
      // A stale PostgREST schema cache can expose the legacy three-argument
      // function briefly. Finish onboarding, then explicitly persist the locale
      // if the profile endpoint is already available.
      if (!isMissingRpcFunction(error, "ocean_complete_onboarding")) throw error;
      const snapshot = await this.call("ocean_complete_onboarding", {
        p_country_code: countryCode,
        p_sea_id: seaId,
        p_default_signature: defaultSignature.trim() || null,
      });
      return this.ensureOnboardingLanguage(snapshot, countryCode, languageCode);
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

  async updateTimeZone(timeZone: string): Promise<OceanSnapshot> {
    return this.call("ocean_update_time_zone", { p_time_zone: timeZone });
  }

  async upsertPushSubscription(subscription: PushSubscriptionInput): Promise<{
    enabled: boolean;
    subscriptionActive: boolean;
  }> {
    return this.callData("ocean_upsert_push_subscription", {
      p_endpoint: subscription.endpoint,
      p_p256dh: subscription.p256dh,
      p_auth: subscription.auth,
      p_user_agent: subscription.userAgent ?? null,
    });
  }

  async deletePushSubscription(endpoint: string): Promise<{ subscriptionActive: boolean }> {
    return this.callData("ocean_delete_push_subscription", { p_endpoint: endpoint });
  }

  async updateNotificationPreferences(enabled: boolean): Promise<NotificationPreferences> {
    return this.callData("ocean_update_notification_preferences", {
      p_bottle_arrived_enabled: enabled,
    });
  }

  async deleteAccount(): Promise<void> {
    await this.invokeEdge<unknown>("delete-account", { confirmation: "DELETE" });
    // The authenticated Edge Function has already committed the deletion. A
    // local sign-out is best effort so a browser storage failure cannot turn a
    // successful deletion into a misleading client-side error.
    await clearSupabaseSession(this.client).catch(() => undefined);
  }

  private async ensureOnboardingLanguage(
    snapshot: OceanSnapshot,
    countryCode: string,
    languageCode: LanguageCode,
  ): Promise<OceanSnapshot> {
    if (snapshot.languageCode === languageCode) return snapshot;

    try {
      return await this.updateProfile(countryCode, languageCode);
    } catch (error) {
      // Preserve the just-selected locale for the current experience when an
      // older backend has neither language-aware profile endpoint nor RPC.
      if (!isMissingRpcFunction(error, "ocean_update_profile")) throw error;
      return { ...snapshot, languageCode };
    }
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

  private async invokeEdge<T>(functionName: string, body: Record<string, unknown>): Promise<T> {
    await ensureSupabaseSession(this.client);
    const { data, error } = await this.client.functions.invoke(functionName, { body });
    if (error) throw await this.toOperationError(error);
    return data as T;
  }

  private async call(
    functionName: string,
    args?: Record<string, unknown>,
  ): Promise<OceanSnapshot> {
    return this.toSnapshot(await this.callData<DatabaseSnapshot>(functionName, args));
  }

  private async callData<T>(functionName: string, args?: Record<string, unknown>): Promise<T> {
    await ensureSupabaseSession(this.client);
    const { data, error } = await this.client.rpc(functionName, args);
    if (error) throw await this.toOperationError(error);
    return data as T;
  }

  private async toOperationError(error: unknown): Promise<Error> {
    const envelope = await readEdgeErrorEnvelope(error);
    const code = envelope?.error?.code
      ?? ERROR_CODES.find((candidate) => messageFromUnknownError(error).includes(candidate));
    const message = envelope?.error?.message ?? messageFromUnknownError(error);

    if (code === "AUTH_REQUIRED" || message.includes("ACCOUNT_DELETED") || message.includes("SOCIAL_AUTH_REQUIRED")) {
      await clearSupabaseSession(this.client).catch(() => undefined);
      return new AuthenticationRequiredError();
    }
    if (code && (ERROR_CODES as readonly string[]).includes(code)) {
      return new OceanError(code as OceanErrorCode, message);
    }
    if (error instanceof Error) return error;
    const wrapped = new Error(message);
    if (isRecord(error) && typeof error.code === "string") {
      Object.assign(wrapped, { code: error.code });
    }
    return wrapped;
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
      bottleArrivedEnabled: typeof snapshot.bottleArrivedEnabled === "boolean"
        ? snapshot.bottleArrivedEnabled
        : undefined,
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
