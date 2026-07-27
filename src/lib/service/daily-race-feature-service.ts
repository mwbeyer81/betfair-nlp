import { Db } from "mongodb";
import { DailyRaceDAO, DailyRaceDoc, DailyRaceRunnerDoc } from "../dao/daily-race-dao";
import { tagComment } from "../dao/comment-lexicon";

// Computes the SAME trailing-form features src/commands/precompute-trainer-form.ts
// / precompute-jockey-form.ts / precompute-horse-form.ts compute for real
// historical races, but for TODAY's daily_racecards runners — read-only
// against industry_starting_prices (the real historical/training
// collection), writing only onto daily_racecards.
//
// Deliberately NOT a full chronological replay like the three precompute
// scripts (those stream the entire collection once to build form "as of"
// every historical race simultaneously) — today's daily card only needs
// "as of today" snapshots for a small set of trainers/jockeys/horses, so
// this issues one targeted query per unique entity instead.
//
// industry_starting_prices is NEVER written to by this module — inserting
// today's unresolved races there would corrupt the next real model
// retrain (every runner would get label=0, since none has a real result
// yet). This boundary is load-bearing, not incidental.
//
// Known limitation (matches precompute-horse-form.ts's own existing
// behavior, not a regression): the horse-name join is exact string match,
// no normalization. If RacingAPI's `horse` field format differs from the
// historical CSV's (e.g. country-suffix conventions), the join silently
// returns "no prior history" rather than erroring — see
// scripts/live-verify-daily-race-features.ts for match-rate visibility.

const INDUSTRY_SP_COLLECTION = "industry_starting_prices";
const FORM_WINDOW_DAYS = 14;
const RECENT_FORM_RUNS = 3;

export type FormCategory = "Flat" | "Jumps";

