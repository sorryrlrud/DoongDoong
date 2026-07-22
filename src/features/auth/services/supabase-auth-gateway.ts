import type { Provider, SupabaseClient, User } from "@supabase/supabase-js";
import type {
  AccountMergePreview,
  AuthGateway,
  AuthUser,
  SocialAuthProvider,
} from "@/features/auth/types/auth";
import { clearSupabaseSession } from "@/features/ocean/services/supabase-client";

const PENDING_IDENTITY_LINK_KEY = "doongdoong-pending-identity-link";
const PENDING_ACCOUNT_MERGE_KEY = "doongdoong-pending-account-merge";

const PROVIDERS: Record<SocialAuthProvider, Provider> = {
  google: "google",
  apple: "apple",
  naver: "custom:naver",
};

const toAuthUser = (user: User | null): AuthUser | null => {
  if (!user) return null;

  const appMetadataProviders = Array.isArray(user.app_metadata.providers)
    ? user.app_metadata.providers.filter((provider): provider is string => typeof provider === "string")
    : [];

  return {
    id: user.id,
    providers: [...new Set([
      ...(user.identities ?? []).map((identity) => identity.provider),
      ...appMetadataProviders,
      ...(typeof user.app_metadata.provider === "string" ? [user.app_metadata.provider] : []),
    ])],
  };
};

const authRedirectUrl = (): string =>
  new URL(import.meta.env.BASE_URL, window.location.origin).toString();

const identityLinkRedirectUrl = (): string => {
  const redirectUrl = new URL(import.meta.env.BASE_URL, window.location.origin);
  redirectUrl.hash = "/settings";
  return redirectUrl.toString();
};

const browserSessionStorage = (): Storage | null => {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

const readStoredProvider = (key: string): SocialAuthProvider | null => {
  const value = browserSessionStorage()?.getItem(key);
  return value === "google" || value === "apple" || value === "naver" ? value : null;
};

const removeOAuthErrorFromUrl = () => {
  const url = new URL(window.location.href);
  ["error", "error_code", "error_description"].forEach((key) => url.searchParams.delete(key));
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
  const hasOAuthError = ["error", "error_code", "error_description"].some((key) => fragment.has(key));
  if (hasOAuthError) url.hash = "/settings";
  window.history.replaceState(window.history.state, "", url.toString());
};

const oauthErrorCode = (): string | null => {
  const url = new URL(window.location.href);
  const fromSearch = url.searchParams.get("error_code");
  if (fromSearch) return fromSearch;
  return new URLSearchParams(url.hash.replace(/^#/, "")).get("error_code");
};

export class SupabaseAuthGateway implements AuthGateway {
  constructor(private readonly client: SupabaseClient) {}

  async getCurrentUser(): Promise<AuthUser | null> {
    const { data: sessionData, error: sessionError } = await this.client.auth.getSession();
    if (sessionError) throw sessionError;
    if (!sessionData.session) return null;

    const { data, error } = await this.client.auth.getUser();
    if (error) {
      if ([401, 403, 404].includes(error.status ?? 0)) {
        await clearSupabaseSession(this.client);
        return null;
      }
      throw error;
    }
    const authUser = toAuthUser(data.user);
    const pendingProvider = readStoredProvider(PENDING_IDENTITY_LINK_KEY);
    if (pendingProvider && authUser?.providers.includes(PROVIDERS[pendingProvider])) {
      browserSessionStorage()?.removeItem(PENDING_IDENTITY_LINK_KEY);
    }
    return authUser;
  }

  onAuthStateChange(listener: (user: AuthUser | null) => void): () => void {
    const { data } = this.client.auth.onAuthStateChange((_event, session) => {
      listener(toAuthUser(session?.user ?? null));
    });
    return () => data.subscription.unsubscribe();
  }

  async signIn(provider: SocialAuthProvider): Promise<void> {
    await this.startOAuth(PROVIDERS[provider], authRedirectUrl());
  }

  async linkIdentity(provider: SocialAuthProvider): Promise<void> {
    browserSessionStorage()?.setItem(PENDING_IDENTITY_LINK_KEY, provider);
    try {
      const { data, error } = await this.client.auth.linkIdentity({
        provider: PROVIDERS[provider],
        options: {
          redirectTo: identityLinkRedirectUrl(),
          skipBrowserRedirect: true,
        },
      });

      if (error) throw error;
      if (!data.url) throw new Error("소셜 계정 연동 주소를 만들지 못했습니다.");
      window.location.assign(data.url);
    } catch (error) {
      browserSessionStorage()?.removeItem(PENDING_IDENTITY_LINK_KEY);
      throw error;
    }
  }

  consumeIdentityLinkConflict(): SocialAuthProvider | null {
    const provider = readStoredProvider(PENDING_IDENTITY_LINK_KEY);
    const isConflict = oauthErrorCode() === "identity_already_exists";
    if (!provider || !isConflict) return null;

    browserSessionStorage()?.removeItem(PENDING_IDENTITY_LINK_KEY);
    removeOAuthErrorFromUrl();
    return provider;
  }

  async startAccountMerge(provider: SocialAuthProvider): Promise<void> {
    const { data, error } = await this.client.functions.invoke("account-merge", {
      body: { action: "start", provider },
    });
    if (error) throw error;
    if (!data || typeof data.intentId !== "string") {
      throw new Error("계정 병합을 시작하지 못했습니다.");
    }

    browserSessionStorage()?.setItem(PENDING_ACCOUNT_MERGE_KEY, data.intentId);
    try {
      await this.startOAuth(PROVIDERS[provider], identityLinkRedirectUrl());
    } catch (caught) {
      browserSessionStorage()?.removeItem(PENDING_ACCOUNT_MERGE_KEY);
      throw caught;
    }
  }

  hasPendingAccountMerge(): boolean {
    return Boolean(browserSessionStorage()?.getItem(PENDING_ACCOUNT_MERGE_KEY));
  }

  async previewAccountMerge(): Promise<AccountMergePreview> {
    return this.invokeAccountMerge<AccountMergePreview>("preview");
  }

  async completeAccountMerge(): Promise<void> {
    await this.invokeAccountMerge<unknown>("complete");
    browserSessionStorage()?.removeItem(PENDING_ACCOUNT_MERGE_KEY);
  }

  async cancelAccountMerge(): Promise<void> {
    await this.invokeAccountMerge<unknown>("cancel");
    browserSessionStorage()?.removeItem(PENDING_ACCOUNT_MERGE_KEY);
  }

  async signInAdmin(): Promise<void> {
    const redirectUrl = new URL(import.meta.env.BASE_URL, window.location.origin);
    redirectUrl.searchParams.set("admin", "1");
    await this.startOAuth("github", redirectUrl.toString());
  }

  private async startOAuth(provider: Provider, redirectTo: string): Promise<void> {
    const { data, error } = await this.client.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo,
        skipBrowserRedirect: true,
      },
    });

    if (error) throw error;
    if (!data.url) throw new Error("소셜 로그인 주소를 만들지 못했습니다.");
    window.location.assign(data.url);
  }

  private async invokeAccountMerge<T>(action: "preview" | "complete" | "cancel"): Promise<T> {
    const intentId = browserSessionStorage()?.getItem(PENDING_ACCOUNT_MERGE_KEY);
    if (!intentId) throw new Error("진행 중인 계정 병합이 없습니다.");
    const { data, error } = await this.client.functions.invoke("account-merge", {
      body: { action, intentId },
    });
    if (error) throw error;
    return data as T;
  }

  async signOut(): Promise<void> {
    await clearSupabaseSession(this.client);
  }
}
