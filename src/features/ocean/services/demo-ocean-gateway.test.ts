import { describe, expect, it } from "vitest";
import { DemoOceanGateway, type KeyValueStorage } from "@/features/ocean/services/demo-ocean-gateway";

class MemoryStorage implements KeyValueStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  dump(): string {
    return [...this.values.values()].join("\n");
  }
}

const createDraft = (body = "누군가에게 닿기를 바라는 충분히 긴 편지입니다.") => ({
  body,
  seaId: "pacific" as const,
  includeDate: false,
  signature: "작은 서명",
});

describe("DemoOceanGateway", () => {
  it("does not retain sent letter content or signature", async () => {
    const storage = new MemoryStorage();
    const gateway = new DemoOceanGateway(storage, () => new Date("2026-07-13T10:00:00+09:00").getTime(), () => 0);

    const snapshot = await gateway.sendBottle(createDraft("저장되면 안 되는 비밀 편지 내용입니다."));

    expect(snapshot.remainingSends).toBe(1);
    expect(storage.dump()).not.toContain("저장되면 안 되는 비밀 편지 내용입니다.");
    expect(storage.dump()).not.toContain("작은 서명");
  });

  it("enforces the two-bottle daily limit", async () => {
    const storage = new MemoryStorage();
    const gateway = new DemoOceanGateway(storage, () => new Date("2026-07-13T10:00:00+09:00").getTime(), () => 0);

    await gateway.sendBottle(createDraft());
    const afterSecond = await gateway.sendBottle(createDraft());

    expect(afterSecond.remainingSends).toBe(0);
    await expect(gateway.sendBottle(createDraft())).rejects.toMatchObject({ code: "DAILY_LIMIT" });
  });

  it("keeps a caught bottle blind until it is opened", async () => {
    const storage = new MemoryStorage();
    const gateway = new DemoOceanGateway(storage, () => new Date("2026-07-13T10:00:00+09:00").getTime(), () => 0);

    const caught = await gateway.catchBottle();
    expect(caught.activeBottle?.opened).toBe(false);
    expect(caught.activeBottle?.content).toBeUndefined();

    const opened = await gateway.openBottle(caught.activeBottle!.id);
    expect(opened.activeBottle?.opened).toBe(true);
    expect(opened.activeBottle?.content?.body.length).toBeGreaterThan(0);
  });

  it("starts a 12-hour cooldown only after a bottle is caught", async () => {
    const storage = new MemoryStorage();
    const now = new Date("2026-07-13T10:00:00+09:00").getTime();
    const gateway = new DemoOceanGateway(storage, () => now, () => 0);

    const before = await gateway.getSnapshot();
    expect(before.nextCatchAt).toBeNull();

    const caught = await gateway.catchBottle();
    expect(caught.nextCatchAt).toBe(now + 12 * 60 * 60 * 1000);
  });

  it("expires kept bottles after thirty days", async () => {
    const storage = new MemoryStorage();
    let now = new Date("2026-07-13T10:00:00+09:00").getTime();
    const gateway = new DemoOceanGateway(storage, () => now, () => 0);

    const caught = await gateway.catchBottle();
    await gateway.openBottle(caught.activeBottle!.id);
    const kept = await gateway.resolveBottle(caught.activeBottle!.id, "keep");
    expect(kept.keptBottles).toHaveLength(1);

    now += 30 * 24 * 60 * 60 * 1000 + 1;
    const expired = await gateway.getSnapshot();
    expect(expired.keptBottles).toHaveLength(0);
  });
});
