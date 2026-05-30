import { useState, useEffect } from "react";

export type Route = "/events" | "/chat" | "/runners";

const VALID_ROUTES: Route[] = ["/events", "/chat", "/runners"];

function pathToRoute(path: string): Route {
  return (VALID_ROUTES.find(r => r === path) as Route) ?? "/events";
}

export function useRouter(): { route: Route; navigate: (to: Route) => void } {
  const [route, setRoute] = useState<Route>("/events");

  useEffect(() => {
    if (typeof window === "undefined") return;
    setRoute(pathToRoute(window.location.pathname));

    const onPop = () => {
      setRoute(pathToRoute(window.location.pathname));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = (to: Route) => {
    setRoute(to);
    if (typeof window !== "undefined") {
      window.history.pushState({}, "", to);
    }
  };

  return { route, navigate };
}
