import { expect, test } from "@playwright/test";

const APP_PATH = "/DoongDoong/";

interface PwaProbeWindow extends Window {
  __doongdoongPushPermissionRequests: number;
}

test("built PWA preserves its scope and keeps public bootstrap permission-safe", async ({ page }) => {
  await page.addInitScript(() => {
    const probeWindow = window as PwaProbeWindow;
    probeWindow.__doongdoongPushPermissionRequests = 0;

    // A user gesture is the only valid place to request Push permission. The
    // spy prevents an unexpected browser prompt while turning a regression
    // into a deterministic test failure.
    Object.defineProperty(Notification, "requestPermission", {
      configurable: true,
      value: () => {
        probeWindow.__doongdoongPushPermissionRequests += 1;
        return Promise.resolve("denied" as NotificationPermission);
      },
    });
  });

  await page.goto(APP_PATH, { waitUntil: "load" });
  expect(new URL(page.url()).pathname).toBe(APP_PATH);

  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(manifestHref).not.toBeNull();
  const manifestResponse = await page.request.get(new URL(manifestHref!, page.url()).href);
  expect(manifestResponse.ok()).toBeTruthy();
  const manifest = await manifestResponse.json() as {
    start_url?: string;
    scope?: string;
  };
  expect(manifest.start_url).toBe("./");
  expect(manifest.scope).toBe("./");
  expect(new URL(manifest.start_url!, manifestResponse.url()).pathname).toBe(APP_PATH);
  expect(new URL(manifest.scope!, manifestResponse.url()).pathname).toBe(APP_PATH);

  await expect(page.getByRole("heading", { name: "로그인하고 바다를 열어 주세요" })).toBeVisible();
  const privacyLink = page.getByRole("link", { name: "개인정보처리방침" });
  const termsLink = page.getByRole("link", { name: "이용약관" });
  await expect(privacyLink).toBeVisible();
  await expect(termsLink).toBeVisible();
  expect(new URL((await privacyLink.getAttribute("href"))!, page.url()).pathname)
    .toBe(`${APP_PATH}privacy.html`);
  expect(new URL((await termsLink.getAttribute("href"))!, page.url()).pathname)
    .toBe(`${APP_PATH}terms.html`);

  const origin = new URL(page.url()).origin;
  const [privacyResponse, termsResponse] = await Promise.all([
    page.request.get(new URL(`${APP_PATH}privacy.html`, origin).href),
    page.request.get(new URL(`${APP_PATH}terms.html`, origin).href),
  ]);
  expect(privacyResponse.ok()).toBeTruthy();
  expect(await privacyResponse.text()).toContain("개인정보처리방침");
  expect(termsResponse.ok()).toBeTruthy();
  expect(await termsResponse.text()).toContain("이용약관");

  await expect.poll(async () => page.evaluate(
    () => navigator.serviceWorker.controller?.scriptURL ?? null,
  )).toContain(`${APP_PATH}sw.js`);
  const registration = await page.evaluate(async () => {
    const ready = await navigator.serviceWorker.ready;
    return {
      scope: ready.scope,
      activeScript: ready.active?.scriptURL ?? null,
    };
  });
  expect(registration.scope).toBe(new URL(APP_PATH, page.url()).href);
  expect(registration.activeScript).toBe(new URL("sw.js", page.url()).href);
  expect(await page.evaluate(
    () => (window as PwaProbeWindow).__doongdoongPushPermissionRequests,
  )).toBe(0);
});
