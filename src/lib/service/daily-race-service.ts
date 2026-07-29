import config from "config";
import { DailyRaceDAO, DailyRaceDoc, DailyRaceRunnerDoc, mapRacecardToDoc } from "../dao/daily-race-dao";
import { IndustrySpDAO } from "../dao/industry-sp-dao";
import { synthNumericId } from "../dao/industry-sp-row-mapping";
import { DatabaseConnection } from "../../config/database";
import { RacingApiClient } from "./racing-api-client";
import { PredictionApiClient, PredictionRunnerInput } from "./prediction-api-client";

// A runner's real outcome, once industry_starting_prices has captured it —
// never persisted onto daily_racecards itself (see enrichWithResults below),
// only attached to the response each time a race is read. isp/ispFraction
// are the runner's actual Industry SP, the real market price it went off
// at — not the model's own "fair odds" implied price shown pre-race.
export interface DailyRaceResult {
  status: "WINNER" | "PLACED" | "LOSER" | "NON_FINISHER";
  pos: string;
  isp: number | null;
  ispFraction: string | null;
}

export interface DailyRaceRunnerWithResult extends DailyRaceRunnerDoc {
  // null until the race has been captured by the 21:30 UTC results job (or
  // a manual capture run) — same "pending" meaning as before this field
  // existed, not an error/missing-data state.
  result: DailyRaceResult | null;
}

export interface DailyRaceWithResult extends Omit<DailyRaceDoc, "runners"> {
  runners: DailyRaceRunnerWithResult[];
}

