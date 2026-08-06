import { IspRace, IspRunner, PnlStats } from "../services/chatApi";

export type OddsMode = "fraction" | "decimal";

// Industry SP is conventionally quoted as a fraction ("8/15") — that's the
// default display. Decimal is the derived/secondary form, shown rounded to
// 2dp (the value stored in the DB is already rounded at import time, but
// .toFixed(2) here is a defensive belt-and-braces guard against ever
// rendering an unrounded value, e.g. from older cached data).
export function formatIsp(runner: IspRunner, mode: OddsMode): string {
  if (mode === "fraction") return runner.ispFraction ?? (runner.isp != null ? runner.isp.toFixed(2) : "-");
  return runner.isp != null ? runner.isp.toFixed(2) : "-";
}

export function stakeToWin1(isp: number): number {
  return 1 / (isp - 1);
}

export function formatGbp(val: number): string {
  return `£${Math.abs(val).toFixed(2)}`;
}

export function formatPnl(val: number): string {
  return val >= 0 ? `+${formatGbp(val)}` : `-${formatGbp(val)}`;
}

export function formatPct(pnl: number, staked: number): string {
  if (staked === 0) return "";
  const pct = (pnl / staked) * 100;
  return pct >= 0 ? `+${pct.toFixed(1)}%` : `${pct.toFixed(1)}%`;
}

export function computeRangePnl(races: IspRace[]): PnlStats {
  let staked = 0, returns = 0, count = 0;
  for (const race of races) {
    for (const runner of race.runners) {
      if (runner.isp != null && runner.isp > 1) {
        count++;
        const stake = 1 / (runner.isp - 1);
        staked += stake;
        if (runner.status === "WINNER") returns += stake + 1;
      }
    }
  }
  return { staked, returns, pnl: returns - staked, count };
}

// "With model" P&L: same staking math as computeRangePnl, but only counts a
// runner when the model both clears the caller's own confidence threshold
// AND rates it above the market's own implied probability (modelBeatsSp) —
// a runner the model likes less than the market thinks it likes itself
// isn't a model-driven bet, it's just backing the favourite.
export function computeModelFilteredPnl(races: IspRace[], minModelWinProbability: number): PnlStats {
  let staked = 0, returns = 0, count = 0;
  for (const race of races) {
    for (const runner of race.runners) {
      if (
        runner.isp != null &&
        runner.isp > 1 &&
        modelProb(runner) != null &&
        (modelProb(runner) as number) >= minModelWinProbability &&
        modelBeatsSp(runner)
      ) {
        count++;
        const stake = 1 / (runner.isp - 1);
        staked += stake;
        if (runner.status === "WINNER") returns += stake + 1;
      }
    }
  }
  return { staked, returns, pnl: returns - staked, count };
}

// The same qualifying-runner filter dimensions IspRacesScreen.tsx's own
// filter form exposes (minus row-range/date/course-type fields, which don't
// apply to a single already-identified race/meeting).
export interface QualifyingFilterParams {
  minIsp: number;
  maxIsp: number;
  hasTrainerForm: boolean;
  trainerFormMinWinRate: number;
  minModelWinProbability: number;
  onlyModelBeatsSp: boolean;
  // Minimum model-vs-SP edge in percentage POINTS (see modelSpEdge below).
  // > 0 implies onlyModelBeatsSp — a positive required edge is a strictly
  // tighter "beats SP", so the checkbox needn't also be ticked for it to
  // apply. Optional so callers predating this field still typecheck.
  minModelSpEdgePts?: number;
}

// True when at least one qualifying condition is actually active — lets a
// caller distinguish "no filter context, show everything" (e.g. an
// IndustryMeetingScreen/IndustryRaceScreen reached by plain browsing) from
// "narrow to just what this filter selected" (reached from a saved filter's
// Live Performance section).
export function hasActiveQualifyingFilter(p: QualifyingFilterParams): boolean {
  return (
    p.minIsp > 1 ||
    p.maxIsp < 1000 ||
    p.hasTrainerForm ||
    p.minModelWinProbability > 0 ||
    p.onlyModelBeatsSp ||
    (p.minModelSpEdgePts ?? 0) > 0
  );
}

