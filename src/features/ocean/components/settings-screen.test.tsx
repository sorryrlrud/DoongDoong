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
        defaultSignature=""
        autoIncludeDate={false}
        onLanguagePreview={() => undefined}
        onProfileChange={() => undefined}
        onDefaultSignatureChange={() => undefined}
        onAppPreferencesChange={async () => undefined}
        onLinkIdentity={async () => undefined}
        onSignOut={async () => undefined}
        notificationEnabled={false}
        onNotificationPreferenceChange={async (enabled) => enabled}
        canInstall={false}
        showIosInstallHelp={false}
        onInstall={async () => undefined}
        onDeleteAccount={async () => undefined}
      />,
    );

    expect(html).toContain("소셜 로그인 연동");
    expect(html).toContain("NAVER");
    expect(html).toContain("연동됨");
    expect(html).toContain("Google");
    expect(html).toContain("Apple");
    expect(html.match(/연동하기/g)).toHaveLength(2);
    expect(html).toContain("병 도착 알림");
    expect(html).toContain("계정 삭제");
  });
});
