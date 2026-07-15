import { useCallback, useEffect, useState } from "react";

export type AppRoute = "home" | "write" | "catch" | "kept" | "guide" | "settings" | "admin";

const ROUTES = new Set<AppRoute>(["home", "write", "catch", "kept", "guide", "settings", "admin"]);

const readHash = (): string => {
  const hashRoute = window.location.hash.replace(/^#\/?/, "").split("#", 1)[0];
  if (ROUTES.has(hashRoute as AppRoute)) return hashRoute;

  return new URLSearchParams(window.location.search).get("admin") === "1" ? "admin" : "home";
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
    if (readAppRoute() === nextRoute && readHash() === nextRoute) {
      setRoute(nextRoute);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    window.location.hash = nextRoute;
  }, []);

  return { route, navigate };
};
