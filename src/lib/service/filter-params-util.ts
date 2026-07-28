// Small, dependency-free query-param parsing helpers shared between
// router.ts (raw Express query strings) and saved-filter-set-service.ts's
// computeSnapshotParamsFromFilters (a saved filter set's persisted filters
// map) — kept in one place so a saved filter's snapshot/live params are
// parsed with the exact same rules as the live Filters screen's own
// requests, never a second, silently-drifting implementation.

export function parseDateRangeParams(
  minDateRaw: unknown,
  maxDateRaw: unknown
): { minRaceTime: string | null; maxRaceTime: string | null } {
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const minDate = typeof minDateRaw === "string" && DATE_RE.test(minDateRaw) ? minDateRaw : null;
  const maxDate = typeof maxDateRaw === "string" && DATE_RE.test(maxDateRaw) ? maxDateRaw : null;
  return {
    minRaceTime: minDate,
    maxRaceTime: maxDate ? `${maxDate}T23:59:59.999` : null,
  };
}

// Same comma-joined-list convention already used for `countries`.
export function parseCsvListParam(raw: unknown): string[] {
  return typeof raw === "string"
    ? raw.split(",").map(v => v.trim()).filter(Boolean)
    : [];
}
