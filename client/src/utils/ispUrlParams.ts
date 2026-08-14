// Filter values for the Industry SP screens are persisted to the URL query
// string (using the same param names the API itself uses) so a filtered
// view can be bookmarked, shared, or survive a refresh/navigation between
// the filters screen and the races screen.

import type { QualifyingFilterParams } from "./ispFormat";

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
  "minModelSpEdgePts", "onlyModelTopPick", "includeLevelStakes",
];

// True if the URL carries any of IndustrySpScreen's own filter params —
// used to decide whether a fresh mount represents a genuinely untouched
// page load (bare /isp) vs. one arriving with already-applied filter state
// (a bookmark, a shared link, or the URL this screen itself wrote after a
// previous Apply). See IndustrySpScreen's initial-fetch gating: a bare
// load should show nothing until the user presses Apply, but a link
// carrying explicit filters should honor them immediately.
// The raw-model-field registry's params can't be enumerated here: the field
// list is fetched from /api/industry-sp/filter-fields, and urlHasAnyParams runs
// synchronously at mount, long before it arrives. So they are recognised by
// SHAPE instead — `min<Capital>` / `max<Capital>`, or one of the two enum
// params — which is enough for the only question being asked, "did this URL
// arrive carrying filters?". Exact validation still happens server-side, where
// an unknown name is a 400 rather than a shrug.
//
// The explicit list above is deliberately still consulted first, because that
// is what distinguishes a real filter param from Storybook's own
// ?id=&viewMode=&args= — the reason this function exists at all.
const REGISTRY_MIN_MAX_RE = /^(?:min|max)[A-Z]/;
const REGISTRY_ENUM_PARAM_NAMES = ["sexes", "headgear"];

function urlHasAnyRegistryParams(params: URLSearchParams): boolean {
  if (REGISTRY_ENUM_PARAM_NAMES.some(name => params.get(name) != null)) return true;
  for (const key of params.keys()) {
    // Skip the hand-written min*/max* params — those are already covered by
    // ISP_FILTER_PARAM_NAMES and matching them here would be harmless but
    // misleading to anyone reading this.
    if (ISP_FILTER_PARAM_NAMES.includes(key)) continue;
    if (REGISTRY_MIN_MAX_RE.test(key)) return true;
  }
  return false;
}

export function urlHasAnyParams(): boolean {
  const params = getUrlSearchParams();
  if (params == null) return false;
  if (ISP_FILTER_PARAM_NAMES.some(name => params.get(name) != null)) return true;
  return urlHasAnyRegistryParams(params);
}

// ModelVsSpScreen's own param surface, kept as a SEPARATE list rather than
// appended to ISP_FILTER_PARAM_NAMES above: that list is what urlHasAnyParams
// uses to decide whether /isp arrived with filters already applied, so adding
// foreign names to it would make a bare /isp mount think it should fetch. The
// two lists deliberately share the `minDate`/`maxDate`/`sort` spellings, since
// both screens mean the same thing by them.
const MODEL_VS_SP_PARAM_NAMES = [
  "page", "limit", "sort",
  "minDate", "maxDate",
  "minModelProb", "maxModelProb",
  "minImpliedProb", "maxImpliedProb",
  "minEdge", "maxEdge",
];

// True if the URL carries any of ModelVsSpScreen's own params — same purpose as
// urlHasAnyParams for /isp, and same reason it can't just test for a non-empty
// query string (Storybook's iframe adds ?id=&viewMode=&args=... of its own).
export function urlHasAnyModelVsSpParams(): boolean {
  const params = getUrlSearchParams();
  if (params == null) return false;
  return MODEL_VS_SP_PARAM_NAMES.some(name => params.get(name) != null);
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

// The subset of ISP_FILTER_PARAM_NAMES that determine "does this runner
// qualify" (see ispFormat.ts's runnerQualifies/hasActiveQualifyingFilter) —
// used by IndustryMeetingScreen/IndustryRaceScreen when reached from a
// saved filter's Live Performance section (see SavedResultDetailScreen.tsx,
// App.tsx's onNavigateToMeeting/onNavigateToRace), so the runner list shown
// there matches exactly what that filter actually selected, rather than
// showing the whole field.
export function urlQualifyingFilterParams(): QualifyingFilterParams {
  return {
    minIsp: urlFloatParam("minIsp", 1),
    maxIsp: urlFloatParam("maxIsp", 1000),
    hasTrainerForm: urlStringParam("hasTrainerForm", "") === "true",
    trainerFormMinWinRate: urlFloatParam("trainerFormMinWinRate", 0),
    minModelWinProbability: urlFloatParam("minModelWinProbability", 0),
    onlyModelBeatsSp: urlStringParam("onlyModelBeatsSp", "") === "true",
    minModelSpEdgePts: urlFloatParam("minModelSpEdgePts", 0),
  };
}

// Just the param names urlQualifyingFilterParams() reads — used to carry a
// filter's own qualifying criteria along when navigating from a filtered
// context (the Races list's current URL, or a saved filter's own `filters`
// map) into a specific meeting/race, without also dragging along unrelated
// params (fromRow/toRow/page/sort/...) that don't apply to a single
// already-identified meeting/race.
const QUALIFYING_FILTER_PARAM_NAMES = [
  "minIsp", "maxIsp", "hasTrainerForm", "trainerFormMinWinRate", "minModelWinProbability", "onlyModelBeatsSp",
  "minModelSpEdgePts",
];

export function qualifyingFilterQueryFromParams(params: URLSearchParams): string {
  const out = new URLSearchParams();
  for (const name of QUALIFYING_FILTER_PARAM_NAMES) {
    const value = params.get(name);
    if (value != null) out.set(name, value);
  }
  return out.toString();
}

// `null` is accepted alongside `undefined` (both mean "delete this param", as the
// body already handled) so a caller can write the common
// `key: value !== DEFAULT ? String(value) : null` form without a cast.
export function updateUrlParams(params: Record<string, string | undefined | null>): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  Object.entries(params).forEach(([key, value]) => {
    if (value == null || value === "") url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  });
  window.history.replaceState({}, "", url.pathname + url.search);
}
