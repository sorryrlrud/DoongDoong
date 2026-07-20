import type { Provider, SupabaseClient, User } from "@supabase/supabase-js";
import type {
  AuthGateway,
  AuthUser,
  SocialAuthProvider,
} from "@/features/auth/types/auth";
import { clearSupabaseSession } from "@/features/ocean/services/supabase-client";

const PROVIDERS: Record<SocialAuthProvider, Provider> = {
  google: "google",
  apple: "apple",
  naver: "custom:naver",
};

const toAuthUser = (user: User | null): AuthUser | null => user ? { id: user.id } : null;

const authRedirectUrl = (): string =>
  new URL(import.meta.env.BASE_URL, window.location.origin).toString();

export class SupabaseAuthGateway implements AuthGateway {
  constructor(private readonly client: SupabaseClient) {}

  async getCurrentUser(): Promise<AuthUser | null> {
    const { data, error } = await this.client.auth.getUser();
    if (error) {
      if ([401, 403, 404].includes(error.status ?? 0)) {
        await clearSupabaseSession(this.client);
        return null;
      }
      throw error;
    }
    return toAuthUser(data.user);
  }

  onAuthStateChange(listener: (user: AuthUser | null) => void): () => void {
    const { data } = this.client.auth.onAuthStateChange((_event, session) => {
      listener(toAuthUser(session?.user ?? null));
    });
    return () => data.subscription.unsubscribe();
  }

  async signIn(provider: SocialAuthProvider): Promise<void> {
    const { data, error } = await this.client.auth.signInWithOAuth({
      provider: PROVIDERS[provider],
      options: {
        redirectTo: authRedirectUrl(),
        skipBrowserRedirect: true,
      },
    });

    if (error) throw error;
    if (!data.url) throw new Error("소셜 로그인 주소를 만들지 못했습니다.");
    window.location.assign(data.url);
  }

  async signOut(): Promise<void> {
    await clearSupabaseSession(this.client);
  }
}
