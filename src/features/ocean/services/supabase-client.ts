import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

const sessionPromises = new WeakMap<SupabaseClient, Promise<User>>();

export class AuthenticationRequiredError extends Error {
  constructor() {
    super("소셜 로그인이 필요합니다.");
    this.name = "AuthenticationRequiredError";
  }
}

export const createBrowserSupabaseClient = (url: string, publishableKey: string): SupabaseClient =>
  createClient(url, publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

export const ensureSupabaseSession = async (client: SupabaseClient): Promise<User> => {
  const existingPromise = sessionPromises.get(client);
  if (existingPromise) return existingPromise;

  const sessionPromise = (async () => {
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    if (data.session?.user) return data.session.user;
    throw new AuthenticationRequiredError();
  })().catch((error) => {
    sessionPromises.delete(client);
    throw error;
  });

  sessionPromises.set(client, sessionPromise);
  return sessionPromise;
};

export const clearSupabaseSession = async (client: SupabaseClient): Promise<void> => {
  sessionPromises.delete(client);
  const { error } = await client.auth.signOut({ scope: "local" });
  if (error) throw error;
};
