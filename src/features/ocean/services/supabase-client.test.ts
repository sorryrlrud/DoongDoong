import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClient } = vi.hoisted(() => ({
  createClient: vi.fn(() => ({ auth: {} })),
}));

vi.mock("@supabase/supabase-js", () => ({ createClient }));

import {
  createBrowserSupabaseClient,
  ensureSupabaseSession,
} from "@/features/ocean/services/supabase-client";

describe("ensureSupabaseSession", () => {
  beforeEach(() => createClient.mockClear());

  it("can isolate an auth client with its own storage and callback handling", () => {
    createBrowserSupabaseClient("https://project.supabase.co", "publishable-key", {
      detectSessionInUrl: false,
      storageKey: "admin-session",
    });

    expect(createClient).toHaveBeenCalledWith(
      "https://project.supabase.co",
      "publishable-key",
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
          storageKey: "admin-session",
        },
      },
    );
  });

  it("returns an existing social session", async () => {
    const user = { id: "social-user" };
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: { user } }, error: null }),
      },
    };

    await expect(ensureSupabaseSession(client as never)).resolves.toBe(user);
  });

  it("never creates an anonymous account when signed out", async () => {
    const signInAnonymously = vi.fn();
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
        signInAnonymously,
      },
    };

    await expect(ensureSupabaseSession(client as never)).rejects.toMatchObject({
      name: "AuthenticationRequiredError",
    });
    expect(signInAnonymously).not.toHaveBeenCalled();
  });
});
