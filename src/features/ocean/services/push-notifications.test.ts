import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isPushSupported,
  urlBase64ToUint8Array,
} from "@/features/ocean/services/push-notifications";

describe("Push notification client helpers", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("decodes a URL-safe VAPID public key", () => {
    vi.stubGlobal("window", { atob: globalThis.atob });

    expect([...urlBase64ToUint8Array("AQIDBA")]).toEqual([1, 2, 3, 4]);
  });

  it("does not claim Push support when required browser APIs are absent", () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", {});

    expect(isPushSupported()).toBe(false);
  });
});

describe("service worker Push contract", () => {
  it("handles only versioned arrival payloads and uses a scope-relative catch link", () => {
    const serviceWorker = readFileSync("public/sw.js", "utf8");

    expect(serviceWorker).toContain('payload.version !== 1');
    expect(serviceWorker).toContain('payload.type !== "bottle_arrived"');
    expect(serviceWorker).toContain('const DEFAULT_ARRIVAL_URL = "./#/catch"');
    expect(serviceWorker).toContain('self.addEventListener("push"');
    expect(serviceWorker).toContain('self.addEventListener("notificationclick"');
    expect(serviceWorker).toContain('self.addEventListener("pushsubscriptionchange"');
  });

  it("isolates app-shell caches by service worker scope", () => {
    const serviceWorker = readFileSync("public/sw.js", "utf8");

    expect(serviceWorker).toContain("self.registration.scope");
    expect(serviceWorker).toContain("CACHE_PREFIX");
    expect(serviceWorker).toContain("caches.open(CACHE_NAME)");
    expect(serviceWorker).not.toContain("caches.match(event.request)");
  });
});
