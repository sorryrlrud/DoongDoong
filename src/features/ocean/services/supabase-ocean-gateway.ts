import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureSupabaseSession } from "@/features/ocean/services/supabase-client";
import {
  OceanError,
  type BottleDraft,
  type BottleResolution,
  type OceanGateway,
  type OceanSnapshot,
  type SeaId,
} from "@/features/ocean/types/ocean";

interface DatabaseBottleContent {
  id: string;
  body: string;
  dateLabel?: string | null;
  signature?: string | null;
  senderCountryCode?: string | null;
}

interface DatabaseSnapshot {
  seaId: SeaId;
  countryCode?: string | null;
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
      ? new Intl.DateTimeFormat("ko-KR", { dateStyle: "long" }).format(new Date())
      : null;

    return this.call("ocean_send_message", {
      p_body: draft.body,
      p_sea_id: draft.seaId,
      p_signature: draft.signature?.trim() || null,
      p_date_label: dateLabel,
    });
  }

  async catchBottle(): Promise<OceanSnapshot> {
    return this.call("ocean_catch_message");
  }

  async openBottle(id: string): Promise<OceanSnapshot> {
    return this.call("ocean_open_message", { p_message_id: id });
  }

  async resolveBottle(id: string, resolution: BottleResolution): Promise<OceanSnapshot> {
    return this.call("ocean_resolve_message", {
      p_message_id: id,
      p_resolution: resolution,
    });
  }

  async completeOnboarding(countryCode: string, seaId: SeaId): Promise<OceanSnapshot> {
    try {
      return await this.call("ocean_complete_onboarding", {
        p_country_code: countryCode,
        p_sea_id: seaId,
      });
    } catch (error) {
      // Keep the deployed app usable until the accompanying migration reaches Supabase.
      // The legacy RPC can still persist the selected sea; country metadata begins
      // syncing automatically for newly onboarded users once the migration is applied.
      if (!isMissingRpcFunction(error, "ocean_complete_onboarding")) throw error;
      return this.updateSea(seaId);
    }
  }

  async updateSea(seaId: SeaId): Promise<OceanSnapshot> {
    return this.call("ocean_update_sea", { p_sea_id: seaId });
  }

  private async call(functionName: string, args?: Record<string, unknown>): Promise<OceanSnapshot> {
    await ensureSupabaseSession(this.client);
    const { data, error } = await this.client.rpc(functionName, args);

    if (error) {
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
              }
            : undefined,
        }
      : null;

    return {
      seaId: snapshot.seaId,
      countryCode: snapshot.countryCode ?? undefined,
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
        keptAt: new Date(message.keptAt).getTime(),
        expiresAt: new Date(message.expiresAt).getTime(),
      })),
    };
  }
}