function toNum(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toPredictionInput(race: DailyRaceDoc, runner: DailyRaceRunnerDoc): PredictionRunnerInput {
  return {
    raceId: race.raceId,
    runnerId: runner.runnerId,
    course: race.course,
    going: race.going,
    raceType: race.type,
    raceClass: race.raceClass,
    trainer: runner.trainer,
    jockey: runner.jockey,
    sex: runner.sex,
    hg: runner.headgear,
    distanceFurlongs: toNum(race.distanceF),
    ran: toNum(race.fieldSize),
    num: toNum(runner.number),
    draw: toNum(runner.draw),
    trainerFormRuns: runner.trainerFormRuns,
    trainerFormWinRate: runner.trainerFormWinRate,
    trainerFormStaked: runner.trainerFormStaked,
    trainerFormReturns: runner.trainerFormReturns,
    jockeyFormRuns: runner.jockeyFormRuns,
    jockeyFormWinRate: runner.jockeyFormWinRate,
    jockeyFormStaked: runner.jockeyFormStaked,
    jockeyFormReturns: runner.jockeyFormReturns,
    officialRating: toNum(runner.officialRating),
    wgt: toNum(runner.lbs),
    age: toNum(runner.age),
    daysSinceLastRun: runner.daysSinceLastRun,
    horseCareerRuns: runner.horseCareerRuns,
    horseCareerWinRate: runner.horseCareerWinRate,
    horseAvgRPR: runner.horseAvgRPR,
    horseAvgTS: runner.horseAvgTS,
    horseAvgBeatenDistance: runner.horseAvgBeatenDistance,
    horseAvgExcuseScore: runner.horseAvgExcuseScore,
    horseTroubleInRunningRate: runner.horseTroubleInRunningRate,
    horseTravelledWellRate: runner.horseTravelledWellRate,
  };
}

function readConfigString(key: string): string {
  try {
    const value = config.get<string>(key);
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

export class DailyRaceService {
  private dailyRaceDAO: DailyRaceDAO;
  private industrySpDAO: IndustrySpDAO;

  constructor(dailyRaceDAO?: DailyRaceDAO, industrySpDAO?: IndustrySpDAO) {
    if (dailyRaceDAO) {
      this.dailyRaceDAO = dailyRaceDAO;
    } else {
      const db = DatabaseConnection.getInstance().getDb();
      this.dailyRaceDAO = new DailyRaceDAO(db);
    }
    if (industrySpDAO) {
      this.industrySpDAO = industrySpDAO;
    } else {
      const db = DatabaseConnection.getInstance().getDb();
      this.industrySpDAO = new IndustrySpDAO(db);
    }
  }

  public async createIndexes(): Promise<void> {
    return this.dailyRaceDAO.createIndexes();
  }

  /** Attaches each runner's real result (see DailyRaceResult above) by
   * batch-joining this set of races against industry_starting_prices via
   * IndustrySpDAO.getResultsForRaceIds — one query total regardless of how
   * many races are passed in, not one per race. A race with no matching
   * result doc yet (not run, or not yet captured by the daily batch job)
   * leaves every one of its runners' result: null. */
  private async enrichWithResults(races: DailyRaceDoc[]): Promise<DailyRaceWithResult[]> {
    const resultsByRaceId = await this.industrySpDAO.getResultsForRaceIds(races.map(r => r.raceId));
    return races.map(race => {
      const resultDoc = resultsByRaceId.get(race.raceId);
      const runners: DailyRaceRunnerWithResult[] = race.runners.map(runner => {
        const resultRunner = resultDoc?.runners.find(
          r => r.id === synthNumericId(`${race.raceId}:${runner.runnerId}`)
        );
        return {
          ...runner,
          result: resultRunner
            ? { status: resultRunner.status, pos: resultRunner.pos, isp: resultRunner.isp, ispFraction: resultRunner.ispFraction }
            : null,
        };
      });
      return { ...race, runners };
    });
  }

  public async getDailyRaces(date: string): Promise<DailyRaceWithResult[]> {
    const races = await this.dailyRaceDAO.getRacesByDate(date);
    return this.enrichWithResults(races);
  }

  public async getDailyRacesByEvent(eventId: string): Promise<DailyRaceWithResult[]> {
    const races = await this.dailyRaceDAO.getRacesByEventId(eventId);
    return this.enrichWithResults(races);
  }

  public async getDailyRaceById(raceId: string): Promise<DailyRaceWithResult | null> {
    const race = await this.dailyRaceDAO.getRaceById(raceId);
    if (!race) return null;
    const [enriched] = await this.enrichWithResults([race]);
    return enriched;
  }

  /** Pulls today's racecards from RacingAPI and upserts them. Shared by
   * src/commands/fetch-daily-races.ts (manual CLI run) and the scheduled
   * Lambda ingest (apps/lambda/src/handler.ts) so both paths do the same
   * fetch/map/upsert. Throws on missing credentials or a non-ok RacingAPI
   * response — callers decide how to log/handle.
   *
   * Daily Races is a UK-only feature — non-GB racecards (RacingAPI's free
   * feed returns France/Ireland/etc. alongside GB) are filtered out before
   * upserting, same `region !== "GB"` convention already used by
   * IndustrySpResultsCaptureService.captureTodayResults for the results
   * side of this same feed.
   *
   * `path` defaults to config `racingApi.racecardsPath` (empty ->
   * "/racecards/free") — flip that one env var once a higher plan is
   * confirmed live (e.g. "/racecards/basic") and both the CLI and the
   * Lambda cron pick it up identically, no code change needed. */
  public async ingestFromRacingApi(
    client: RacingApiClient = new RacingApiClient(),
    path: string = readConfigString("racingApi.racecardsPath") || "/racecards/free"
  ): Promise<{ racesUpserted: number; nonGbSkipped: number }> {
    if (!client.hasCredentials()) {
      throw new Error("RacingAPI credentials not configured (racingApi.username/password)");
    }
    const res = await client.get<{ racecards: Record<string, unknown>[] }>(path);
    if (!res.ok) {
      throw new Error(`RacingAPI returned ${res.status}: ${JSON.stringify(res.body)}`);
    }
    const rawRacecards = res.body.racecards || [];
    let nonGbSkipped = 0;
    const docs: DailyRaceDoc[] = [];
    for (const rawRacecard of rawRacecards) {
      if (rawRacecard.region !== "GB") {
        nonGbSkipped++;
        continue;
      }
      docs.push(mapRacecardToDoc(rawRacecard));
    }
    await this.dailyRaceDAO.bulkUpsertRaces(docs);
    return { racesUpserted: docs.length, nonGbSkipped };
  }

  /** Scores a date's already-ingested, already-feature-computed races via
   * the internal ml-prediction-api Lambda (apps/ml-api) — an on-demand
   * alternative to running ml/predict_daily_races.py by hand. Requires
   * daily-race-feature-service.ts's compute step to have already run for
   * this date (trailing-form fields non-null) — this method doesn't
   * compute or fetch historical form itself, only sends whatever's
   * already on each runner. One InvokeCommand per race, matching how
   * ml/predict_daily_races.py normalizes probabilities within a single
   * race — each race must be scored as a complete group. Throws on a
   * client-level failure (missing credentials/permissions, bad payload);
   * per-race prediction failures are collected and returned rather than
   * aborting the whole date. */
  public async predictDailyRaces(
    date: string,
    client: PredictionApiClient = new PredictionApiClient(),
    concurrency = 8
  ): Promise<{ racesUpdated: number; runnersUpdated: number; errors: { raceId: string; error: string }[] }> {
    const races = await this.dailyRaceDAO.getRacesByDate(date);
    let racesUpdated = 0;
    let runnersUpdated = 0;
    const errors: { raceId: string; error: string }[] = [];

    const predictOne = async (race: DailyRaceDoc): Promise<DailyRaceDoc | null> => {
      const runnerInputs = race.runners.map(runner => toPredictionInput(race, runner));
      const res = await client.predict(runnerInputs);
      if ("error" in res.body) {
        errors.push({ raceId: race.raceId, error: res.body.error });
        return null;
      }
      if (!res.ok) {
        errors.push({ raceId: race.raceId, error: `status ${res.status}` });
        return null;
      }
      const body = res.body;
      const byRunnerId = new Map(body.predictions.map(p => [p.runnerId, p]));
      const runners = race.runners.map(runner => {
        const prediction = byRunnerId.get(runner.runnerId);
        return {
          ...runner,
          modelWinProbability: prediction?.modelWinProbability ?? runner.modelWinProbability,
          modelVersionId: body.modelVersionId,
          modelTopFactors: prediction?.topFactors ?? runner.modelTopFactors ?? null,
        };
      });
      return { ...race, runners };
    };

    // Chunked concurrency (not one giant Promise.all — ml-prediction-api
    // is a single Lambda whose own concurrency/cold-start behavior we
    // don't want to hammer all at once) + a write after every chunk
    // (not one bulkUpsertRaces at the very end) — races are large
    // (~40-50/day) and each prediction is a real network round-trip, so a
    // timeout partway through used to mean zero races got scored at all,
    // even ones already completed. Now completed chunks persist regardless
    // of what happens to later ones.
    for (let i = 0; i < races.length; i += concurrency) {
      const chunk = races.slice(i, i + concurrency);
      const results = await Promise.all(chunk.map(predictOne));
      const updated = results.filter((r): r is DailyRaceDoc => r !== null);
      if (updated.length > 0) {
        await this.dailyRaceDAO.bulkUpsertRaces(updated);
        racesUpdated += updated.length;
        runnersUpdated += updated.reduce((sum, r) => sum + r.runners.length, 0);
      }
    }

    return { racesUpdated, runnersUpdated, errors };
  }
}
