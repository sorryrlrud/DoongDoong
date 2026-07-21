import { describe, expect, it } from "vitest";
import { getBrowserTimeZone } from "@/features/ocean/services/time-zone";

describe("getBrowserTimeZone", () => {
  it("returns the browser's unmodified IANA time zone", () => {
    expect(getBrowserTimeZone(() => "Asia/Seoul")).toBe("Asia/Seoul");
    expect(getBrowserTimeZone(() => "UTC")).toBe("UTC");
  });

  it("does not surface malformed or unavailable browser values", () => {
    expect(getBrowserTimeZone(() => "  Asia/Seoul  ")).toBeNull();
    expect(getBrowserTimeZone(() => "")).toBeNull();
    expect(getBrowserTimeZone(() => {
      throw new Error("Intl is unavailable");
    })).toBeNull();
  });
});
