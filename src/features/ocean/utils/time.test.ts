import { describe, expect, it } from "vitest";
import { formatExpiry } from "@/features/ocean/utils/time";
import { translate } from "@/i18n/i18n";

describe("formatExpiry", () => {
  it("never shows more than the 30-day retention limit", () => {
    const now = new Date("2026-07-13T10:00:00+09:00").getTime();
    const slightlyStaleNow = now - 60_000;
    const expiresAt = now + 30 * 24 * 60 * 60 * 1000;

    expect(formatExpiry(expiresAt, slightlyStaleNow, (key, values) => translate("ko", key, values))).toBe("30일 뒤 사라져요");
  });
});
