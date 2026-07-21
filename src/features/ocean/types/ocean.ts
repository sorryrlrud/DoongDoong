import type { LanguageCode } from "@/i18n/languages";

export const SEA_OPTIONS = [
  { id: "pacific", name: "태평양", shortName: "태평양" },
  { id: "atlantic", name: "대서양", shortName: "대서양" },
  { id: "indian", name: "인도양", shortName: "인도양" },
  { id: "arctic", name: "북극해", shortName: "북극해" },
  { id: "southern", name: "남극해", shortName: "남극해" },
] as const;

export type SeaId = (typeof SEA_OPTIONS)[number]["id"];

export interface BottleContent {
  id: string;
  body: string;
  dateLabel?: string;
  signature?: string;
  senderCountryCode?: string;
  sourceLanguage?: LanguageCode;
  displayLanguage?: LanguageCode;
  isTranslated?: boolean;
}

export interface ActiveBottle {
  id: string;
  opened: boolean;
  caughtAt: number;
  content?: BottleContent;
}

export interface KeptBottle extends BottleContent {
  keptAt: number;
  expiresAt: number;
}

export interface OceanSnapshot {
  seaId: SeaId;
  countryCode?: string;
  languageCode: LanguageCode;
  defaultSignature?: string;
  reduceMotion: boolean;
  autoIncludeDate: boolean;
  remainingSends: number;
  nextCatchAt: number | null;
  bottleAvailable: boolean;
  waitingForNews: boolean;
  /**
   * Optional during the compatibility rollout. New backends include the
   * persisted preference so a fresh device can render the correct toggle.
   */
  bottleArrivedEnabled?: boolean;
  activeBottle: ActiveBottle | null;
  keptBottles: KeptBottle[];
}

export interface BottleDraft {
  body: string;
  seaId: SeaId;
  includeDate: boolean;
  signature?: string;
}

export type BottleResolution = "redrift" | "keep" | "discard";

export const REPORT_REASONS = [
  "personal_info",
  "sexual",
  "hate",
  "harassment",
  "self_harm",
  "spam",
  "other",
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number];

export interface PushSubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string;
}

export interface NotificationPreferences {
  bottleArrivedEnabled: boolean;
}

export interface OceanGateway {
  getSnapshot(): Promise<OceanSnapshot>;
  sendBottle(draft: BottleDraft): Promise<OceanSnapshot>;
  catchBottle(): Promise<OceanSnapshot>;
  openBottle(id: string): Promise<OceanSnapshot>;
  resolveBottle(id: string, resolution: BottleResolution): Promise<OceanSnapshot>;
  reportBottle(id: string, reason: ReportReason, blockAuthor: boolean): Promise<OceanSnapshot>;
  completeOnboarding(
    countryCode: string,
    seaId: SeaId,
    defaultSignature: string,
    languageCode: LanguageCode,
  ): Promise<OceanSnapshot>;
  updateProfile(countryCode: string, languageCode: LanguageCode): Promise<OceanSnapshot>;
  updateDefaultSignature(defaultSignature: string): Promise<OceanSnapshot>;
  updateAppPreferences(reduceMotion: boolean, autoIncludeDate: boolean): Promise<OceanSnapshot>;
  updateSea(seaId: SeaId): Promise<OceanSnapshot>;
  updateTimeZone(timeZone: string): Promise<OceanSnapshot>;
  upsertPushSubscription(subscription: PushSubscriptionInput): Promise<{ enabled: boolean; subscriptionActive: boolean }>;
  deletePushSubscription(endpoint: string): Promise<{ subscriptionActive: boolean }>;
  updateNotificationPreferences(enabled: boolean): Promise<NotificationPreferences>;
  deleteAccount(): Promise<void>;
}

export type OceanErrorCode =
  | "COOLDOWN"
  | "DAILY_LIMIT"
  | "NO_BOTTLE"
  | "BOTTLE_GONE"
  | "ACTIVE_BOTTLE"
  | "ADMIN_ACCOUNT"
  | "INVALID_DRAFT"
  | "AUTH_REQUIRED"
  | "ACCOUNT_INACTIVE"
  | "CONTENT_REJECTED"
  | "RATE_LIMITED"
  | "MODERATION_UNAVAILABLE"
  | "CONFIRMATION_REQUIRED"
  | "ACCOUNT_DELETE_IN_PROGRESS"
  | "ACCOUNT_DELETE_FAILED"
  | "MESSAGE_NOT_OWNED"
  | "INVALID_REPORT_REASON"
  | "REPORT_ALREADY_EXISTS";

export class OceanError extends Error {
  constructor(
    public readonly code: OceanErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "OceanError";
  }
}