// Same per-runner condition as IspRacesScreen.tsx's own local
// qualifyingRunners() closure (duplicated rather than imported — that
// closure captures component state directly, this is the pure equivalent
// for screens that don't have that state). Checks minIsp/maxIsp directly
// (IspRacesScreen doesn't need to — the /api/industry-sp endpoint it calls
// already pre-filters each race's runners array to the requested isp
// range), since IndustryMeetingScreen/IndustryRaceScreen fetch a specific
// meeting/race by id with no such server-side narrowing.
export function runnerQualifies(r: IspRunner, p: QualifyingFilterParams): boolean {
  if (r.isp == null || r.isp <= 1) return false;
  if (r.isp < p.minIsp || r.isp > p.maxIsp) return false;
  if (p.hasTrainerForm && !(r.trainerFormWinRate != null && r.trainerFormWinRate >= p.trainerFormMinWinRate)) {
    return false;
  }
  if (p.minModelWinProbability > 0 && !((modelProb(r) ?? -1) >= p.minModelWinProbability)) {
    return false;
  }
  if (p.onlyModelBeatsSp && !modelBeatsSp(r)) return false;
  if ((p.minModelSpEdgePts ?? 0) > 0 && !modelBeatsSpBy(r, p.minModelSpEdgePts as number)) return false;
  return true;
}

export function runnerPnl(runner: IspRunner): number | null {
  if (runner.isp == null) return null;
  return runner.status === "WINNER" ? 1 : -stakeToWin1(runner.isp);
}

// isp is decimal odds (stake included), so the probability the market
// itself implies is 1/isp — as a percentage, 100/isp.
export function impliedProbabilityPct(isp: number): number {
  return 100 / isp;
}

// The signed percentage-POINT gap between the model's own win probability and
// the one the runner's industry SP implies (100/isp). Positive means the model
// rates the runner a better chance than the market's price does. null when
// either side is missing — a gap is undefined without both, which is why
// /api/model-vs-sp excludes those runners server-side rather than rendering them
// with a blank column.
//
// The Mongo counterpart is buildModelVsSpRunnerCond in
// src/lib/dao/industry-sp-dao.ts. The two can't share code (one is an expression
// tree), so that DAO's integration test pins both to the same hand-derived
// numbers.
// The model's win probability for a runner, as every filter and badge on this
// screen must read it: the out-of-sample estimate, produced without sight of
// this race's result.
//
// modelWinProbability is deliberately NOT used. On a historical runner it is
// the final refit's in-sample score — fitted on the very race it scored, so it
// already knows the winner, and filtering on it picks winners by construction
// rather than by skill (+4.5% ROI read that way vs -18.8% read honestly; see
// AGENTS.md 2026-08-04). This must stay the same field
// MODEL_PROB_FIELD names in src/lib/dao/industry-sp-dao.ts: the server filters
// the race list on that field, and these helpers decide which runners inside a
// returned race get highlighted, so reading two different fields would leave
// the badges contradicting the list they sit in.
export function modelProb(runner: IspRunner): number | null {
  return runner.modelWinProbabilityOos ?? null;
}

export function modelSpEdge(runner: IspRunner): number | null {
  const prob = modelProb(runner);
  if (prob == null || runner.isp == null || runner.isp <= 0) return null;
  return prob - impliedProbabilityPct(runner.isp);
}

// Always signed, and always suffixed "pts" — the value is a difference of two
// percentages, so a bare "17.2%" would misread as a relative change ("17% more
// likely") rather than the 17-percentage-point gap it actually is.
export function formatEdgePts(edge: number): string {
  return `${edge >= 0 ? "+" : "-"}${Math.abs(edge).toFixed(1)} pts`;
}

// True when the model rates a runner's win chance higher than the market's
// own price implies — a simple "value bet" signal, independent of any
// fixed threshold (unlike minModelWinProbability). Expressed via modelSpEdge so
// the two can never disagree about what "beats SP" means. Note the guard stays
// isp > 0, not the isp > 1 the server-side filter uses: a runner priced at
// exactly 1 can't reach /model-vs-sp at all, so that difference is only ever
// exercised by this function's other callers.
export function modelBeatsSp(runner: IspRunner): boolean {
  const edge = modelSpEdge(runner);
  return edge != null && edge > 0;
}

