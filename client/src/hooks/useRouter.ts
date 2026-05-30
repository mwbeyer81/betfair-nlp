import { useState, useEffect } from "react";

export type Route = "/events" | "/chat";

export function useRouter(): { route: Route; navigate: (to: Route) => void } {
  const [route, setRoute] = useState<Route>("/events");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const path = window.location.pathname;
    setRoute(path === "/chat" ? "/chat" : "/events");

    const onPop = () => {
      const p = window.location.pathname;
      setRoute(p === "/chat" ? "/chat" : "/events");
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
