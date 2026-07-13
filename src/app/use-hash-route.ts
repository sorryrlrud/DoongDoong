import { useCallback, useEffect, useState } from "react";

export type AppRoute = "home" | "write" | "catch" | "kept" | "guide" | "settings";

const ROUTES = new Set<AppRoute>(["home", "write", "catch", "kept", "guide", "settings"]);

const readRoute = (): AppRoute => {
  const hash = window.location.hash.replace(/^#\/?/, "") as AppRoute;
  return ROUTES.has(hash) ? hash : "home";
};

export const useHashRoute = () => {
  const [route, setRoute] = useState<AppRoute>(readRoute);

  useEffect(() => {
    const handleHashChange = () => setRoute(readRoute());
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const navigate = useCallback((nextRoute: AppRoute) => {
    if (readRoute() === nextRoute) {
      setRoute(nextRoute);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    window.location.hash = nextRoute;
  }, []);

  return { route, navigate };
};
