import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadPreferences,
  resetPreferences,
  savePreferences,
  shouldShowOnboarding,
} from "@/app/preferences";

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
    vi.stubGlobal("navigator", { languages: ["ko-KR"] });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resets onboarding and motion settings for the tutorial", () => {
    savePreferences({
      onboarded: true,
      reduceMotion: true,
      defaultSignature: "밤의 여행자",
      autoIncludeDate: true,
      languageCode: "ko",
    });

    expect(loadPreferences()).toEqual({
      onboarded: true,
      reduceMotion: true,
      defaultSignature: "밤의 여행자",
      autoIncludeDate: true,
      languageCode: "ko",
    });
    expect(resetPreferences()).toEqual({
      onboarded: false,
      reduceMotion: false,
      defaultSignature: "",
      autoIncludeDate: false,
      languageCode: "ko",
    });
    expect(loadPreferences()).toEqual({
      onboarded: false,
      reduceMotion: false,
      defaultSignature: "",
      autoIncludeDate: false,
      languageCode: "ko",
    });
  });

  it("restarts onboarding when a deleted account receives a fresh server profile", () => {
    expect(shouldShowOnboarding({ onboarded: true }, undefined)).toBe(true);
    expect(shouldShowOnboarding({ onboarded: true }, "KR")).toBe(false);
    expect(shouldShowOnboarding({ onboarded: false }, "KR")).toBe(true);
  });
});
