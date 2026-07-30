import { MongoClient, Db } from "mongodb";
import { TrainerFormDAO } from "../trainer-form-dao";

const MONGO_URI = "mongodb://localhost:27019";
const DB_NAME = "betfair_nlp_dev";

describe("TrainerFormDAO (integration)", () => {
  let client: MongoClient;
  let db: Db;
  let dao: TrainerFormDAO;

  beforeAll(async () => {
    client = new MongoClient(MONGO_URI);
    await client.connect();
    db = client.db(DB_NAME);
    dao = new TrainerFormDAO(db);
  }, 15000);

  afterAll(async () => {
    await client.close();
  });

  it("returns null for a trainer/category with no runs", async () => {
    const result = await dao.getTrainerForm("Nonexistent Trainer XYZ", "Flat");
    expect(result).toBeNull();
  });

  it("(trainer, formCategory) pairs are unique and runs are chronologically ordered, when seeded", async () => {
    // Only meaningful once src/commands/precompute-trainer-form.ts has been
    // run against this environment's data — skip rather than fail if the
    // trainer_form collection is empty (mirrors the guarded pattern used
    // elsewhere for data that depends on a batch/precompute step).
    const anyDoc = await db.collection("trainer_form").findOne({});
    if (!anyDoc) return;

    const result = await dao.getTrainerForm(anyDoc.trainer, anyDoc.formCategory);
    expect(result).not.toBeNull();
    expect(result?.totalRuns).toBe(result?.runs.length);
    expect(result?.totalWins).toBe(result?.runs.filter(r => r.status === "WINNER").length);
    const dates = result?.runs.map(r => r.raceDate) ?? [];
    expect(dates).toEqual([...dates].sort());

    const duplicates = await db
      .collection("trainer_form")
      .find({ trainer: anyDoc.trainer, formCategory: anyDoc.formCategory })
      .toArray();
    expect(duplicates.length).toBe(1);
  });
});
