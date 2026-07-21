import {
  createClient,
  type SupabaseClient,
  type SupportedStorage,
  type User,
} from "@supabase/supabase-js";
import { AuthenticationRequiredError } from "@/features/ocean/services/errors";

export { AuthenticationRequiredError } from "@/features/ocean/services/errors";

const sessionPromises = new WeakMap<SupabaseClient, Promise<User>>();

interface BrowserSupabaseClientOptions {
  detectSessionInUrl?: boolean;
  storageKey?: string;
  storage?: SupportedStorage;
}

export const createBrowserSupabaseClient = (
  url: string,
  publishableKey: string,
  options: BrowserSupabaseClientOptions = {},
): SupabaseClient =>
  createClient(url, publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: options.detectSessionInUrl ?? true,
      ...(options.storageKey ? { storageKey: options.storageKey } : {}),
      ...(options.storage ? { storage: options.storage } : {}),
    },
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
