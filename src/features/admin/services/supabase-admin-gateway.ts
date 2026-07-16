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
    return {
      userId: user.id,
      hasGitHubIdentity: user.identities?.some((identity) => identity.provider === "github") ?? false,
    };
  }

  async beginGitHubLogin(): Promise<void> {
    const redirectUrl = new URL(window.location.href);
    redirectUrl.hash = "";
    redirectUrl.searchParams.set("admin", "1");
    const redirectTo = redirectUrl.toString();
    const options = { redirectTo, skipBrowserRedirect: true };
    const { error: signOutError } = await this.client.auth.signOut({ scope: "local" });
    if (signOutError) throw signOutError;
    const response = await this.client.auth.signInWithOAuth({ provider: "github", options });

    if (response.error) throw response.error;
    if (!response.data.url) throw new Error("GitHub 로그인 주소를 만들지 못했습니다.");
    window.location.assign(response.data.url);
  }

  async getDashboard(filters: AdminDashboardFilters = {}): Promise<AdminDashboard> {
    await ensureSupabaseSession(this.client);
    const query = filters.query?.trim() || null;
    const status = filters.status && filters.status !== "all" ? filters.status : null;
    const { data, error } = await this.client.rpc("admin_dashboard", {
      p_query: query,
      p_status: status,
      p_limit: 50,
    });

    if (error) throw error;
    return data as AdminDashboard;
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
}
