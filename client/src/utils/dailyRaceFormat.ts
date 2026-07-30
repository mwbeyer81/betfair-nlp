import { DailyRace, DailyRaceResult, DailyRaceRunner, PnlStats } from "../services/chatApi";
import { impliedProbabilityPct } from "./ispFormat";

// Plain "YYYY-MM-DD" date-string helpers for Prev/Next Day navigation —
// deliberately UTC throughout (matches the backend's own default-date
// convention, GET /api/daily-races's `new Date().toISOString().slice(0,10)`)
// so a UK user just either side of midnight never sees the picker's
// "today" disagree with what the server actually queried for.
export function todayUtcDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

export function shiftDateString(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function formatDailyRacesDateLabel(iso: string): string {
  try {
    return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  } catch {
    return iso;
  }
}

export interface DailyRacesFilters {
  minModelWinProbability: number;
  trainerFormMinWinRate: number;
  minTrainerFormRunners: number;
  minFieldSize: number;
  maxFieldSize: number;
  // Narrows to only picks that have both finished AND beat their real
  // starting price (see dailyRacePickBeatsSp) — matches the "beats SP"
  // condition ISP saved filters already use, but can only ever apply to
  // picks that have already run (Daily Races has no live bookmaker odds
  // feed pre-race, so there's nothing to check a still-upcoming pick
  // against). A still-pending pick is excluded while this is on, not shown
  // as an exception — same "only count what we can actually verify" rule
  // as dailyRacePickPnl/computeDailyPicksPnl.
  onlyModelBeatsSp: boolean;
  selectedCourses: Set<string>;
  selectedGoings: Set<string>;
  selectedRaceClasses: Set<string>;
  selectedRaceTypes: Set<string>;
  selectedRegions: Set<string>;
  trainerSearch: string;
  jockeySearch: string;
}

export const DAILY_RACES_FILTER_DEFAULTS: Omit<
  DailyRacesFilters,
  "selectedCourses" | "selectedGoings" | "selectedRaceClasses" | "selectedRaceTypes" | "selectedRegions"
> = {
  minModelWinProbability: 0,
  trainerFormMinWinRate: 0,
  minTrainerFormRunners: 0,
  minFieldSize: 1,
  maxFieldSize: 40,
  onlyModelBeatsSp: false,
  trainerSearch: "",
  jockeySearch: "",
};

// True when this pick's model confidence rated it higher than its own real
// starting price implied — i.e. it would have qualified as a "value bet"
// under the same rule ISP screens' onlyModelBeatsSp/modelBeatsSp use (see
// ispFormat.ts). Returns null (not false) when we can't tell yet — no
// result/ISP captured, or no model probability at all — so callers can
// distinguish "confirmed not a value bet" from "unknown, still pending".
export function dailyRacePickBeatsSp(runner: DailyRaceRunner): boolean | null {
  if (runner.modelWinProbability == null) return null;
  if (!runner.result || runner.result.isp == null || runner.result.isp <= 0) return null;
  return runner.modelWinProbability > impliedProbabilityPct(runner.result.isp);
}

function matchesChipSet(selected: Set<string>, value: string | null): boolean {
  return selected.size === 0 || (value != null && selected.has(value));
}

function matchesPrefixSearch(search: string, value: string | null): boolean {
  if (search.trim() === "") return true;
  if (value == null) return false;
  return value.toLowerCase().startsWith(search.trim().toLowerCase());
}

export function matchesDailyRaceFilters(
  race: DailyRace,
  runner: DailyRaceRunner,
  filters: DailyRacesFilters
): boolean {
  if (runner.modelWinProbability == null || runner.modelWinProbability < filters.minModelWinProbability) {
    return false;
  }
  if (filters.minTrainerFormRunners > 0) {
    if (runner.trainerFormRuns == null || runner.trainerFormRuns < filters.minTrainerFormRunners) return false;
  }
  if (filters.trainerFormMinWinRate > 0) {
    if (runner.trainerFormWinRate == null || runner.trainerFormWinRate < filters.trainerFormMinWinRate) return false;
  }
  if (filters.onlyModelBeatsSp && dailyRacePickBeatsSp(runner) !== true) return false;
  const fieldSize = race.fieldSize != null ? parseInt(race.fieldSize, 10) : null;
  if (fieldSize != null && Number.isFinite(fieldSize)) {
    if (fieldSize < filters.minFieldSize || fieldSize > filters.maxFieldSize) return false;
  }
  if (!matchesChipSet(filters.selectedCourses, race.course)) return false;
  if (!matchesChipSet(filters.selectedGoings, race.going)) return false;
  if (!matchesChipSet(filters.selectedRaceClasses, race.raceClass)) return false;
  if (!matchesChipSet(filters.selectedRaceTypes, race.type)) return false;
  if (!matchesChipSet(filters.selectedRegions, race.region)) return false;
  if (!matchesPrefixSearch(filters.trainerSearch, runner.trainer)) return false;
  if (!matchesPrefixSearch(filters.jockeySearch, runner.jockey)) return false;
  return true;
}

export interface DailyRacePick {
  race: DailyRace;
  runner: DailyRaceRunner;
}

export function buildDailyRacesPicks(races: DailyRace[], filters: DailyRacesFilters): DailyRacePick[] {
  const picks: DailyRacePick[] = [];
  for (const race of races) {
    for (const runner of race.runners) {
      if (matchesDailyRaceFilters(race, runner, filters)) {
        picks.push({ race, runner });
      }
    }
  }
  return picks;
}

// Mirrors ispFormat.ts's stakeToWin1/runnerPnl — same £1-to-win staking
// convention (stake sized so a win nets exactly £1 profit) — applied here to
// a DailyRaceResult rather than a full IspRunner (a different payload
// shape, same math, so duplicated rather than shared). A runner with no
// valid ISP (isp == null or <= 1 — e.g. a non-finisher) is excluded from
// PnL entirely, same as every ISP screen's own qualifying-runner filter,
// not treated as a £0 result.
export function dailyRacePickPnl(result: DailyRaceResult): number | null {
  if (result.isp == null || result.isp <= 1) return null;
  return result.status === "WINNER" ? 1 : -(1 / (result.isp - 1));
}

export function dailyRacePickResultLabel(result: DailyRaceResult): "Won" | "Lost" | "Non-finisher" {
  if (result.status === "NON_FINISHER") return "Non-finisher";
  return result.status === "WINNER" ? "Won" : "Lost";
}

// Total staked/returns/pnl across every pick that has a resulted, valid-ISP
// runner (same "excluded, not £0" rule as dailyRacePickPnl/ispFormat.ts's
// computeRangePnl) — mirrors that function's shape/math exactly, just
// sourced from DailyRacePick[]/result instead of IspRace[]/runner directly.
// count is how many picks actually contributed, so the UI can show e.g.
// "8 resulted" alongside the total for a 19-pick list still mostly pending.
export function computeDailyPicksPnl(picks: DailyRacePick[]): PnlStats {
  let staked = 0, returns = 0, count = 0;
  for (const { runner } of picks) {
    const result = runner.result;
    if (!result || result.isp == null || result.isp <= 1) continue;
    count++;
    const stake = 1 / (result.isp - 1);
    staked += stake;
    if (result.status === "WINNER") returns += stake + 1;
  }
  return { staked, returns, pnl: returns - staked, count };
}
