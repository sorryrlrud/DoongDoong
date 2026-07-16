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

  it("keeps an administrator signed in while resetting the demo cooldowns", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({
      data: null,
      error: {
        message: "ADMIN_ACCOUNT: 관리자 계정은 데모 초기화로 삭제할 수 없어요.",
      },
      })
      .mockResolvedValueOnce({ data: null, error: null });
    const signOut = vi.fn().mockResolvedValue({ error: null });
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: "admin-id" } } }, error: null }),
        signOut,
      },
      rpc,
    };
    const gateway = new SupabaseOceanGateway(client as never);

    await expect(gateway.resetDemoUser()).resolves.toBeUndefined();
    expect(rpc).toHaveBeenNthCalledWith(1, "ocean_reset_demo_user");
    expect(rpc).toHaveBeenNthCalledWith(2, "ocean_reset_admin_demo_cooldowns");
    expect(signOut).not.toHaveBeenCalled();
  });
});
