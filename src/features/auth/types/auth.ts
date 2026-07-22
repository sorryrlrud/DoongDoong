export type SocialAuthProvider = "google" | "apple" | "naver";

export interface AccountMergePreview {
  provider: SocialAuthProvider;
  sourceMessages: {
    sent: number;
    received: number;
    kept: number;
  };
  blockedReason: "ACTIVE_BOTTLE_CONFLICT" | "ACCOUNT_INACTIVE" | "ADMIN_ACCOUNT" | null;
}

export interface AuthUser {
  id: string;
  providers: string[];
}

export interface AuthGateway {
  getCurrentUser(): Promise<AuthUser | null>;
  onAuthStateChange(listener: (user: AuthUser | null) => void): () => void;
  signIn(provider: SocialAuthProvider): Promise<void>;
  linkIdentity(provider: SocialAuthProvider): Promise<void>;
  consumeIdentityLinkConflict(): SocialAuthProvider | null;
  startAccountMerge(provider: SocialAuthProvider): Promise<void>;
  hasPendingAccountMerge(): boolean;
  previewAccountMerge(): Promise<AccountMergePreview>;
  completeAccountMerge(): Promise<void>;
  cancelAccountMerge(): Promise<void>;
  signInAdmin(): Promise<void>;
  signOut(): Promise<void>;
}
