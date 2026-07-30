import { MongoClient, Db } from "mongodb";
import { IndustrySpDAO } from "../industry-sp-dao";

const MONGO_URI = "mongodb://localhost:27019";
// A uniquely-named throwaway database, same reasoning as
// model-version-dao.integration.test.ts — deliberately not the existing
// industry-sp-dao.integration.test.ts file's shared betfair_nlp_dev/
// betfair_nlp_local fixtures, and a standalone file (not a new describe
// block in that one) to avoid touching a file already flagged as
// contested in AGENTS.md.
const DB_NAME = `betfair_nlp_test_isp_model_version_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

describe("IndustrySpDAO modelVersionId filter (integration)", () => {
  let client: MongoClient;
  let db: Db;
  let dao: IndustrySpDAO;

  beforeAll(async () => {
    client = new MongoClient(MONGO_URI);
    await client.connect();
    db = client.db(DB_NAME);
    dao = new IndustrySpDAO(db);
    await dao.createIndexes();

    // Cast to `any` — these seed docs use plain numeric _ids (matching how
    // import-industry-sp.ts actually writes this collection), not the
    // ObjectId the driver's default Document type expects.
    await db.collection("industry_starting_prices").insertMany([
      {
        _id: 1,
        raceId: 1,
        meetingId: "m1",
        meetingName: "Test Course",
        course: "Test Course",
        countryCode: "GB",
        raceTime: "2026-01-01T14:00:00.000Z",
        raceName: "Test Race 1",
        raceType: "Flat",
        raceClass: "Class 1",
        going: "Good",
        ran: 2,
        runnersWithIspCount: 2,
        runners: [
          { id: 101, name: "Runner A", num: 1, draw: 1, status: "WINNER", sortPriority: 1, isp: 2, ispFraction: "1/1", isFavourite: true, modelWinProbability: 60, modelVersionId: "xgb-v1" },
          { id: 102, name: "Runner B", num: 2, draw: 2, status: "LOSER", sortPriority: 2, isp: 4, ispFraction: "3/1", isFavourite: false, modelWinProbability: 40, modelVersionId: "xgb-v1" },
        ],
      },
      {
        _id: 2,
        raceId: 2,
        meetingId: "m2",
        meetingName: "Test Course",
        course: "Test Course",
        countryCode: "GB",
        raceTime: "2026-01-02T14:00:00.000Z",
        raceName: "Test Race 2",
        raceType: "Flat",
        raceClass: "Class 1",
        going: "Good",
        ran: 2,
        runnersWithIspCount: 2,
        runners: [
          { id: 201, name: "Runner C", num: 1, draw: 1, status: "WINNER", sortPriority: 1, isp: 3, ispFraction: "2/1", isFavourite: true, modelWinProbability: 55, modelVersionId: "xgb-v2" },
          { id: 202, name: "Runner D", num: 2, draw: 2, status: "LOSER", sortPriority: 2, isp: 5, ispFraction: "4/1", isFavourite: false, modelWinProbability: 45, modelVersionId: "xgb-v2" },
        ],
      },
    ] as any[]);
  }, 15000);

  afterAll(async () => {
    await db.dropDatabase();
    await client.close();
  });

  it("without modelVersionId, returns all races (backward compatible)", async () => {
    const result = await dao.getAllRacesByRace(
      1, 20, 1, 30, [], 1, 1000, "asc", 1, 10000, 1, null,
      null, null, [], [], [], [], null, null, 0, 0, 100, null, 0, false
    );
    expect(result.total).toBe(2);
  });

  it("filters to only the race with a runner tagged with the given modelVersionId", async () => {
    const result = await dao.getAllRacesByRace(
      1, 20, 1, 30, [], 1, 1000, "asc", 1, 10000, 1, null,
      null, null, [], [], [], [], null, null, 0, 0, 100, null, 0, false,
      "xgb-v1"
    );
    expect(result.total).toBe(1);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].raceId).toBe(1);
  });

  it("filters to the other race for the other modelVersionId", async () => {
    const result = await dao.getAllRacesByRace(
      1, 20, 1, 30, [], 1, 1000, "asc", 1, 10000, 1, null,
      null, null, [], [], [], [], null, null, 0, 0, 100, null, 0, false,
      "xgb-v2"
    );
    expect(result.total).toBe(1);
    expect(result.data[0].raceId).toBe(2);
  });

  it("returns zero races for an unknown modelVersionId", async () => {
    const result = await dao.getAllRacesByRace(
      1, 20, 1, 30, [], 1, 1000, "asc", 1, 10000, 1, null,
      null, null, [], [], [], [], null, null, 0, 0, 100, null, 0, false,
      "xgb-does-not-exist"
    );
    expect(result.total).toBe(0);
    expect(result.data).toHaveLength(0);
  });
});
