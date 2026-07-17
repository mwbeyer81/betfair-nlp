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

export function urlToRowParam(paramName: string = "toRow"): number | null {
  const raw = getUrlSearchParams()?.get(paramName);
  if (raw == null) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

export function urlHasParam(name: string): boolean {
  return getUrlSearchParams()?.get(name) != null;
}

export function urlCountriesParam(): Set<string> {
  const raw = getUrlSearchParams()?.get("countries");
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
