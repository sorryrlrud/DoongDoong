import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPreferences, savePreferences } from "@/app/preferences";

class MemoryStorage {
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
}

describe("preferences", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { localStorage: new MemoryStorage() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stores onboarding and motion settings", () => {
    savePreferences({ onboarded: true, reduceMotion: true });

    expect(loadPreferences()).toEqual({ onboarded: true, reduceMotion: true });
  });
});
