import { useState, useEffect } from "react";

export type Route =
  | "/events"
  | "/chat"
  | "/runners"
  | "/isp"
  | "/isp/races"
  | "/isp/meeting"
  | "/isp/race"
  | "/isp/runner"
  | "/isp/runner/history"
  | "/isp/trainer"
  | "/results"
  | "/results/detail"
  | "/model-accuracy"
  | "/model-experiments"
  | "/bets"
  | "/model-vs-sp"
  | "/daily-races"
  | "/daily-races/event"
  | "/daily-races/race"
  | "/daily-races/runner";

// Must stay in lockstep with the union above — pathToRoute silently falls back
// to "/isp" for anything not listed here, so a route added to only one of the two
// looks like a broken link rather than a type error.
const STATIC_ROUTES = [
  "/events",
  "/chat",
  "/runners",
  "/isp",
  "/isp/races",
  "/isp/meeting",
  "/isp/race",
  "/isp/runner",
  "/isp/runner/history",
  "/isp/trainer",
  "/results",
  "/results/detail",
  "/model-accuracy",
  "/model-experiments",
  "/bets",
  "/model-vs-sp",
  "/daily-races",
  "/daily-races/event",
  "/daily-races/race",
  "/daily-races/runner",
];

function pathToRoute(path: string): Route {
  if (STATIC_ROUTES.includes(path)) return path as Route;
  return "/isp";
}

// Type guard so a `returnRoute` value read back out of a query string (a
// plain string, not compile-time trusted) can be safely passed to
// navigate() — see client/src/utils/returnNav.ts.
export function isRoute(path: string): path is Route {
  return STATIC_ROUTES.includes(path);
}

function currentQueryParams(): URLSearchParams {
  return typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
}

export function useRouter(): {
  route: Route;
  navigate: (to: Route, query?: string) => void;
  queryParams: URLSearchParams;
} {
  const [route, setRoute] = useState<Route>("/isp");
  const [queryParams, setQueryParams] = useState<URLSearchParams>(currentQueryParams);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setRoute(pathToRoute(window.location.pathname));
    setQueryParams(currentQueryParams());

    const onPop = () => {
      setRoute(pathToRoute(window.location.pathname));
      setQueryParams(currentQueryParams());
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // `query` carries dynamic route params (e.g. a meetingId or raceId) as a
  // query string rather than a path segment — simplest way to support
  // meetingId's `|` character without needing path-segment encoding logic
  // in this otherwise-static router.
  const navigate = (to: Route, query?: string) => {
    setRoute(to);
    const search = query ? `?${query}` : "";
    setQueryParams(new URLSearchParams(search));
    if (typeof window !== "undefined") {
      window.history.pushState({}, "", to + search);
    }
  };

  return { route, navigate, queryParams };
}