// modelBeatsSp with a size requirement: the model must rate the runner at
// least minEdgePts percentage POINTS above the market, not merely above it.
// >= (not >) so a filter of "5" includes a runner sitting exactly 5 points
// clear, matching how every other minimum on the Filters screen reads. The
// Mongo counterpart is modelBeatsSpCond() in src/lib/dao/industry-sp-dao.ts.
export function modelBeatsSpBy(runner: IspRunner, minEdgePts: number): boolean {
  if (minEdgePts <= 0) return modelBeatsSp(runner);
  const edge = modelSpEdge(runner);
  return edge != null && edge >= minEdgePts;
}

export function formatRaceTime(isoTime: string): string {
  try {
    return new Date(isoTime).toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/London",
      hour12: false,
    });
  } catch {
    return isoTime;
  }
}

export function formatRaceDate(isoTime: string): string {
  try {
    return new Date(isoTime).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "Europe/London",
    });
  } catch {
    return "";
  }
}

// Sortable Year/Year-Month/Year-Month-Day grouping keys for the ISP races
// screen's collapsible hierarchy — derived via Intl.DateTimeFormat parts
// (not Date.getFullYear()/getMonth(), which read the browser's local
// timezone) so a race just before/after midnight groups by its actual
// Europe/London race day, consistent with formatRaceTime/formatRaceDate.
function londonDateParts(isoTime: string): { year: string; month: string; day: string } {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(isoTime));
    const get = (type: string) => parts.find(p => p.type === type)?.value ?? "";
    return { year: get("year"), month: get("month"), day: get("day") };
  } catch {
    return { year: "", month: "", day: "" };
  }
}

export function raceYearKey(isoTime: string): string {
  return londonDateParts(isoTime).year;
}

export function raceMonthKey(isoTime: string): string {
  const { year, month } = londonDateParts(isoTime);
  return `${year}-${month}`;
}

export function raceDayKey(isoTime: string): string {
  const { year, month, day } = londonDateParts(isoTime);
  return `${year}-${month}-${day}`;
}

export function raceMonthLabel(isoTime: string): string {
  try {
    return new Date(isoTime).toLocaleDateString("en-GB", {
      month: "long",
      year: "numeric",
      timeZone: "Europe/London",
    });
  } catch {
    return "";
  }
}

// Every calendar year a "YYYY-MM-DD" minDate/maxDate range touches, in sort
// order — lets the ISP races screen render a year header for every year the
// applied filter *could* contain, even before any race data for that year
// has actually loaded (see IspRacesScreen's lazy per-year loading).
export function yearsInRange(minDate: string, maxDate: string, order: "asc" | "desc" = "asc"): string[] {
  const minYear = parseInt(minDate.slice(0, 4), 10);
  const maxYear = parseInt(maxDate.slice(0, 4), 10);
  if (!Number.isFinite(minYear) || !Number.isFinite(maxYear) || maxYear < minYear) return [];
  const years: string[] = [];
  for (let y = minYear; y <= maxYear; y++) years.push(String(y));
  return order === "desc" ? years.reverse() : years;
}

