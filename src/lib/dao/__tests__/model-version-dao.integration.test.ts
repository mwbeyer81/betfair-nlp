import { MongoClient, Db } from "mongodb";
import { ModelVersionDAO, ModelVersionDocument } from "../model-version-dao";

const MONGO_URI = "mongodb://localhost:27019";
// A uniquely-named throwaway database per test run — deliberately NOT the
// repo's shared betfair_nlp_dev/betfair_nlp_local convention (see other
// *.integration.test.ts files in this directory). This suite writes
// synthetic model_evaluations docs, so a fresh db avoids any risk of
// colliding with real data or a concurrently-running test suite, and is
// dropped entirely in afterAll rather than left around afterward.
const DB_NAME = `betfair_nlp_test_model_versions_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

function makeDoc(overrides: Partial<ModelVersionDocument> = {}): ModelVersionDocument {
  return {
    modelVersionId: "xgb-20260101-090000",
    runLabel: "unlabeled",
    runAt: "2026-01-01T09:00:00.000Z",
    trainingParams: {
      nEstimators: 2000,
      learningRate: 0.03,
      maxDepth: 5,
      subsample: 0.8,
      colsampleBytree: 0.8,
      minChildWeight: 8,
      randomState: 42,
      earlyStoppingRounds: 50,
    },
    featureCols: ["course", "going", "trainer", "jockey"],
    trainRows: 180000,
    testRows: 20000,
    trainDateMax: "2025-12-01",
    testDateMin: "2025-12-02",
    bestIteration: 842,
    aucRoc: 0.71,
    logLoss: 0.6,
    brierScore: 0.21,
    calibrationTable: [
      { meanPredicted: 10, actualWinRate: 12, n: 2000 },
      { meanPredicted: 90, actualWinRate: 85, n: 2100 },
    ],
    ...overrides,
  };
}

describe("ModelVersionDAO (integration)", () => {
  let client: MongoClient;
  let db: Db;
  let dao: ModelVersionDAO;

  beforeAll(async () => {
    client = new MongoClient(MONGO_URI);
    await client.connect();
    db = client.db(DB_NAME);
    dao = new ModelVersionDAO(db);

    await db.collection("model_evaluations").insertMany([
      makeDoc({ modelVersionId: "xgb-20260101-090000", runAt: "2026-01-01T09:00:00.000Z", aucRoc: 0.71 }),
      makeDoc({ modelVersionId: "xgb-20260201-090000", runAt: "2026-02-01T09:00:00.000Z", aucRoc: 0.72 }),
      makeDoc({ modelVersionId: "xgb-20260301-090000", runAt: "2026-03-01T09:00:00.000Z", aucRoc: 0.73 }),
      // Predates modelVersionId existing as a field — getAll() must exclude
      // this, not surface it as some pseudo-version with an undefined id.
      { runLabel: "old-unlabeled-run", runAt: "2025-01-01T00:00:00.000Z", aucRoc: 0.65 } as unknown as ModelVersionDocument,
    ]);
  }, 15000);

  afterAll(async () => {
    await db.dropDatabase();
    await client.close();
  });

  it("returns all model versions with a modelVersionId, newest first", async () => {
    const versions = await dao.getAll();
    expect(versions).toHaveLength(3);
    expect(versions.map(v => v.modelVersionId)).toEqual([
      "xgb-20260301-090000",
      "xgb-20260201-090000",
      "xgb-20260101-090000",
    ]);
  });

  it("each version has the expected field shape", async () => {
    const versions = await dao.getAll();
    for (const v of versions) {
      expect(typeof v.modelVersionId).toBe("string");
      expect(typeof v.runLabel).toBe("string");
      expect(typeof v.runAt).toBe("string");
      expect(typeof v.trainingParams.nEstimators).toBe("number");
      expect(typeof v.trainingParams.earlyStoppingRounds).toBe("number");
      expect(Array.isArray(v.featureCols)).toBe(true);
      expect(typeof v.trainRows).toBe("number");
      expect(typeof v.aucRoc).toBe("number");
      expect(typeof v.logLoss).toBe("number");
      expect(typeof v.brierScore).toBe("number");
      expect(Array.isArray(v.calibrationTable)).toBe(true);
      for (const bucket of v.calibrationTable) {
        expect(typeof bucket.meanPredicted).toBe("number");
        expect(typeof bucket.actualWinRate).toBe("number");
        expect(typeof bucket.n).toBe("number");
      }
    }
  });

  it("excludes evaluation docs written before modelVersionId existed", async () => {
    const versions = await dao.getAll();
    expect(versions.find(v => v.runLabel === "old-unlabeled-run")).toBeUndefined();
  });

  it("getById returns the matching version", async () => {
    const version = await dao.getById("xgb-20260201-090000");
    expect(version).not.toBeNull();
    expect(version?.aucRoc).toBe(0.72);
  });

  it("getById returns null for an unknown modelVersionId", async () => {
    const version = await dao.getById("xgb-does-not-exist");
    expect(version).toBeNull();
  });

  // The walk-forward document's own coverageMaxDate stopped being the truth on
  // 2026-08-04, when the results-capture path began writing each day's live
  // pre-race prediction into the out-of-sample field too. Coverage now extends
  // daily while that document stays frozen at whenever the script last ran, so
  // reading it told users a date range was out of coverage when it was not —
  // and the error grew by a day, every day. It was a week wide when caught.
  describe("getWalkForwardCoverage — the live edge, not the frozen one", () => {
    beforeAll(async () => {
      await db.collection("model_evaluations").insertOne({
        evaluationType: "walk_forward",
        oosVersionId: "wf-20260731-074825",
        runAt: "2026-07-31T08:04:11.974Z",
        coverageMinDate: "2016-01-01",
        coverageMaxDate: "2026-07-30",
        scoredRows: 885089,
        unscoredRows: 86027,
      } as never);
    });

    afterEach(async () => {
      await db.collection("industry_starting_prices").deleteMany({});
    });

    it("falls back to the document's own date when no race is scored yet", async () => {
      // A fresh local stack: evaluation doc seeded, no scored races. The
      // reported window must never narrow below what the document claimed.
      const coverage = await dao.getWalkForwardCoverage();
      expect(coverage?.coverageMaxDate).toBe("2026-07-30");
      expect(coverage?.walkForwardMaxDate).toBe("2026-07-30");
    });

    it("reports the live edge when scored races run past the walk-forward", async () => {
      await db.collection("industry_starting_prices").insertMany([
        { _id: 1, raceDate: "2026-07-29", raceTime: "2026-07-29T14:00:00",
          runners: [{ name: "A", modelWinProbabilityOos: 22.5 }] },
        { _id: 2, raceDate: "2026-08-06", raceTime: "2026-08-06T15:30:00",
          runners: [{ name: "B", modelWinProbabilityOos: 18.1 }] },
      ] as never);

      const coverage = await dao.getWalkForwardCoverage();
      expect(coverage?.coverageMaxDate).toBe("2026-08-06");
      // ...while still reporting how far the backtest itself got, which is
      // what tells you whether it needs re-running.
      expect(coverage?.walkForwardMaxDate).toBe("2026-07-30");
      expect(coverage?.coverageMinDate).toBe("2016-01-01");
    });

    it("ignores races that carry no out-of-sample score", async () => {
      // A race captured after the last prediction — results but no score. It
      // must not extend the reported window, or the screen promises coverage
      // that does not exist.
      await db.collection("industry_starting_prices").insertMany([
        { _id: 3, raceDate: "2026-08-05", raceTime: "2026-08-05T14:00:00",
          runners: [{ name: "C", modelWinProbabilityOos: 30.0 }] },
        { _id: 4, raceDate: "2026-08-09", raceTime: "2026-08-09T14:00:00",
          runners: [{ name: "D", modelWinProbabilityOos: null }] },
      ] as never);

      expect((await dao.getWalkForwardCoverage())?.coverageMaxDate).toBe("2026-08-05");
    });

    it("counts a race where only SOME runners are scored", async () => {
      // Why the query uses $type rather than $ne: null — on an array field,
      // $ne matches only documents where NO element is null, which would
      // exclude nearly every real race, since most have some unscored
      // runners. That would have reported a far-too-early date.
      await db.collection("industry_starting_prices").insertOne({
        _id: 5, raceDate: "2026-08-06", raceTime: "2026-08-06T16:00:00",
        runners: [
          { name: "E", modelWinProbabilityOos: 12.0 },
          { name: "F", modelWinProbabilityOos: null },
        ],
      } as never);

      expect((await dao.getWalkForwardCoverage())?.coverageMaxDate).toBe("2026-08-06");
    });
  });
});
