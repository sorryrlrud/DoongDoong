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

  it("uses the three-argument onboarding RPC until languages are deployed", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: null,
        error: {
          code: "PGRST202",
          message: "Could not find the function public.ocean_complete_onboarding(p_country_code, p_default_signature, p_sea_id)",
        },
      })
      .mockResolvedValueOnce({ data: snapshot, error: null });
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: "user-id" } } }, error: null }),
      },
      rpc,
    };
    const gateway = new SupabaseOceanGateway(client as never);

    await expect(gateway.completeOnboarding("KR", "pacific", "밤의 여행자", "ko")).resolves.toMatchObject({ seaId: "pacific" });
    expect(rpc).toHaveBeenNthCalledWith(1, "ocean_complete_onboarding", {
      p_country_code: "KR",
      p_sea_id: "pacific",
      p_default_signature: "밤의 여행자",
      p_language_code: "ko",
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "ocean_complete_onboarding", {
      p_country_code: "KR",
      p_sea_id: "pacific",
      p_default_signature: "밤의 여행자",
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