export function toFormCategory(raceType: string | null | undefined): FormCategory {
  return (raceType || "").trim().toLowerCase() === "flat" ? "Flat" : "Jumps";
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export interface TrainerJockeyHistoricalRun {
  raceDate: string; // "YYYY-MM-DD"
  isp: number | null;
  status: string;
}

export interface TrailingFormStats {
  runs: number;
  wins: number;
  winRate: number | null;
  staked: number;
  returns: number;
}

// Byte-for-byte the same math as precompute-trainer-form.ts/precompute-jockey-form.ts's
// Phase A computation — 14-calendar-day trailing window, strictly earlier
// than asOfDate. `history` can be any-order, unfiltered; the window
// boundary is enforced here so it's independently unit-testable (a run
// exactly windowDays back is included, windowDays+1 is not).
export function computeTrailingFormStats(
  history: TrainerJockeyHistoricalRun[],
  asOfDate: string,
  windowDays: number = FORM_WINDOW_DAYS
): TrailingFormStats {
  const windowStart = addDays(asOfDate, -windowDays);
  const priorRuns = history.filter(h => h.raceDate >= windowStart && h.raceDate < asOfDate);
  const validPrior = priorRuns.filter(h => h.isp !== null && h.isp > 1);
  const wins = priorRuns.filter(h => h.status === "WINNER").length;
  return {
    runs: priorRuns.length,
    wins,
    winRate: priorRuns.length > 0 ? (wins / priorRuns.length) * 100 : null,
    staked: validPrior.reduce((sum, h) => sum + 1 / (h.isp! - 1), 0),
    returns: validPrior.reduce((sum, h) => sum + (h.status === "WINNER" ? 1 / (h.isp! - 1) + 1 : 0), 0),
  };
}

export interface HorseHistoricalRun {
  raceDate: string;
  status: string;
  rpr: number | null;
  ts: number | null;
  beatenDistance: number | null;
  comment: string | null;
}

export interface HorseFormStats {
  daysSinceLastRun: number | null;
  horseCareerRuns: number;
  horseCareerWinRate: number | null;
  horseAvgRPR: number | null;
  horseAvgTS: number | null;
  horseAvgBeatenDistance: number | null;
  horseAvgExcuseScore: number | null;
  horseTroubleInRunningRate: number | null;
  horseTravelledWellRate: number | null;
}

function daysBetween(fromDateStr: string, toDateStr: string): number {
  const from = new Date(`${fromDateStr}T00:00:00Z`).getTime();
  const to = new Date(`${toDateStr}T00:00:00Z`).getTime();
  return Math.round((to - from) / (1000 * 60 * 60 * 24));
}

// Byte-for-byte the same math as precompute-horse-form.ts's Phase A
// computation — all-time career stats, last-`recentFormRuns` averages for
// RPR/TS/beaten-distance/comment-derived fields. `history` can be
// any-order/unfiltered; sorted and windowed here.
export function computeHorseFormStats(
  history: HorseHistoricalRun[],
  asOfDate: string,
  recentFormRuns: number = RECENT_FORM_RUNS
): HorseFormStats {
  const priorRuns = history
    .filter(h => h.raceDate < asOfDate)
    .slice()
    .sort((a, b) => (a.raceDate < b.raceDate ? -1 : a.raceDate > b.raceDate ? 1 : 0));

  const daysSinceLastRun =
    priorRuns.length > 0 ? daysBetween(priorRuns[priorRuns.length - 1].raceDate, asOfDate) : null;
  const wins = priorRuns.filter(h => h.status === "WINNER").length;
  const horseCareerRuns = priorRuns.length;
  const horseCareerWinRate = priorRuns.length > 0 ? (wins / priorRuns.length) * 100 : null;

  const recentRuns = priorRuns.slice(-recentFormRuns);
  const horseAvgRPR = mean(recentRuns.map(h => h.rpr).filter((v): v is number => v !== null));
  const horseAvgTS = mean(recentRuns.map(h => h.ts).filter((v): v is number => v !== null));
  const horseAvgBeatenDistance = mean(
    recentRuns.map(h => h.beatenDistance).filter((v): v is number => v !== null)
  );

  const tagged = recentRuns.map(h => tagComment(h.comment));
  const runsWithComment = tagged.filter(t => t.excuseScore !== null);
  const horseAvgExcuseScore = mean(runsWithComment.map(t => t.excuseScore as number));
  const horseTroubleInRunningRate =
    runsWithComment.length > 0
      ? (runsWithComment.filter(t => t.hasTroubleInRunning).length / runsWithComment.length) * 100
      : null;
  const horseTravelledWellRate =
    runsWithComment.length > 0
      ? (runsWithComment.filter(t => t.hasTravelledWell).length / runsWithComment.length) * 100
      : null;

  return {
    daysSinceLastRun,
    horseCareerRuns,
    horseCareerWinRate,
    horseAvgRPR,
    horseAvgTS,
    horseAvgBeatenDistance,
    horseAvgExcuseScore,
    horseTroubleInRunningRate,
    horseTravelledWellRate,
  };
}

interface HistoricalRunnerRow {
  trainer?: string;
  jockey?: string;
  name?: string;
  isp: number | null;
  status: string;
  rpr: number | null;
  ts: number | null;
  beatenDistance: number | null;
  comment: string | null;
}
interface HistoricalRaceRow {
  raceDate: string;
  raceType: string;
  runners: HistoricalRunnerRow[];
}

async function fetchTrainerOrJockeyHistory(
  db: Db,
  field: "trainer" | "jockey",
  name: string,
  today: string
): Promise<TrainerJockeyHistoricalRun[]> {
  const races = await db
    .collection<HistoricalRaceRow>(INDUSTRY_SP_COLLECTION)
    .find({ [`runners.${field}`]: name, raceDate: { $lt: today } }, { projection: { raceDate: 1, raceType: 1, runners: 1 } })
    .toArray();
  const runs: TrainerJockeyHistoricalRun[] = [];
  for (const race of races) {
    for (const runner of race.runners) {
      if (runner[field] === name) {
        runs.push({ raceDate: race.raceDate, isp: runner.isp, status: runner.status });
      }
    }
  }
  return runs;
}

async function fetchHorseHistory(db: Db, horseName: string, today: string): Promise<HorseHistoricalRun[]> {
  const races = await db
    .collection<HistoricalRaceRow>(INDUSTRY_SP_COLLECTION)
    .find({ "runners.name": horseName, raceDate: { $lt: today } }, { projection: { raceDate: 1, runners: 1 } })
    .toArray();
  const runs: HorseHistoricalRun[] = [];
  for (const race of races) {
    for (const runner of race.runners) {
      if (runner.name === horseName) {
        runs.push({
          raceDate: race.raceDate,
          status: runner.status,
          rpr: runner.rpr,
          ts: runner.ts,
          beatenDistance: runner.beatenDistance,
          comment: runner.comment,
        });
      }
    }
  }
  return runs;
}

export interface ComputeDailyRaceFeaturesResult {
  racesUpdated: number;
  runnersUpdated: number;
  horsesMatched: number;
  horsesTotal: number;
}

// Reads today's daily_racecards, computes trailing trainer/jockey/horse
// form by querying industry_starting_prices (read-only), writes the
// results back onto daily_racecards only.
export async function computeDailyRaceFeatures(
  db: Db,
  date: string,
  dailyRaceDAO: DailyRaceDAO = new DailyRaceDAO(db)
): Promise<ComputeDailyRaceFeaturesResult> {
  const races = await dailyRaceDAO.getRacesByDate(date);

  const trainerCache = new Map<string, TrailingFormStats>();
  const jockeyCache = new Map<string, TrailingFormStats>();
  const horseCache = new Map<string, HorseFormStats>();
  let horsesMatched = 0;
  const horseNames = new Set<string>();

  for (const race of races) {
    const category = toFormCategory(race.type);
    for (const runner of race.runners) {
      if (runner.trainer) {
        const key = `${runner.trainer}|${category}`;
        if (!trainerCache.has(key)) {
          const history = await fetchTrainerOrJockeyHistory(db, "trainer", runner.trainer, date);
          trainerCache.set(key, computeTrailingFormStats(history, date));
        }
      }
      if (runner.jockey) {
        const key = `${runner.jockey}|${category}`;
        if (!jockeyCache.has(key)) {
          const history = await fetchTrainerOrJockeyHistory(db, "jockey", runner.jockey, date);
          jockeyCache.set(key, computeTrailingFormStats(history, date));
        }
      }
      if (runner.horse && !horseCache.has(runner.horse)) {
        horseNames.add(runner.horse);
        const history = await fetchHorseHistory(db, runner.horse, date);
        if (history.length > 0) horsesMatched++;
        horseCache.set(runner.horse, computeHorseFormStats(history, date));
      }
    }
  }

  let runnersUpdated = 0;
  const now = new Date().toISOString();
  const updatedRaces: DailyRaceDoc[] = races.map(race => {
    const category = toFormCategory(race.type);
    const runners: DailyRaceRunnerDoc[] = race.runners.map(runner => {
      const trainerStats = runner.trainer ? trainerCache.get(`${runner.trainer}|${category}`) : undefined;
      const jockeyStats = runner.jockey ? jockeyCache.get(`${runner.jockey}|${category}`) : undefined;
      const horseStats = runner.horse ? horseCache.get(runner.horse) : undefined;
      runnersUpdated++;
      return {
        ...runner,
        trainerFormRuns: trainerStats?.runs ?? null,
        trainerFormWins: trainerStats?.wins ?? null,
        trainerFormWinRate: trainerStats?.winRate ?? null,
        trainerFormStaked: trainerStats?.staked ?? null,
        trainerFormReturns: trainerStats?.returns ?? null,
        jockeyFormRuns: jockeyStats?.runs ?? null,
        jockeyFormWins: jockeyStats?.wins ?? null,
        jockeyFormWinRate: jockeyStats?.winRate ?? null,
        jockeyFormStaked: jockeyStats?.staked ?? null,
        jockeyFormReturns: jockeyStats?.returns ?? null,
        daysSinceLastRun: horseStats?.daysSinceLastRun ?? null,
        horseCareerRuns: horseStats?.horseCareerRuns ?? null,
        horseCareerWinRate: horseStats?.horseCareerWinRate ?? null,
        horseAvgRPR: horseStats?.horseAvgRPR ?? null,
        horseAvgTS: horseStats?.horseAvgTS ?? null,
        horseAvgBeatenDistance: horseStats?.horseAvgBeatenDistance ?? null,
        horseAvgExcuseScore: horseStats?.horseAvgExcuseScore ?? null,
        horseTroubleInRunningRate: horseStats?.horseTroubleInRunningRate ?? null,
        horseTravelledWellRate: horseStats?.horseTravelledWellRate ?? null,
        featuresComputedAt: now,
      };
    });
    return { ...race, runners };
  });

  await dailyRaceDAO.bulkUpsertRaces(updatedRaces);

  return { racesUpdated: updatedRaces.length, runnersUpdated, horsesMatched, horsesTotal: horseNames.size };
}
