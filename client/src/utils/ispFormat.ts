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
        runner.modelWinProbability != null &&
        runner.modelWinProbability >= minModelWinProbability &&
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

export function runnerPnl(runner: IspRunner): number | null {
  if (runner.isp == null) return null;
  return runner.status === "WINNER" ? 1 : -stakeToWin1(runner.isp);
}

// isp is decimal odds (stake included), so the probability the market
// itself implies is 1/isp — as a percentage, 100/isp.
export function impliedProbabilityPct(isp: number): number {
  return 100 / isp;
}

// True when the model rates a runner's win chance higher than the market's
// own price implies — a simple "value bet" signal, independent of any
// fixed threshold (unlike minModelWinProbability).
export function modelBeatsSp(runner: IspRunner): boolean {
  if (runner.modelWinProbability == null || runner.isp == null || runner.isp <= 0) return false;
  return runner.modelWinProbability > impliedProbabilityPct(runner.isp);
}

export function formatRaceTime(isoTime: string): string {
  try {
    return new Date(isoTime).toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/London",
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
  if (params.onlyModelBeatsSp === "true") {
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
