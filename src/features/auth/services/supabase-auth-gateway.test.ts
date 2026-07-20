import { afterEach, describe, expect, it, vi } from "vitest";
import { SupabaseAuthGateway } from "@/features/auth/services/supabase-auth-gateway";

describe("SupabaseAuthGateway", () => {
  afterEach(() => vi.unstubAllGlobals());

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
