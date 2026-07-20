export type SocialAuthProvider = "google" | "apple" | "naver";

export interface AuthUser {
  id: string;
}

export interface AuthGateway {
  getCurrentUser(): Promise<AuthUser | null>;
  onAuthStateChange(listener: (user: AuthUser | null) => void): () => void;
  signIn(provider: SocialAuthProvider): Promise<void>;
  signOut(): Promise<void>;
}
