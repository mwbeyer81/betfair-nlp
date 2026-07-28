import { DailyRace, DailyRaceRunner } from "../services/chatApi";

// The decimal odds at which backing this runner exactly breaks even against
// the model's own win-probability estimate — 100/probability, the inverse
// of ispFormat.ts's impliedProbabilityPct (which goes odds -> probability;
// this goes probability -> odds). No live market price is needed for this:
// it's purely a statement about the model's own view. Any price offered at
// or above this is a value bet by that view.
export function minValueDecimalOdds(modelWinProbability: number | null | undefined): number | null {
  if (modelWinProbability == null || modelWinProbability <= 0) return null;
  return Math.round((100 / modelWinProbability) * 100) / 100;
}

// Denominators capped at 20 and matched via a "close enough" tolerance
// rather than an exact continued-fraction search — this is a derived
// breakeven price, not a real quoted market price, so a fraction like
// "94/25" would be technically exact but unrecognizable as an odds format.
// A short, plausible-looking fraction (even if not bit-for-bit exact) is
// more useful here; the decimal figure alongside it carries the precision.
const FRACTIONAL_DENOMINATORS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20];
const FRACTION_TOLERANCE = 0.05;

export function decimalToFractionalOdds(decimalOdds: number): string {
  const value = decimalOdds - 1;
  if (value <= 0) return "0/1";

  for (const den of FRACTIONAL_DENOMINATORS) {
    const num = Math.round(value * den);
    if (num <= 0) continue;
    if (Math.abs(value - num / den) <= FRACTION_TOLERANCE) {
      return `${num}/${den}`;
    }
  }

  // Nothing was within tolerance (an unusually precise value) — fall back
  // to whichever ladder denominator gets closest.
  let bestNum = Math.max(1, Math.round(value));
  let bestDen = 1;
  let bestDiff = Math.abs(value - bestNum);
  for (const den of FRACTIONAL_DENOMINATORS) {
    const num = Math.round(value * den);
    if (num <= 0) continue;
    const diff = Math.abs(value - num / den);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestNum = num;
      bestDen = den;
    }
  }
  return `${bestNum}/${bestDen}`;
}

export function formatMinValueOdds(modelWinProbability: number | null | undefined): string | null {
  const decimal = minValueDecimalOdds(modelWinProbability);
  if (decimal == null) return null;
  return `${decimal.toFixed(2)} (${decimalToFractionalOdds(decimal)})`;
}

export interface DailyRacesFilters {
  minModelWinProbability: number;
  trainerFormMinWinRate: number;
  minTrainerFormRunners: number;
  minFieldSize: number;
  maxFieldSize: number;
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
  trainerSearch: "",
  jockeySearch: "",
};

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
