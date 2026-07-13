import { SEED_BOTTLES } from "@/features/ocean/data/seed-bottles";
import {
  OceanError,
  type ActiveBottle,
  type BottleDraft,
  type BottleResolution,
  type KeptBottle,
  type OceanGateway,
  type OceanSnapshot,
  type SeaId,
} from "@/features/ocean/types/ocean";

const STORAGE_KEY = "doongdoong.demo-ocean.v1";
const TWELVE_HOURS = 12 * 60 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;
const SEVEN_DAYS = 7 * 24 * ONE_HOUR;
const THIRTY_DAYS = 30 * 24 * ONE_HOUR;
const ACTIVE_TIMEOUT = 24 * ONE_HOUR;

interface ActiveBottleState {
  id: string;
  opened: boolean;
  caughtAt: number;
}

interface KeptBottleState {
  keptAt: number;
  expiresAt: number;
}

interface DemoOceanState {
  version: 1;
  seaId: SeaId;
  sentAt: number[];
  nextCatchAt: number | null;
  activeBottle: ActiveBottleState | null;
  kept: Record<string, KeptBottleState>;
  availableAt: Record<string, number>;
  driftCount: Record<string, number>;
  discarded: string[];
  reported: string[];
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const createDefaultState = (): DemoOceanState => ({
  version: 1,
  seaId: "pacific",
  sentAt: [],
  nextCatchAt: null,
  activeBottle: null,
  kept: {},
  availableAt: {},
  driftCount: {},
  discarded: [],
  reported: [],
});

const startOfToday = (timestamp: number): number => {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

export class DemoOceanGateway implements OceanGateway {
  constructor(
    private readonly storage: KeyValueStorage,
    private readonly now: () => number = Date.now,
    private readonly random: () => number = Math.random,
  ) {}

  async getSnapshot(): Promise<OceanSnapshot> {
    const state = this.readAndClean();
    this.write(state);
    return this.toSnapshot(state);
  }

  async sendBottle(draft: BottleDraft): Promise<OceanSnapshot> {
    const state = this.readAndClean();
    const bodyLength = Array.from(draft.body.trim()).length;

    if (bodyLength < 10 || bodyLength > 1000 || (draft.signature?.length ?? 0) > 20) {
      throw new OceanError("INVALID_DRAFT", "편지는 10자 이상 1,000자 이하로 적어 주세요.");
    }

    if (this.remainingSends(state) <= 0) {
      throw new OceanError("DAILY_LIMIT", "오늘 띄울 수 있는 두 병을 모두 사용했어요.");
    }

    // The demo intentionally keeps no copy of the sent text. A production gateway
    // stores it server-side only after moderation and never exposes sender history.
    state.sentAt.push(this.now());
    this.write(state);
    return this.toSnapshot(state);
  }

  async catchBottle(): Promise<OceanSnapshot> {
    const state = this.readAndClean();
    const currentTime = this.now();

    if (state.activeBottle) {
      return this.toSnapshot(state);
    }

    if (state.nextCatchAt && state.nextCatchAt > currentTime) {
      throw new OceanError("COOLDOWN", "아직 다음 병을 건질 시간이 아니에요.");
    }

    const candidates = this.availableBottles(state, currentTime);

    if (candidates.length === 0) {
      throw new OceanError("NO_BOTTLE", "지금은 물결 사이에 보이는 병이 없어요.");
    }

    const picked = candidates[Math.floor(this.random() * candidates.length)] ?? candidates[0];
    state.activeBottle = { id: picked.id, opened: false, caughtAt: currentTime };
    state.nextCatchAt = currentTime + TWELVE_HOURS;
    this.write(state);
    return this.toSnapshot(state);
  }

  async openBottle(id: string): Promise<OceanSnapshot> {
    const state = this.readAndClean();
    if (!state.activeBottle || state.activeBottle.id !== id) {
      throw new OceanError("BOTTLE_GONE", "이 병은 이미 다시 바다로 떠났어요.");
    }

    state.activeBottle.opened = true;
    this.write(state);
    return this.toSnapshot(state);
  }

  async resolveBottle(id: string, resolution: BottleResolution): Promise<OceanSnapshot> {
    const state = this.readAndClean();
    const currentTime = this.now();
    const isActive = state.activeBottle?.id === id;
    const isKept = Boolean(state.kept[id]);

    if (!isActive && !isKept) {
      throw new OceanError("BOTTLE_GONE", "이 병은 이미 바다에서 사라졌어요.");
    }

    if (resolution === "redrift") {
      const driftCount = (state.driftCount[id] ?? 0) + 1;
      const maxDelay = Math.max(ONE_HOUR, SEVEN_DAYS * 0.65 ** driftCount);
      state.driftCount[id] = driftCount;
      state.availableAt[id] = currentTime + ONE_HOUR + this.random() * (maxDelay - ONE_HOUR);
      delete state.kept[id];
    } else if (resolution === "keep") {
      state.kept[id] = { keptAt: currentTime, expiresAt: currentTime + THIRTY_DAYS };
    } else if (resolution === "report") {
      state.reported = [...new Set([...state.reported, id])];
      delete state.kept[id];
    } else {
      state.discarded = [...new Set([...state.discarded, id])];
      delete state.kept[id];
    }

    if (isActive) {
      state.activeBottle = null;
    }

    this.write(state);
    return this.toSnapshot(state);
  }

  async updateSea(seaId: SeaId): Promise<OceanSnapshot> {
    const state = this.readAndClean();
    if (state.activeBottle) {
      throw new OceanError("ACTIVE_BOTTLE", "손에 든 병을 먼저 정한 뒤 바다를 바꿀 수 있어요.");
    }

    state.seaId = seaId;
    this.write(state);
    return this.toSnapshot(state);
  }

  async resetDemo(): Promise<OceanSnapshot> {
    this.storage.removeItem(STORAGE_KEY);
    const state = createDefaultState();
    this.write(state);
    return this.toSnapshot(state);
  }

  private readAndClean(): DemoOceanState {
    const currentTime = this.now();
    let state = createDefaultState();

    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as DemoOceanState;
        if (parsed.version === 1) {
          state = { ...createDefaultState(), ...parsed };
        }
      }
    } catch {
      state = createDefaultState();
    }

    state.sentAt = state.sentAt.filter((timestamp) => timestamp >= startOfToday(currentTime));

    for (const [id, kept] of Object.entries(state.kept)) {
      if (kept.expiresAt <= currentTime) {
        delete state.kept[id];
        state.discarded = [...new Set([...state.discarded, id])];
      }
    }

    if (state.activeBottle && state.activeBottle.caughtAt + ACTIVE_TIMEOUT <= currentTime) {
      const id = state.activeBottle.id;
      const driftCount = (state.driftCount[id] ?? 0) + 1;
      state.driftCount[id] = driftCount;
      state.availableAt[id] = currentTime + ONE_HOUR;
      state.activeBottle = null;
    }

    return state;
  }

