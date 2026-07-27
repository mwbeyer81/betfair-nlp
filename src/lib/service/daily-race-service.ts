import config from "config";
import { DailyRaceDAO, DailyRaceDoc, mapRacecardToDoc } from "../dao/daily-race-dao";
import { DatabaseConnection } from "../../config/database";
import { RacingApiClient } from "./racing-api-client";

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
}
