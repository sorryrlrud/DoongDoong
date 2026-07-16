import { describe, expect, it } from "vitest";
import { hasValidDraft } from "@/features/ocean/utils/write-validation";

describe("write draft validation", () => {
  it("becomes valid as soon as the tenth non-whitespace character is entered", () => {
    expect(hasValidDraft("아홉 글자예요", "")).toBe(false);
    expect(hasValidDraft("열 글자가 되었어요", "")).toBe(true);
  });

  it("keeps the signature and maximum-length guards", () => {
    expect(hasValidDraft("열 글자가 되었어요", "가".repeat(21))).toBe(false);
    expect(hasValidDraft("가".repeat(1001), "")).toBe(false);
  });
});
