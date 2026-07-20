import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureSupabaseSession } from "@/features/ocean/services/supabase-client";
import type {
  AdminDashboard,
  AdminDashboardFilters,
  AdminAuthInfo,
  AdminGateway,
  AdminResetDirection,
} from "@/features/admin/types/admin";

export class SupabaseAdminGateway implements AdminGateway {
  constructor(private readonly client: SupabaseClient) {}

  async getAuthInfo(): Promise<AdminAuthInfo> {
    const user = await ensureSupabaseSession(this.client);
    return { userId: user.id };
  }

  async getDashboard(filters: AdminDashboardFilters = {}): Promise<AdminDashboard> {
    await ensureSupabaseSession(this.client);
    const query = filters.query?.trim() || null;
    const status = filters.status && filters.status !== "all" ? filters.status : null;
    const [dashboardResponse, usageResponse] = await Promise.all([
      this.client.rpc("admin_dashboard", {
        p_query: query,
        p_status: status,
        p_limit: 50,
      }),
      this.client.rpc("admin_service_usage"),
    ]);

    if (dashboardResponse.error) throw dashboardResponse.error;
    if (usageResponse.error) throw usageResponse.error;
    return {
      ...(dashboardResponse.data as Omit<AdminDashboard, "usage">),
      usage: usageResponse.data,
    } as AdminDashboard;
  }

  async resetUserLimits(userId: string, direction: AdminResetDirection): Promise<void> {
    await ensureSupabaseSession(this.client);
    const { error } = await this.client.rpc("admin_reset_user_limits", {
      p_target_user_id: userId,
      p_direction: direction,
    });
    if (error) throw error;
  }

  async makeMessageAvailable(messageId: string): Promise<void> {
    await ensureSupabaseSession(this.client);
    const { error } = await this.client.rpc("admin_make_message_available", {
      p_message_id: messageId,
    });
    if (error) throw error;
  }

  async deleteUser(userId: string): Promise<void> {
    await ensureSupabaseSession(this.client);
    const { error } = await this.client.rpc("admin_delete_user", {
      p_target_user_id: userId,
    });
    if (error) throw error;
  }

  async deleteMessage(messageId: string): Promise<void> {
    await ensureSupabaseSession(this.client);
    const { error } = await this.client.rpc("admin_delete_message", {
      p_message_id: messageId,
    });
    if (error) throw error;
  }
}
