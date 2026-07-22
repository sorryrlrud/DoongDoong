import { afterEach, describe, expect, it, vi } from "vitest";
import { SupabaseAuthGateway } from "@/features/auth/services/supabase-auth-gateway";

describe("SupabaseAuthGateway", () => {
  afterEach(() => vi.unstubAllGlobals());

  const oauthCallbackWindow = (href: string, provider: "google" | "apple" | "naver" = "naver") => {
    const stored = new Map<string, string>([["doongdoong-pending-identity-link", provider]]);
    const location = {
      href,
      origin: new URL(href).origin,
      assign: vi.fn(),
    };
    const replaceState = vi.fn((_state: unknown, _title: string, nextUrl: string | URL | null) => {
      if (nextUrl) location.href = String(nextUrl);
    });
    vi.stubGlobal("window", {
      location,
      history: { state: null, replaceState },
      sessionStorage: {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => stored.set(key, value),
        removeItem: (key: string) => stored.delete(key),
      },
    });
    return { location, replaceState, stored };
  };

  it("validates the current user with the Auth server", async () => {
    const user = { id: "social-user", identities: [{ provider: "google" }], app_metadata: {} };
    const getSession = vi.fn().mockResolvedValue({
      data: { session: { user } },
      error: null,
    });
    const getUser = vi.fn().mockResolvedValue({ data: { user }, error: null });
    const gateway = new SupabaseAuthGateway({ auth: { getSession, getUser } } as never);

    await expect(gateway.getCurrentUser()).resolves.toEqual({ id: "social-user", providers: ["google"] });
    expect(getSession).toHaveBeenCalledOnce();
    expect(getUser).toHaveBeenCalledOnce();
  });

  it("recognizes a GitHub callback session that only includes app metadata providers", async () => {
    const user = {
      id: "github-admin",
      identities: [],
      app_metadata: { providers: ["github"] },
    };
    const getSession = vi.fn().mockResolvedValue({
      data: { session: { user } },
      error: null,
    });
    const getUser = vi.fn().mockResolvedValue({ data: { user }, error: null });
    const gateway = new SupabaseAuthGateway({ auth: { getSession, getUser } } as never);

    await expect(gateway.getCurrentUser()).resolves.toEqual({
      id: "github-admin",
      providers: ["github"],
    });
  });

  it("treats an absent local session as a normal signed-out state", async () => {
    const getSession = vi.fn().mockResolvedValue({ data: { session: null }, error: null });
    const getUser = vi.fn();
    const gateway = new SupabaseAuthGateway({ auth: { getSession, getUser } } as never);

    await expect(gateway.getCurrentUser()).resolves.toBeNull();
    expect(getUser).not.toHaveBeenCalled();
  });

  it("clears a deleted user's stale local session", async () => {
    const getSession = vi.fn().mockResolvedValue({
      data: { session: { user: { id: "deleted-user" } } },
      error: null,
    });
    const getUser = vi.fn().mockResolvedValue({
      data: { user: null },
      error: { status: 403 },
    });
    const signOut = vi.fn().mockResolvedValue({ error: null });
    const gateway = new SupabaseAuthGateway({ auth: { getSession, getUser, signOut } } as never);

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

  it.each([
    ["google", "google"],
    ["apple", "apple"],
    ["naver", "custom:naver"],
  ] as const)("links an additional %s identity and returns to settings", async (provider, expectedProvider) => {
    const assign = vi.fn();
    vi.stubGlobal("window", {
      location: { origin: "https://sorryrlrud.github.io", assign },
    });
    const linkIdentity = vi.fn().mockResolvedValue({
      data: { url: `https://auth.example/link/${provider}` },
      error: null,
    });
    const gateway = new SupabaseAuthGateway({ auth: { linkIdentity } } as never);

    await gateway.linkIdentity(provider);

    expect(linkIdentity).toHaveBeenCalledWith({
      provider: expectedProvider,
      options: {
        redirectTo: "https://sorryrlrud.github.io/#/settings",
        skipBrowserRedirect: true,
      },
    });
    expect(assign).toHaveBeenCalledWith(`https://auth.example/link/${provider}`);
  });

  it("consumes an identity collision returned in the OAuth fragment", () => {
    const browser = oauthCallbackWindow(
      "https://sorryrlrud.github.io/DoongDoong/#error=server_error&error_code=identity_already_exists&error_description=linked",
    );
    const gateway = new SupabaseAuthGateway({} as never);

    expect(gateway.consumeIdentityLinkConflict()).toBe("naver");
    expect(browser.stored.has("doongdoong-pending-identity-link")).toBe(false);
    expect(browser.location.href).toBe("https://sorryrlrud.github.io/DoongDoong/#/settings");
    expect(browser.replaceState).toHaveBeenCalledOnce();
  });

  it("consumes an identity collision returned in the OAuth query", () => {
    const browser = oauthCallbackWindow(
      "https://sorryrlrud.github.io/DoongDoong/?error=server_error&error_code=identity_already_exists&error_description=linked#/settings",
    );
    const gateway = new SupabaseAuthGateway({} as never);

    expect(gateway.consumeIdentityLinkConflict()).toBe("naver");
    expect(browser.location.href).toBe("https://sorryrlrud.github.io/DoongDoong/#/settings");
  });

  it("signs out only the current browser session", async () => {
    const signOut = vi.fn().mockResolvedValue({ error: null });
    const gateway = new SupabaseAuthGateway({ auth: { signOut } } as never);

    await gateway.signOut();

    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("starts GitHub OAuth with the admin return URL", async () => {
    const assign = vi.fn();
    vi.stubGlobal("window", {
      location: { origin: "https://sorryrlrud.github.io", assign },
    });
    const signInWithOAuth = vi.fn().mockResolvedValue({
      data: { url: "https://auth.example/github" },
      error: null,
    });
    const gateway = new SupabaseAuthGateway({ auth: { signInWithOAuth } } as never);

    await gateway.signInAdmin();

    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: "github",
      options: {
        redirectTo: "https://sorryrlrud.github.io/?admin=1",
        skipBrowserRedirect: true,
      },
    });
  });
});
