import { afterEach, describe, expect, it, vi } from "vitest";
import { canonicalAdminUrl, readAppRoute } from "@/app/use-hash-route";

const setLocation = (search: string, hash = "") => {
  vi.stubGlobal("window", { location: { search, hash } });
};

describe("readAppRoute", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each(["?admin", "?admin=1"])("opens the admin route for %s", (search) => {
    setLocation(search);
    expect(readAppRoute()).toBe("admin");
  });

  it("keeps an OAuth response fragment on the admin route", () => {
    setLocation("?admin", "#access_token=token&token_type=bearer");
    expect(readAppRoute()).toBe("admin");
  });

  it("gives the explicit admin query priority over an old app hash", () => {
    setLocation("?admin", "#/home");
    expect(readAppRoute()).toBe("admin");
  });

  it("does not treat unrelated admin values as an admin route", () => {
    setLocation("?admin=0");
    expect(readAppRoute()).toBe("home");
  });

  it.each([
    "https://sorryrlrud.github.io/DoongDoong/?admin",
    "https://sorryrlrud.github.io/DoongDoong/?admin=1#access_token=token",
    "https://sorryrlrud.github.io/DoongDoong/#admin",
  ])("normalizes legacy and callback URLs to the single admin address", (href) => {
    expect(canonicalAdminUrl(href)).toBe(
      "https://sorryrlrud.github.io/DoongDoong/#/admin",
    );
  });
});
