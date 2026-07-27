import { DailyRaceDAO, DailyRaceDoc, mapRacecardToDoc } from "../dao/daily-race-dao";
import { DatabaseConnection } from "../../config/database";
import { RacingApiClient } from "./racing-api-client";

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

  /** Pulls today's racecards from RacingAPI's Free-plan /racecards/free
   * endpoint and upserts them. Shared by src/commands/fetch-daily-races.ts
   * (manual CLI run) and the scheduled Lambda ingest (apps/lambda/src/handler.ts)
   * so both paths do the same fetch/map/upsert. Throws on missing
   * credentials or a non-ok RacingAPI response — callers decide how to log/handle. */
  public async ingestFromRacingApi(client: RacingApiClient = new RacingApiClient()): Promise<number> {
    if (!client.hasCredentials()) {
      throw new Error("RacingAPI credentials not configured (racingApi.username/password)");
    }
    const res = await client.get<{ racecards: Record<string, unknown>[] }>("/racecards/free");
    if (!res.ok) {
      throw new Error(`RacingAPI returned ${res.status}: ${JSON.stringify(res.body)}`);
    }
    const docs = (res.body.racecards || []).map(mapRacecardToDoc);
    await this.dailyRaceDAO.bulkUpsertRaces(docs);
    return docs.length;
  }
}
