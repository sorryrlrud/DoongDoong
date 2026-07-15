import { createClient, type SupabaseClient } from "@supabase/supabase-js";
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
}

interface DatabaseSnapshot {
  seaId: SeaId;
  remainingSends: number;
  nextCatchAt: string | null;
  bottleAvailable: boolean;
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
  "INVALID_DRAFT",
] as const;

export class SupabaseOceanGateway implements OceanGateway {
  private readonly client: SupabaseClient;
  private authPromise: Promise<void> | null = null;

  constructor(url: string, publishableKey: string) {
    this.client = createClient(url, publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }

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

  async updateSea(seaId: SeaId): Promise<OceanSnapshot> {
    return this.call("ocean_update_sea", { p_sea_id: seaId });
  }

  async resetDemo(): Promise<OceanSnapshot> {
    return this.getSnapshot();
  }

  private async ensureAuthenticated(): Promise<void> {
    if (!this.authPromise) {
      this.authPromise = (async () => {
        const { data, error } = await this.client.auth.getSession();
        if (error) throw error;
        if (data.session) return;

        const { error: signInError } = await this.client.auth.signInAnonymously();
        if (signInError) throw signInError;
      })().catch((error) => {
        this.authPromise = null;
        throw error;
      });
    }

    await this.authPromise;
  }

  private async call(functionName: string, args?: Record<string, unknown>): Promise<OceanSnapshot> {
    await this.ensureAuthenticated();
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
              }
            : undefined,
        }
      : null;

    return {
      seaId: snapshot.seaId,
      remainingSends: snapshot.remainingSends,
      nextCatchAt: snapshot.nextCatchAt ? new Date(snapshot.nextCatchAt).getTime() : null,
      bottleAvailable: snapshot.bottleAvailable,
      activeBottle,
      keptBottles: snapshot.keptBottles.map((message) => ({
        id: message.id,
        body: message.body,
        dateLabel: message.dateLabel ?? undefined,
        signature: message.signature ?? undefined,
        keptAt: new Date(message.keptAt).getTime(),
        expiresAt: new Date(message.expiresAt).getTime(),
      })),
      isDemo: false,
    };
  }
}
