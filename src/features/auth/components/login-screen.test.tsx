import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LoginScreen } from "@/features/auth/components/login-screen";

describe("LoginScreen", () => {
  it("offers only Google, Apple, and Naver", () => {
    const html = renderToStaticMarkup(
      <LoginScreen busyProvider={null} error={null} onSignIn={() => undefined} />,
    );

    expect(html).toContain("Google로 계속하기");
    expect(html).toContain("Apple로 계속하기");
    expect(html).toContain("네이버로 계속하기");
    expect(html).not.toContain("GitHub");
    expect(html).not.toContain("익명");
  });
});
