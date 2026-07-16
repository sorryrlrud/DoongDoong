import { describe, expect, it, vi } from "vitest";
import { SupabaseAdminGateway } from "@/features/admin/services/supabase-admin-gateway";

const createClient = () => {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
  const client = {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { user: { id: "admin-id", identities: [] } } },
        error: null,
      }),
    },
    rpc,
  };
  return { client, rpc };
};

describe("SupabaseAdminGateway", () => {
  it("calls the scoped reset RPC", async () => {
    const { client, rpc } = createClient();
    const gateway = new SupabaseAdminGateway(client as never);

    await gateway.resetUserLimits("user-id", "receive");

    expect(rpc).toHaveBeenCalledWith("admin_reset_user_limits", {
      p_target_user_id: "user-id",
      p_direction: "receive",
    });
  });

  it("calls the message availability RPC", async () => {
    const { client, rpc } = createClient();
    const gateway = new SupabaseAdminGateway(client as never);

    await gateway.makeMessageAvailable("message-id");

    expect(rpc).toHaveBeenCalledWith("admin_make_message_available", {
      p_message_id: "message-id",
    });
  });

  it("calls the user deletion RPC", async () => {
    const { client, rpc } = createClient();
    const gateway = new SupabaseAdminGateway(client as never);

    await gateway.deleteUser("user-id");

    expect(rpc).toHaveBeenCalledWith("admin_delete_user", {
      p_target_user_id: "user-id",
    });
  });
});
