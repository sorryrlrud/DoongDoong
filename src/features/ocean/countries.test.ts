import { describe, expect, it } from "vitest";
import { countryName, recommendedSeaForCountry } from "@/features/ocean/countries";

describe("country helpers", () => {
  it("recommends the nearest configured ocean for a country", () => {
    expect(recommendedSeaForCountry("KR")).toBe("pacific");
    expect(recommendedSeaForCountry("IN")).toBe("indian");
    expect(recommendedSeaForCountry("NO")).toBe("arctic");
  });

  it("keeps a safe fallback for historical or unknown country codes", () => {
    expect(countryName("XX")).toBe("XX");
    expect(recommendedSeaForCountry("XX")).toBe("pacific");
  });
});
