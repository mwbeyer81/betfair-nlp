import { MongoClient, Db, ObjectId } from "mongodb";
import { SavedFilterSetDAO, SavedFilterSetDocument } from "../saved-filter-set-dao";

const MONGO_URI = "mongodb://localhost:27019";
// Uniquely-named throwaway database, dropped in afterAll — same pattern as
// model-version-dao.integration.test.ts.
const DB_NAME = `betfair_nlp_test_saved_filter_sets_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

function makeDoc(overrides: Partial<SavedFilterSetDocument> = {}): Omit<SavedFilterSetDocument, "_id"> {
  return {
    userId: "user-a",
    name: "Nottingham favourites",
    filters: { courses: "Nottingham", minDate: "2026-06-03", maxDate: "2026-06-03" },
    pnlStats: { staked: 100, returns: 120, pnl: 20, count: 6 },
    graphPoints: [
      { raceRowNumber: 1, cumulativeStaked: 20, cumulativeReturns: 0, cumulativePnl: -20, roiPercent: -100 },
      { raceRowNumber: 2, cumulativeStaked: 40, cumulativeReturns: 40, cumulativePnl: 0, roiPercent: 0 },
    ],
    createdAt: "2026-01-01T09:00:00.000Z",
    ...overrides,
  };
}

describe("SavedFilterSetDAO (integration)", () => {
  let client: MongoClient;
  let db: Db;
  let dao: SavedFilterSetDAO;

  beforeAll(async () => {
    client = new MongoClient(MONGO_URI);
    await client.connect();
    db = client.db(DB_NAME);
    dao = new SavedFilterSetDAO(db);
  }, 15000);

  afterAll(async () => {
    await db.dropDatabase();
    await client.close();
  });

  afterEach(async () => {
    await db.collection("saved_filter_sets").deleteMany({});
  });

  it("create() then getByIdForUser() round-trips the full document", async () => {
    const created = await dao.create(makeDoc());
    expect(created._id).toBeDefined();

    const fetched = await dao.getByIdForUser(created._id!.toString(), "user-a");
    expect(fetched).not.toBeNull();
    expect(fetched?.name).toBe("Nottingham favourites");
    expect(fetched?.filters).toEqual({ courses: "Nottingham", minDate: "2026-06-03", maxDate: "2026-06-03" });
    expect(fetched?.pnlStats).toEqual({ staked: 100, returns: 120, pnl: 20, count: 6 });
    expect(fetched?.graphPoints).toHaveLength(2);
  });

  it("listByUser returns that user's docs newest first", async () => {
    await dao.create(makeDoc({ name: "Oldest", createdAt: "2026-01-01T09:00:00.000Z" }));
    await dao.create(makeDoc({ name: "Middle", createdAt: "2026-02-01T09:00:00.000Z" }));
    await dao.create(makeDoc({ name: "Newest", createdAt: "2026-03-01T09:00:00.000Z" }));

    const results = await dao.listByUser("user-a");
    expect(results.map(r => r.name)).toEqual(["Newest", "Middle", "Oldest"]);
  });

  it("scopes list/get strictly by userId — never crosses users", async () => {
    await dao.create(makeDoc({ userId: "user-a", name: "A's result" }));
    const bDoc = await dao.create(makeDoc({ userId: "user-b", name: "B's result" }));

    const aResults = await dao.listByUser("user-a");
    expect(aResults.map(r => r.name)).toEqual(["A's result"]);

    const crossFetch = await dao.getByIdForUser(bDoc._id!.toString(), "user-a");
    expect(crossFetch).toBeNull();
  });

  it("getByIdForUser returns null for an unknown or malformed id", async () => {
    expect(await dao.getByIdForUser(new ObjectId().toString(), "user-a")).toBeNull();
    expect(await dao.getByIdForUser("not-a-valid-object-id", "user-a")).toBeNull();
  });

  it("deleteByIdForUser removes the doc, is idempotent, and respects ownership", async () => {
    const doc = await dao.create(makeDoc({ userId: "user-a" }));
    const id = doc._id!.toString();

    // Wrong user can't delete it, and the doc survives the attempt.
    expect(await dao.deleteByIdForUser(id, "user-b")).toBe(false);
    expect(await dao.getByIdForUser(id, "user-a")).not.toBeNull();

    expect(await dao.deleteByIdForUser(id, "user-a")).toBe(true);
    expect(await dao.getByIdForUser(id, "user-a")).toBeNull();

    // Second delete of the same id is a safe no-op, not an error.
    expect(await dao.deleteByIdForUser(id, "user-a")).toBe(false);
  });

  it("each returned doc has the expected field shape", async () => {
    await dao.create(makeDoc());
    const [doc] = await dao.listByUser("user-a");
    expect(typeof doc.userId).toBe("string");
    expect(typeof doc.name).toBe("string");
    expect(typeof doc.createdAt).toBe("string");
    expect(typeof doc.pnlStats.staked).toBe("number");
    expect(typeof doc.pnlStats.returns).toBe("number");
    expect(typeof doc.pnlStats.pnl).toBe("number");
    expect(typeof doc.pnlStats.count).toBe("number");
    expect(Array.isArray(doc.graphPoints)).toBe(true);
    for (const p of doc.graphPoints) {
      expect(typeof p.raceRowNumber).toBe("number");
      expect(typeof p.cumulativeStaked).toBe("number");
      expect(typeof p.cumulativeReturns).toBe("number");
      expect(typeof p.cumulativePnl).toBe("number");
      expect(typeof p.roiPercent).toBe("number");
    }
  });
});
