import { DailyRace, DailyRaceRunner } from "../services/chatApi";

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
