import { describe, expect, it } from "vitest";
import { ConservativeLocalSafetyProvider } from "@/features/ocean/services/safety-provider";

describe("ConservativeLocalSafetyProvider", () => {
  const provider = new ConservativeLocalSafetyProvider();

  it("allows an ordinary reflective letter", async () => {
    await expect(provider.check("오늘 본 노을이 참 예뻤어요. 당신도 편안한 저녁을 보내길 바라요.")).resolves.toMatchObject({
      safe: true,
      category: "ok",
    });
  });

  it.each([
    "메일은 hello@example.com 이에요",
    "https://example.com 으로 와 주세요",
    "연락처는 010-1234-5678 입니다",
    "인스타 @somebody 로 디엠 주세요",
  ])("blocks personal contact information: %s", async (text) => {
    await expect(provider.check(text)).resolves.toMatchObject({ safe: false, category: "personal-info" });
  });

  it("flags crisis language for a separate help message", async () => {
    await expect(provider.check("요즘 자살 생각을 구체적으로 하고 있어요")).resolves.toMatchObject({
      safe: false,
      category: "sensitive",
      showCrisisHelp: true,
    });
  });
});
