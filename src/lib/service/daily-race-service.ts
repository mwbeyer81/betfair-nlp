import config from "config";
import { DailyRaceDAO, DailyRaceDoc, DailyRaceRunnerDoc, mapRacecardToDoc } from "../dao/daily-race-dao";
import { DatabaseConnection } from "../../config/database";
import { RacingApiClient } from "./racing-api-client";
import { PredictionApiClient, PredictionRunnerInput } from "./prediction-api-client";

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

  constructor(dailyRaceDAO?: DailyRaceDAO) {
    if (dailyRaceDAO) {
      this.dailyRaceDAO = dailyRaceDAO;
    } else {
      const db = DatabaseConnection.getInstance().getDb();
      this.dailyRaceDAO = new DailyRaceDAO(db);
    }
  }

  public async createIndexes(): Promise<void> {
    return this.dailyRaceDAO.createIndexes();
  }

  public async getDailyRaces(date: string): Promise<DailyRaceDoc[]> {
    return this.dailyRaceDAO.getRacesByDate(date);
  }

  public async getDailyRacesByEvent(eventId: string): Promise<DailyRaceDoc[]> {
    return this.dailyRaceDAO.getRacesByEventId(eventId);
  }

  public async getDailyRaceById(raceId: string): Promise<DailyRaceDoc | null> {
    return this.dailyRaceDAO.getRaceById(raceId);
  }

  /** Pulls today's racecards from RacingAPI and upserts them. Shared by
   * src/commands/fetch-daily-races.ts (manual CLI run) and the scheduled
   * Lambda ingest (apps/lambda/src/handler.ts) so both paths do the same
   * fetch/map/upsert. Throws on missing credentials or a non-ok RacingAPI
   * response — callers decide how to log/handle.
   *
   * `path` defaults to config `racingApi.racecardsPath` (empty ->
   * "/racecards/free") — flip that one env var once a higher plan is
   * confirmed live (e.g. "/racecards/basic") and both the CLI and the
   * Lambda cron pick it up identically, no code change needed. */
  public async ingestFromRacingApi(
    client: RacingApiClient = new RacingApiClient(),
    path: string = readConfigString("racingApi.racecardsPath") || "/racecards/free"
  ): Promise<number> {
    if (!client.hasCredentials()) {
      throw new Error("RacingAPI credentials not configured (racingApi.username/password)");
    }
    const res = await client.get<{ racecards: Record<string, unknown>[] }>(path);
    if (!res.ok) {
      throw new Error(`RacingAPI returned ${res.status}: ${JSON.stringify(res.body)}`);
    }
    const docs = (res.body.racecards || []).map(mapRacecardToDoc);
    await this.dailyRaceDAO.bulkUpsertRaces(docs);
    return docs.length;
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
    client: PredictionApiClient = new PredictionApiClient()
  ): Promise<{ racesUpdated: number; runnersUpdated: number; errors: { raceId: string; error: string }[] }> {
    const races = await this.dailyRaceDAO.getRacesByDate(date);
    let racesUpdated = 0;
    let runnersUpdated = 0;
    const errors: { raceId: string; error: string }[] = [];
    const updatedRaces: DailyRaceDoc[] = [];

    for (const race of races) {
      const runnerInputs = race.runners.map(runner => toPredictionInput(race, runner));
      const res = await client.predict(runnerInputs);
      if ("error" in res.body) {
        errors.push({ raceId: race.raceId, error: res.body.error });
        continue;
      }
      if (!res.ok) {
        errors.push({ raceId: race.raceId, error: `status ${res.status}` });
        continue;
      }
      const body = res.body;
      const byRunnerId = new Map(body.predictions.map(p => [p.runnerId, p.modelWinProbability]));
      const runners = race.runners.map(runner => ({
        ...runner,
        modelWinProbability: byRunnerId.get(runner.runnerId) ?? runner.modelWinProbability,
        modelVersionId: body.modelVersionId,
      }));
      updatedRaces.push({ ...race, runners });
      racesUpdated++;
      runnersUpdated += runners.length;
    }

    if (updatedRaces.length > 0) {
      await this.dailyRaceDAO.bulkUpsertRaces(updatedRaces);
    }
    return { racesUpdated, runnersUpdated, errors };
  }
}
