import { TrainerFormDAO, TrainerFormDoc, TrainerFormCategory } from "../dao/trainer-form-dao";
import { DatabaseConnection } from "../../config/database";

export class TrainerFormService {
  private trainerFormDAO: TrainerFormDAO;

  constructor(trainerFormDAO?: TrainerFormDAO) {
    if (trainerFormDAO) {
      this.trainerFormDAO = trainerFormDAO;
    } else {
      const db = DatabaseConnection.getInstance().getDb();
      this.trainerFormDAO = new TrainerFormDAO(db);
    }
  }

  public async createIndexes(): Promise<void> {
    return this.trainerFormDAO.createIndexes();
  }

  public async getTrainerForm(trainer: string, formCategory: TrainerFormCategory): Promise<TrainerFormDoc | null> {
    return this.trainerFormDAO.getTrainerForm(trainer, formCategory);
  }
}
