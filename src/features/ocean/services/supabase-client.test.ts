import { describe, expect, it, vi } from "vitest";
import { ensureSupabaseSession } from "@/features/ocean/services/supabase-client";

describe("ensureSupabaseSession", () => {
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
