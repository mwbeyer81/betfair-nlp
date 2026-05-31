import { useState, useEffect } from "react";

export type Route = "/events" | "/chat" | "/runners" | string;

const STATIC_ROUTES = ["/events", "/chat", "/runners"];

function pathToRoute(path: string): Route {
  if (STATIC_ROUTES.includes(path)) return path as Route;
  if (path.startsWith("/runner/")) return path;
  return "/events";
}

export interface RunnerRouteParams {
  eventId: string;
  runnerId: number;
  runnerName: string;
}

export function parseRunnerRoute(route: string): RunnerRouteParams | null {
  const m = route.match(/^\/runner\/([^/]+)\/(\d+)/);
  if (!m) return null;
  const params = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search)
    : new URLSearchParams();
  return {
    eventId: m[1],
    runnerId: parseInt(m[2], 10),
    runnerName: params.get("name") ?? "Runner",
  };
}

export function useRouter(): { route: Route; navigate: (to: string) => void } {
  const [route, setRoute] = useState<Route>("/events");

  useEffect(() => {
    if (typeof window === "undefined") return;
    setRoute(pathToRoute(window.location.pathname));

    const onPop = () => setRoute(pathToRoute(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = (to: string) => {
    setRoute(to);
    if (typeof window !== "undefined") {
      window.history.pushState({}, "", to);
    }
  };

  return { route, navigate };
}
