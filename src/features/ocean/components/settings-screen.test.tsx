import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SettingsScreen } from "@/features/ocean/components/settings-screen";

describe("SettingsScreen", () => {
  it("shows connected social identities and offers the remaining providers", () => {
    const html = renderToStaticMarkup(
      <SettingsScreen
        linkedProviders={["custom:naver"]}
        countryCode="KR"
        languageCode="ko"
        reduceMotion={false}
        onReduceMotionChange={() => undefined}
        defaultSignature=""
        autoIncludeDate={false}
        onProfileChange={() => undefined}
        onWritingDefaultsChange={() => undefined}
        onLinkIdentity={async () => undefined}
        onSignOut={async () => undefined}
      />,
    );

    expect(html).toContain("소셜 로그인 연동");
    expect(html).toContain("NAVER");
    expect(html).toContain("연동됨");
    expect(html).toContain("Google");
    expect(html).toContain("Apple");
    expect(html.match(/연동하기/g)).toHaveLength(2);
  });
});
