import { Collection, Db } from "mongodb";

export type TrainerFormCategory = "Flat" | "Jumps";

export type TrainerFormRunStatus = "WINNER" | "PLACED" | "LOSER" | "NON_FINISHER";

export interface TrainerFormRunDoc {
  raceId: number;
  runnerId: number;
  horseName: string;
  raceDate: string; // "YYYY-MM-DD"
  course: string;
  status: TrainerFormRunStatus;
  pos: string;
  isp: number | null;
}

export interface TrainerFormDoc {
  trainer: string;
  formCategory: TrainerFormCategory;
  runs: TrainerFormRunDoc[]; // ascending chronological by raceDate
  totalRuns: number;
  totalWins: number;
  lastUpdated: string; // ISO timestamp of the precompute run that wrote this doc
}

/**
 * Read-only access to the trainer_form collection, built by
 * src/commands/precompute-trainer-form.ts. Not wired to any API endpoint
 * yet — this is groundwork for a future per-trainer drill-down view; the
 * per-runner trainerForm* summary fields on industry_starting_prices are
 * what the current UI reads directly.
 */
export class TrainerFormDAO {
  private collection: Collection<TrainerFormDoc>;

  constructor(db: Db, collectionName = "trainer_form") {
    this.collection = db.collection<TrainerFormDoc>(collectionName);
  }

  public async getTrainerForm(trainer: string, formCategory: TrainerFormCategory): Promise<TrainerFormDoc | null> {
    return this.collection.findOne({ trainer, formCategory });
  }

  public async createIndexes(): Promise<void> {
    try {
      await this.collection.createIndex({ trainer: 1, formCategory: 1 }, { unique: true });
    } catch (err) {
      console.warn(`createIndex failed for trainer_form {trainer:1,formCategory:1} (non-fatal):`, err);
    }
    console.log("Trainer form indexes ensured");
  }
}
