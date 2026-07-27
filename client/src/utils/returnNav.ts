import { Route, isRoute } from "../hooks/useRouter";

// Runner Detail / Runner History / Trainer Detail can each be reached from
// several different parent screens (and, for Runner History, from Runner
// Detail itself). Rather than a real navigation stack, each forward nav
// captures "where the user tapped in from" as of that moment — the current
// route plus its full query string — as returnRoute/returnQuery params.
// Each screen's own back button resolves only its immediate predecessor;
// chained drill-ins compose correctly because each hop stores its own
// pointer independently (Runner History's back goes to Runner Detail;
// Runner Detail's own separately-stored pointer still goes to wherever it
// was opened from).
export function buildReturnParams(currentRoute: Route): string {
  const query = typeof window !== "undefined" ? window.location.search.slice(1) : "";
  return `returnRoute=${encodeURIComponent(currentRoute)}&returnQuery=${encodeURIComponent(query)}`;
}

// Falls back to `fallback` for a bare/bookmarked deep link with no
// returnRoute — same "safe default" philosophy as pathToRoute's fallback.
export function resolveReturn(queryParams: URLSearchParams, fallback: Route): { route: Route; query: string } {
  const raw = queryParams.get("returnRoute");
  const route = raw && isRoute(raw) ? raw : fallback;
  return { route, query: queryParams.get("returnQuery") ?? "" };
}
