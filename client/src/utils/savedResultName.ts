// Client-side preview of the name a saved Result will get if the user
// leaves the Save dialog's name field blank. Mirrors
// src/lib/service/saved-filter-set-service.ts's buildAutoName() exactly —
// this repo has no shared code path between src/ and client/src/, so the
// backend is the authoritative implementation; this is purely a preview,
// never sent to the server itself.
const AUTO_NAME_FIELD_ORDER = ["courses", "raceTypes", "goings", "raceClasses", "countries"] as const;

function firstNonEmptyFilterValue(filters: Record<string, string>): string | null {
  for (const key of AUTO_NAME_FIELD_ORDER) {
    const value = filters[key]?.trim();
    if (value) return value.split(",")[0];
  }
  return null;
}

export function buildAutoResultNamePreview(filters: Record<string, string>): string {
  const dateRange =
    filters.minDate && filters.maxDate
      ? filters.minDate === filters.maxDate
        ? filters.minDate
        : `${filters.minDate} to ${filters.maxDate}`
      : new Date().toISOString().slice(0, 10);
  const descriptor = firstNonEmptyFilterValue(filters) ?? "All races";
  return `${descriptor} · ${dateRange}`;
}