// Same idea as yearsInRange, one level down — every "YYYY-MM" a
// minDate/maxDate range touches, in sort order. Used to render a month
// header for every month a given year's own (already-clipped) date span
// could contain, even before any race data for that month has loaded —
// same rationale as yearsInRange, one level down the hierarchy.
export function monthsInRange(minDate: string, maxDate: string, order: "asc" | "desc" = "asc"): string[] {
  const minYear = parseInt(minDate.slice(0, 4), 10);
  const minMonth = parseInt(minDate.slice(5, 7), 10);
  const maxYear = parseInt(maxDate.slice(0, 4), 10);
  const maxMonth = parseInt(maxDate.slice(5, 7), 10);
  if (![minYear, minMonth, maxYear, maxMonth].every(Number.isFinite)) return [];
  const months: string[] = [];
  let y = minYear, m = minMonth;
  while (y < maxYear || (y === maxYear && m <= maxMonth)) {
    months.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return order === "desc" ? months.reverse() : months;
}

// Same idea again, one more level down — every "YYYY-MM-DD" a minDate/maxDate
// range touches, in sort order. Lets IspRacesScreen render a day header for
// every day an expanded month could contain, so the days are visible (and
// individually tappable) before any of their races have loaded — the day is
// the actual fetch unit now, so an unloaded day still needs a row.
//
// Iterates in plain UTC. Every input here is a bare "YYYY-MM-DD" and every
// output is one too, so no local-timezone shift can move a date across a
// boundary — using `new Date("YYYY-MM-DD")` (UTC midnight) plus UTC getters
// keeps that true regardless of where this runs.
export function daysInRange(minDate: string, maxDate: string, order: "asc" | "desc" = "asc"): string[] {
  const start = new Date(`${minDate.slice(0, 10)}T00:00:00Z`);
  const end = new Date(`${maxDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return [];
  const days: string[] = [];
  for (const d = start; d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(
      `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`
    );
  }
  return order === "desc" ? days.reverse() : days;
}

// Builds the same human-readable filter-summary chips PnlConvergencePanel
// shows (see IndustrySpScreen.buildConvergenceFilterSummary) from a raw
// URL-param string map instead of live component state — used by
// SavedResultDetailScreen, whose SavedFilterSet.filters is exactly this
// shape (see the comment on SavedFilterSet in chatApi.ts: "the raw
// ISP_FILTER_PARAM_NAMES string map"). Only params that actually narrow
// the result are included, same "silent unless it did something" rule as
// IndustrySpScreen's own URL-writing (fromRowA/toRowA/fromRowB/toRowB/sort
// deliberately excluded — those describe the split, not a content filter).
export function buildFilterSummaryFromParams(params: Record<string, string>): { key: string; label: string }[] {
  const summary: { key: string; label: string }[] = [];
  if (params.minDate || params.maxDate) {
    summary.push({ key: "date", label: `Date: ${params.minDate ?? "?"} → ${params.maxDate ?? "?"}` });
  }
  if (params.minRunners || params.maxRunners) {
    summary.push({ key: "runners", label: `Runners: ${params.minRunners ?? "?"}–${params.maxRunners ?? "?"}` });
  }
  if (params.minIsp || params.maxIsp) {
    summary.push({ key: "isp", label: `ISP: ${params.minIsp ?? "?"}–${params.maxIsp ?? "?"}` });
  }
  if (params.minInIspRange || params.maxInIspRange) {
    summary.push({ key: "inIspRange", label: `In-range runners: ${params.minInIspRange ?? "?"}–${params.maxInIspRange ?? "?"}` });
  }
  if (params.countries) {
    summary.push({ key: "countries", label: `Countries: ${params.countries.split(",").sort().join(", ")}` });
  }
  if (params.courses) {
    summary.push({ key: "courses", label: `Courses: ${params.courses.split(",").sort().join(", ")}` });
  }
  if (params.goings) {
    summary.push({ key: "goings", label: `Going: ${params.goings.split(",").sort().join(", ")}` });
  }
  if (params.raceClasses) {
    summary.push({ key: "raceClasses", label: `Class: ${params.raceClasses.split(",").sort().join(", ")}` });
  }
  if (params.raceTypes) {
    summary.push({ key: "raceTypes", label: `Type: ${params.raceTypes.split(",").sort().join(", ")}` });
  }
  if (params.trainer) {
    summary.push({ key: "trainer", label: `Trainer: ${params.trainer}` });
  }
  if (params.jockey) {
    summary.push({ key: "jockey", label: `Jockey: ${params.jockey}` });
  }
  if (params.hasTrainerForm === "true") {
    const rate = parseFloat(params.trainerFormMinWinRate ?? "0");
    summary.push({
      key: "trainerForm",
      label: rate > 0 ? `Trainer form: ≥${rate}% win rate` : "Trainer form: has recent form",
    });
  }
  if (params.minModelWinProbability) {
    summary.push({ key: "modelWinProbability", label: `Model win probability: ≥${params.minModelWinProbability}%` });
  }
  const edgePts = parseFloat(params.minModelSpEdgePts ?? "0");
  if (edgePts > 0) {
    summary.push({ key: "modelBeatsSp", label: `Model beats SP by ≥${edgePts} pts` });
  } else if (params.onlyModelBeatsSp === "true") {
    summary.push({ key: "modelBeatsSp", label: "Model beats SP" });
  }
  return summary;
}

// Mirrors the same Flat/Jumps bucketing used server-side in
// src/commands/precompute-trainer-form.ts (toFormCategory there) — kept in
// sync manually since the trainer-form badge's category needs to match
// exactly what the precompute script grouped by. Anything that isn't
// exactly "Flat" (Hurdle, Chase, NH Flat, ...) is Jumps.
export function toFormCategory(raceType: string): "Flat" | "Jumps" {
  return (raceType || "").trim().toLowerCase() === "flat" ? "Flat" : "Jumps";
}
