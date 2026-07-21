import { describe, expect, it, vi } from "vitest";
import { SupabaseOceanGateway } from "@/features/ocean/services/supabase-ocean-gateway";

const snapshot = {
  seaId: "pacific",
  languageCode: "ko",
  reduceMotion: false,
  autoIncludeDate: false,
  remainingSends: 2,
  nextCatchAt: null,
  bottleAvailable: false,
  activeBottle: null,
  keptBottles: [],
};

describe("SupabaseOceanGateway", () => {
  it("restores account state from a fresh browser snapshot", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        ...snapshot,
        countryCode: "KR",
        defaultSignature: "밤의 여행자",
        reduceMotion: true,
        autoIncludeDate: true,
        nextCatchAt: "2026-07-20T12:00:00.000Z",
        keptBottles: [{
          id: "00000000-0000-4000-8000-000000000002",
          body: "보관된 편지입니다.",
          keptAt: "2026-07-20T01:00:00.000Z",
          expiresAt: "2026-08-19T01:00:00.000Z",
        }],
      },
      error: null,
    });
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: "user-id" } } }, error: null }),
      },
      rpc,
    };
    const gateway = new SupabaseOceanGateway(client as never);

    await expect(gateway.getSnapshot()).resolves.toMatchObject({
      countryCode: "KR",
      defaultSignature: "밤의 여행자",
      reduceMotion: true,
      autoIncludeDate: true,
      nextCatchAt: Date.parse("2026-07-20T12:00:00.000Z"),
      keptBottles: [{
        id: "00000000-0000-4000-8000-000000000002",
        body: "보관된 편지입니다.",
      }],
    });
    expect(rpc).toHaveBeenCalledWith("ocean_snapshot", undefined);
  });

  it("preserves the selected language when only the legacy onboarding RPC is available", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: null,
        error: {
          code: "PGRST202",
          message: "Could not find the function public.ocean_complete_onboarding(p_country_code, p_default_signature, p_sea_id)",
        },
      })
      .mockResolvedValueOnce({ data: snapshot, error: null })
      .mockResolvedValueOnce({ data: { ...snapshot, languageCode: "en" }, error: null });
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: "user-id" } } }, error: null }),
      },
      rpc,
    };
    const gateway = new SupabaseOceanGateway(client as never);

    await expect(gateway.completeOnboarding("KR", "pacific", "밤의 여행자", "en")).resolves.toMatchObject({
      seaId: "pacific",
      languageCode: "en",
    });
    expect(rpc).toHaveBeenNthCalledWith(1, "ocean_complete_onboarding", {
      p_country_code: "KR",
      p_sea_id: "pacific",
      p_default_signature: "밤의 여행자",
      p_language_code: "en",
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "ocean_complete_onboarding", {
      p_country_code: "KR",
      p_sea_id: "pacific",
      p_default_signature: "밤의 여행자",
    });
    expect(rpc).toHaveBeenNthCalledWith(3, "ocean_update_profile", {
      p_country_code: "KR",
      p_language_code: "en",
    });
  });

  it("syncs the default signature for administrators", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: snapshot, error: null });
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: "user-id" } } }, error: null }),
      },
      rpc,
    };
    const gateway = new SupabaseOceanGateway(client as never);

    await gateway.updateDefaultSignature("  밤의 여행자  ");

    expect(rpc).toHaveBeenCalledWith("ocean_update_default_signature", {
      p_default_signature: "밤의 여행자",
    });
  });

  it("persists device-independent application preferences", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { ...snapshot, reduceMotion: true, autoIncludeDate: true },
      error: null,
    });
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: "user-id" } } }, error: null }),
      },
      rpc,
    };
    const gateway = new SupabaseOceanGateway(client as never);

    await expect(gateway.updateAppPreferences(true, true)).resolves.toMatchObject({
      reduceMotion: true,
      autoIncludeDate: true,
    });
    expect(rpc).toHaveBeenCalledWith("ocean_update_app_preferences", {
      p_reduce_motion: true,
      p_auto_include_date: true,
    });
  });

  it("persists the authenticated browser time zone through its dedicated RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: snapshot, error: null });
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: "user-id" } } }, error: null }),
      },
      rpc,
    };
    const gateway = new SupabaseOceanGateway(client as never);

    await expect(gateway.updateTimeZone("Asia/Seoul")).resolves.toMatchObject({
      seaId: "pacific",
    });
    expect(rpc).toHaveBeenCalledWith("ocean_update_time_zone", {
      p_time_zone: "Asia/Seoul",
    });
  });

  it("requests translation as soon as a bottle reaches its recipient", async () => {
    const delivered = {
      ...snapshot,
      activeBottle: {
        id: "00000000-0000-4000-8000-000000000001",
        opened: false,
        caughtAt: "2026-07-17T00:00:00.000Z",
      },
    };
    const invoke = vi.fn().mockResolvedValue({ data: { translated: true }, error: null });
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: "user-id" } } }, error: null }),
      },
      functions: { invoke },
      rpc: vi.fn().mockResolvedValue({ data: delivered, error: null }),
    };
    const gateway = new SupabaseOceanGateway(client as never);

    await gateway.catchBottle();

    expect(invoke).toHaveBeenCalledWith("translate-message", {
      body: { messageId: "00000000-0000-4000-8000-000000000001" },
    });
  });

  it("submits a bottle through the server-authoritative Edge Function", async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { snapshot }, error: null });
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: "user-id" } } }, error: null }),
      },
      functions: { invoke },
    };
    const gateway = new SupabaseOceanGateway(client as never);

    await gateway.sendBottle({
      body: "  A server-checked letter.  ",
      seaId: "pacific",
      signature: "  A quiet writer  ",
      includeDate: true,
    });

    expect(invoke).toHaveBeenCalledWith("send-message", {
      body: {
        body: "A server-checked letter.",
        seaId: "pacific",
        signature: "A quiet writer",
        includeDate: true,
      },
    });
  });

  it("uses the private report and Push RPC contracts", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: snapshot, error: null })
      .mockResolvedValueOnce({ data: { enabled: true, subscriptionActive: true }, error: null })
      .mockResolvedValueOnce({ data: { bottleArrivedEnabled: true }, error: null });
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: "user-id" } } }, error: null }),
      },
      rpc,
    };
    const gateway = new SupabaseOceanGateway(client as never);

    await gateway.reportBottle("message-id", "spam", true);
    await gateway.upsertPushSubscription({
      endpoint: "https://push.example/subscription",
      p256dh: "public-key",
      auth: "auth-secret",
      userAgent: "Browser",
    });
    await gateway.updateNotificationPreferences(true);

    expect(rpc).toHaveBeenNthCalledWith(1, "ocean_report_message", {
      p_message_id: "message-id",
      p_reason: "spam",
      p_block_author: true,
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "ocean_upsert_push_subscription", {
      p_endpoint: "https://push.example/subscription",
      p_p256dh: "public-key",
      p_auth: "auth-secret",
      p_user_agent: "Browser",
    });
    expect(rpc).toHaveBeenNthCalledWith(3, "ocean_update_notification_preferences", {
      p_bottle_arrived_enabled: true,
    });
  });

  it("deletes the account through its Edge Function and clears the local session", async () => {
    const signOut = vi.fn().mockResolvedValue({ error: null });
    const invoke = vi.fn().mockResolvedValue({ data: null, error: null });
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: "user-id" } } }, error: null }),
        signOut,
      },
      functions: { invoke },
    };
    const gateway = new SupabaseOceanGateway(client as never);

    await gateway.deleteAccount();

    expect(invoke).toHaveBeenCalledWith("delete-account", { body: { confirmation: "DELETE" } });
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("clears a deleted account and requires social login again", async () => {
    const getSession = vi.fn().mockResolvedValue({
      data: { session: { user: { id: "deleted-user" } } },
      error: null,
    });
    const signOut = vi.fn().mockResolvedValue({ error: null });
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "ACCOUNT_DELETED: 삭제된 계정입니다." },
    });
    const client = {
      auth: { getSession, signOut },
      rpc,
    };
    const gateway = new SupabaseOceanGateway(client as never);

    await expect(gateway.getSnapshot()).rejects.toMatchObject({
      name: "AuthenticationRequiredError",
    });
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(rpc).toHaveBeenCalledOnce();
  });
});
