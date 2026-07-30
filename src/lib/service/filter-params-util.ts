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

// `parseFloat(x) || fallback` — the idiom used throughout router.ts — silently
// discards a legitimate 0, since 0 is falsy. That's harmless for the params it
// was written for (each one treats 0 as "unset" anyway), but wrong for any
// signed range whose natural boundary IS zero: /api/model-vs-sp's edge filter is
// exactly that, since `minEdge=0` means "only runners the model rates above the
// market" and `maxEdge=0` means "only the ones it rates below". Under the `||`
// idiom both would silently become the ±100 default and match everything.
export function parseFloatParam(raw: unknown, fallback: number): number {
  const n = parseFloat(raw as string);
  return Number.isFinite(n) ? n : fallback;
}

// Probabilities in this codebase are always whole percentages (0-100), never
// fractions — see IspRunner.modelWinProbability and impliedProbabilityPct.
export function clampPct(n: number): number {
  return Math.min(100, Math.max(0, n));
}

// The widest window /api/model-vs-sp will honour, in days.
//
// This is a LATENCY guard, not a memory one — measured, not assumed. The `edge`
// sort has no index able to serve it (its key is arithmetic over two fields of an
// array subdocument), so the natural worry is the 32MB blocking-sort limit that
// Atlas M0 can't spill to disk around (it silently ignores allowDiskUse). In
// practice that never trips: the pipeline's $sort is immediately followed by
// $skip/$limit, which lets MongoDB use a bounded top-k sort whose memory scales
// with skip+limit rather than with the input, and the pre-sort documents are
// projected down to ~44 bytes first.
//
// scripts/verify-model-vs-sp-pagination-2026-07-30.ts ran the edge sort against
// production at widening windows on 2026-07-30 and none failed, including the
// whole ~970k-runner collection. What does scale, linearly, is time:
//
//     1 month     5,963 runners      106ms
//     3 months   17,596 runners      250ms
//     6 months   43,027 runners      548ms
//    12 months   88,017 runners    1,094ms   <- this cap
//    24 months  174,480 runners    2,128ms
//    all data  970,862 runners   11,452ms
//
// So the cap is set where a cold page load stays around a second. It also happens
// to match the one-calendar-year cap IndustrySpScreen already applies client-side
// (addOneYear), making that a server-enforced invariant for this endpoint, which
// has no clampRowSpan equivalent of its own.
//
// One caveat the measurements above don't cover: they all read page 1. Because
// the top-k buffer grows with skip, a very deep page inside a very wide window
// (say page 2,000 at limit 200) would be a genuinely different shape. The span
// cap bounds how bad that can get.
export const MODEL_VS_SP_MAX_SPAN_DAYS = 366;

// The window /api/model-vs-sp falls back to when given nothing usable. Matches
// IndustrySpScreen's own deliberately-narrow default window (FILTER_DEFAULTS
// there) — a first visit should be fast, not exhaustive.
export const MODEL_VS_SP_DEFAULT_MIN_DATE = "2024-01-01";
export const MODEL_VS_SP_DEFAULT_MAX_DATE = "2024-01-31";

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Always returns a bounded window, unlike parseDateRangeParams (which returns
 * nulls and lets the caller decide) — /api/model-vs-sp cannot safely run
 * unbounded, so "no dates supplied" has to mean the default window rather than
 * "the whole collection". Clamps an over-wide span rather than rejecting it,
 * which is the convention everywhere else in router.ts; the cost is that a
 * shared URL with a hand-edited 5-year range quietly shows one year instead of
 * erroring.
 *
 * Keeps parseDateRangeParams' `T23:59:59.999` maxRaceTime convention so a
 * same-day window still matches that whole day's races (raceTime is a plain ISO
 * string, compared lexicographically).
 */
export function clampModelVsSpDateWindow(
  minDateRaw: unknown,
  maxDateRaw: unknown
): { minRaceTime: string; maxRaceTime: string; minDate: string; maxDate: string } {
  const rawMin = typeof minDateRaw === "string" && DATE_ONLY_RE.test(minDateRaw) ? minDateRaw : null;
  const rawMax = typeof maxDateRaw === "string" && DATE_ONLY_RE.test(maxDateRaw) ? maxDateRaw : null;

  // Both malformed/absent → the default window. Exactly one present → honour it
  // and collapse to that single day, so `?minDate=2025-03-01` isn't silently
  // ignored in favour of an unrelated default range.
  let minDate = rawMin ?? rawMax ?? MODEL_VS_SP_DEFAULT_MIN_DATE;
  let maxDate = rawMax ?? rawMin ?? MODEL_VS_SP_DEFAULT_MAX_DATE;

  // An inverted range is a stale/hand-edited URL, not a request for nothing —
  // swap rather than return an empty window, mirroring how DateRangePicker
  // normalizes a backwards selection client-side.
  if (maxDate < minDate) {
    const swap = minDate;
    minDate = maxDate;
    maxDate = swap;
  }

  const maxAllowed = addDays(minDate, MODEL_VS_SP_MAX_SPAN_DAYS);
  if (maxDate > maxAllowed) maxDate = maxAllowed;

  return { minRaceTime: minDate, maxRaceTime: `${maxDate}T23:59:59.999`, minDate, maxDate };
}
