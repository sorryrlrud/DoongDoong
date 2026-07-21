import { useCallback, useEffect, useState } from "react";

export type AppRoute = "home" | "write" | "catch" | "kept" | "guide" | "settings" | "admin";

const ROUTES = new Set<AppRoute>(["home", "write", "catch", "kept", "guide", "settings", "admin"]);

const hasAdminQuery = (): boolean => {
  const adminParam = new URLSearchParams(window.location.search).get("admin");
  return adminParam === "" || adminParam === "1";
};

const isCanonicalAdminLocation = (): boolean =>
  !new URLSearchParams(window.location.search).has("admin")
  && window.location.hash === "#/admin";

export const canonicalAdminUrl = (href: string): string => {
  const nextUrl = new URL(href);
  nextUrl.searchParams.delete("admin");
  nextUrl.hash = "/admin";
  return nextUrl.toString();
};

const readHash = (): string => {
  if (hasAdminQuery()) return "admin";

  const hashRoute = window.location.hash.replace(/^#\/?/, "").split("#", 1)[0];
  if (ROUTES.has(hashRoute as AppRoute)) return hashRoute;

  return "home";
};

export const readAppRoute = (): AppRoute => {
  return readHash() as AppRoute;
};

export const useHashRoute = () => {
  const [route, setRoute] = useState<AppRoute>(readAppRoute);

  useEffect(() => {
    const handleHashChange = () => setRoute(readAppRoute());
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const navigate = useCallback((nextRoute: AppRoute) => {
    if (nextRoute === "admin") {
      if (!isCanonicalAdminLocation()) {
        window.history.replaceState(null, "", canonicalAdminUrl(window.location.href));
      }
      setRoute(nextRoute);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    if (readAppRoute() === nextRoute && readHash() === nextRoute) {
      setRoute(nextRoute);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    if (hasAdminQuery()) {
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.delete("admin");
      nextUrl.hash = nextRoute;
      window.history.pushState(null, "", nextUrl);
      setRoute(nextRoute);
      return;
    }

    window.location.hash = nextRoute;
  }, []);

  return { route, navigate };
};
