import { afterEach, describe, expect, it, vi } from "vitest";
import { SupabaseAuthGateway } from "@/features/auth/services/supabase-auth-gateway";

describe("SupabaseAuthGateway", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("validates the current user with the Auth server", async () => {
    const user = { id: "social-user" };
    const getUser = vi.fn().mockResolvedValue({ data: { user }, error: null });
    const gateway = new SupabaseAuthGateway({ auth: { getUser } } as never);

    await expect(gateway.getCurrentUser()).resolves.toEqual({ id: "social-user" });
    expect(getUser).toHaveBeenCalledOnce();
  });

  it("clears a deleted user's stale local session", async () => {
    const getUser = vi.fn().mockResolvedValue({
      data: { user: null },
      error: { status: 403 },
    });
    const signOut = vi.fn().mockResolvedValue({ error: null });
    const gateway = new SupabaseAuthGateway({ auth: { getUser, signOut } } as never);

    await expect(gateway.getCurrentUser()).resolves.toBeNull();
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it.each([
    ["google", "google"],
    ["apple", "apple"],
    ["naver", "custom:naver"],
  ] as const)("starts %s OAuth with the app base URL", async (provider, expectedProvider) => {
    const assign = vi.fn();
    vi.stubGlobal("window", {
      location: { origin: "https://sorryrlrud.github.io", assign },
    });
    const signInWithOAuth = vi.fn().mockResolvedValue({
      data: { url: `https://auth.example/${provider}` },
      error: null,
    });
    const gateway = new SupabaseAuthGateway({ auth: { signInWithOAuth } } as never);

    await gateway.signIn(provider);

    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: expectedProvider,
      options: {
        redirectTo: "https://sorryrlrud.github.io/",
        skipBrowserRedirect: true,
      },
    });
    expect(assign).toHaveBeenCalledWith(`https://auth.example/${provider}`);
  });

  it("signs out only the current browser session", async () => {
    const signOut = vi.fn().mockResolvedValue({ error: null });
    const gateway = new SupabaseAuthGateway({ auth: { signOut } } as never);

    await gateway.signOut();

    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
  });
});
