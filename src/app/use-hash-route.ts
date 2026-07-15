import { useCallback, useEffect, useState } from "react";

export type AppRoute = "home" | "write" | "catch" | "kept" | "guide" | "settings" | "admin";

const ROUTES = new Set<AppRoute>(["home", "write", "catch", "kept", "guide", "settings", "admin"]);

const readHash = () => window.location.hash.replace(/^#\/?/, "");

export const readAppRoute = (): AppRoute => {
  const hash = readHash() as AppRoute;
  return ROUTES.has(hash) ? hash : "home";
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
