// Filter values for the Industry SP screens are persisted to the URL query
// string (using the same param names the API itself uses) so a filtered
// view can be bookmarked, shared, or survive a refresh/navigation between
// the filters screen and the races screen.

export function getUrlSearchParams(): URLSearchParams | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search);
}

export function urlIntParam(name: string, fallback: number): number {
  const raw = getUrlSearchParams()?.get(name);
  if (raw == null) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function urlFloatParam(name: string, fallback: number): number {
  const raw = getUrlSearchParams()?.get(name);
  if (raw == null) return fallback;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function urlStringParam(name: string, fallback: string): string {
  const raw = getUrlSearchParams()?.get(name);
  return raw != null && raw !== "" ? raw : fallback;
}

export function urlToRowParam(paramName: string = "toRow"): number | null {
  const raw = getUrlSearchParams()?.get(paramName);
  if (raw == null) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

export function urlHasParam(name: string): boolean {
  return getUrlSearchParams()?.get(name) != null;
}

// Every query param IndustrySpScreen itself ever reads or writes — kept as
// an explicit list (rather than "any query string at all") so this can't
// be fooled by params some other, unrelated context tacks onto the URL
// (Storybook's own iframe carries ?id=&viewMode=&args=..., for example).
const ISP_FILTER_PARAM_NAMES = [
  "minRunners", "maxRunners", "minIsp", "maxIsp", "minInIspRange", "maxInIspRange",
  "minDate", "maxDate", "sort",
  "countries", "courses", "goings", "raceClasses", "raceTypes", "trainer", "jockey",
  "fromRowA", "toRowA", "fromRowB", "toRowB",
  "trainerFormMinWinRate", "hasTrainerForm", "minModelWinProbability", "onlyModelBeatsSp",
];

// True if the URL carries any of IndustrySpScreen's own filter params —
// used to decide whether a fresh mount represents a genuinely untouched
// page load (bare /isp) vs. one arriving with already-applied filter state
// (a bookmark, a shared link, or the URL this screen itself wrote after a
// previous Apply). See IndustrySpScreen's initial-fetch gating: a bare
// load should show nothing until the user presses Apply, but a link
// carrying explicit filters should honor them immediately.
export function urlHasAnyParams(): boolean {
  const params = getUrlSearchParams();
  if (params == null) return false;
  return ISP_FILTER_PARAM_NAMES.some(name => params.get(name) != null);
}

export function urlCountriesParam(): Set<string> {
  return urlSetParam("countries");
}

// Generic version of urlCountriesParam for any other comma-joined,
// multi-select filter (course, going, race class, race type, ...).
export function urlSetParam(name: string): Set<string> {
  const raw = getUrlSearchParams()?.get(name);
  if (!raw) return new Set();
  return new Set(raw.split(",").filter(Boolean));
}

export function urlSortParam(): "asc" | "desc" {
  return getUrlSearchParams()?.get("sort") === "desc" ? "desc" : "asc";
}

export function updateUrlParams(params: Record<string, string | undefined>): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  Object.entries(params).forEach(([key, value]) => {
    if (value == null || value === "") url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  });
  window.history.replaceState({}, "", url.pathname + url.search);
}
