import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

const sessionPromises = new WeakMap<SupabaseClient, Promise<User>>();

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

    const { data: signInData, error: signInError } = await client.auth.signInAnonymously();
    if (signInError) throw signInError;
    if (!signInData.user) throw new Error("익명 사용자 세션을 만들지 못했습니다.");
    return signInData.user;
  })().catch((error) => {
    sessionPromises.delete(client);
    throw error;
  });

  sessionPromises.set(client, sessionPromise);
  return sessionPromise;
};