  private remainingSends(state: DemoOceanState): number {
    return Math.max(0, 2 - state.sentAt.length);
  }

  private availableBottles(state: DemoOceanState, currentTime: number) {
    const unavailable = new Set([
      ...state.discarded,
      ...state.reported,
      ...Object.keys(state.kept),
    ]);

    return SEED_BOTTLES.filter(
      (bottle) => !unavailable.has(bottle.id) && (state.availableAt[bottle.id] ?? 0) <= currentTime,
    );
  }

  private toSnapshot(state: DemoOceanState): OceanSnapshot {
    const currentTime = this.now();
    const activeSeed = state.activeBottle
      ? SEED_BOTTLES.find((bottle) => bottle.id === state.activeBottle?.id)
      : undefined;

    const activeBottle: ActiveBottle | null = state.activeBottle
      ? {
          ...state.activeBottle,
          content: state.activeBottle.opened && activeSeed ? { ...activeSeed } : undefined,
        }
      : null;

    const keptBottles: KeptBottle[] = Object.entries(state.kept)
      .flatMap(([id, kept]) => {
        const content = SEED_BOTTLES.find((bottle) => bottle.id === id);
        return content ? [{ ...content, ...kept }] : [];
      })
      .sort((a, b) => b.keptAt - a.keptAt);

    return {
      seaId: state.seaId,
      remainingSends: this.remainingSends(state),
      nextCatchAt: state.nextCatchAt,
      bottleAvailable:
        Boolean(activeBottle) ||
        ((!state.nextCatchAt || state.nextCatchAt <= currentTime) && this.availableBottles(state, currentTime).length > 0),
      activeBottle,
      keptBottles,
      isDemo: true,
    };
  }

  private write(state: DemoOceanState): void {
    this.storage.setItem(STORAGE_KEY, JSON.stringify(state));
  }
}
