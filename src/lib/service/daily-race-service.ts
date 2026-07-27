import { DailyRaceDAO, DailyRaceDoc } from "../dao/daily-race-dao";
import { DatabaseConnection } from "../../config/database";

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
}
