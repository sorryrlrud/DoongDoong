import { describe, expect, it, vi } from "vitest";
import { SupabaseOceanGateway } from "@/features/ocean/services/supabase-ocean-gateway";

const snapshot = {
  seaId: "pacific",
  remainingSends: 2,
  nextCatchAt: null,
  bottleAvailable: false,
  activeBottle: null,
  keptBottles: [],
};

describe("SupabaseOceanGateway", () => {
  it("uses the legacy sea RPC when the country onboarding migration is not deployed yet", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: null,
        error: {
          code: "PGRST202",
          message: "Could not find the function public.ocean_complete_onboarding(p_country_code, p_sea_id)",
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

    await expect(gateway.completeOnboarding("KR", "pacific")).resolves.toMatchObject({ seaId: "pacific" });
    expect(rpc).toHaveBeenNthCalledWith(1, "ocean_complete_onboarding", {
      p_country_code: "KR",
      p_sea_id: "pacific",
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "ocean_update_sea", { p_sea_id: "pacific" });
  });

  it("starts a new anonymous session when an administrator deleted the current account", async () => {
    const getSession = vi
      .fn()
      .mockResolvedValueOnce({ data: { session: { user: { id: "deleted-user" } } }, error: null })
      .mockResolvedValueOnce({ data: { session: null }, error: null });
    const signOut = vi.fn().mockResolvedValue({ error: null });
    const signInAnonymously = vi.fn().mockResolvedValue({
      data: { user: { id: "new-user" } },
      error: null,
    });
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: null,
        error: { message: "ACCOUNT_DELETED: 삭제된 계정입니다." },
      })
      .mockResolvedValueOnce({ data: { ...snapshot, countryCode: null }, error: null });
    const client = {
      auth: { getSession, signOut, signInAnonymously },
      rpc,
    };
    const gateway = new SupabaseOceanGateway(client as never);

    await expect(gateway.getSnapshot()).resolves.toMatchObject({
      seaId: "pacific",
      countryCode: undefined,
    });
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(signInAnonymously).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
