// Filter values for DailyRacesScreen are persisted to the URL query string
// (same pattern as ispUrlParams.ts, whose generic parsers are reused
// directly below) so a filtered view can be bookmarked, shared, or survive
// a refresh. The `date` param DailyRacesScreen already reads is not part of
// this list — it's page-level context set by navigation, not a filter the
// user Applies/Resets.
import { urlIntParam, urlFloatParam, urlStringParam, urlSetParam, updateUrlParams } from "./ispUrlParams";

export { urlIntParam, urlFloatParam, urlStringParam, urlSetParam, updateUrlParams };

const DAILY_RACES_FILTER_PARAM_NAMES = [
  "minModelWinProbability",
  "trainerFormMinWinRate",
  "hasTrainerForm",
  "onlyModelBeatsSp",
  "minFieldSize",
  "maxFieldSize",
  "courses",
  "goings",
  "raceClasses",
  "raceTypes",
  "regions",
  "trainer",
  "jockey",
];

export function dailyRacesUrlHasAnyParams(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return DAILY_RACES_FILTER_PARAM_NAMES.some(name => params.get(name) != null);
}
