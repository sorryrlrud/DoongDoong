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
  remainingSends: number;
  nextCatchAt: number | null;
  bottleAvailable: boolean;
  waitingForNews: boolean;
  activeBottle: ActiveBottle | null;
  keptBottles: KeptBottle[];
}

export interface BottleDraft {
  body: string;
  seaId: SeaId;
  includeDate: boolean;
  signature?: string;
}

export type BottleResolution = "redrift" | "keep" | "discard" | "report";

export interface OceanGateway {
  getSnapshot(): Promise<OceanSnapshot>;
  sendBottle(draft: BottleDraft): Promise<OceanSnapshot>;
  catchBottle(): Promise<OceanSnapshot>;
  openBottle(id: string): Promise<OceanSnapshot>;
  resolveBottle(id: string, resolution: BottleResolution): Promise<OceanSnapshot>;
  completeOnboarding(countryCode: string, seaId: SeaId): Promise<OceanSnapshot>;
  updateSea(seaId: SeaId): Promise<OceanSnapshot>;
  resetDemoUser(): Promise<void>;
}

export type OceanErrorCode =
  | "COOLDOWN"
  | "DAILY_LIMIT"
  | "NO_BOTTLE"
  | "BOTTLE_GONE"
  | "ACTIVE_BOTTLE"
  | "ADMIN_ACCOUNT"
  | "INVALID_DRAFT";

export class OceanError extends Error {
  constructor(
    public readonly code: OceanErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "OceanError";
  }
}
