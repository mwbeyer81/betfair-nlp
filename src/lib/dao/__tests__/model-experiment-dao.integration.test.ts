import { MongoClient, Db } from "mongodb";
import { ModelExperimentDAO, ModelExperimentDocument } from "../model-experiment-dao";
import { ModelVersionDAO } from "../model-version-dao";

const MONGO_URI = "mongodb://localhost:27019";
// A uniquely-named throwaway database per test run, same convention as
// model-version-dao.integration.test.ts — this suite writes synthetic
// documents into TWO collections and asserts they stay disjoint, so it must
// not share a database with anything real.
const DB_NAME = `betfair_nlp_test_model_experiments_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const metrics = {
  n: 189640,
  aucRoc: 0.71554,
  logLoss: 0.326826,
  brierScore: 0.095289,
  resolution: 0.00721379,
  reliability: 0.000098,
  top1Rate: 0.260771,
};

function makeDoc(overrides: Partial<ModelExperimentDocument> = {}): ModelExperimentDocument {
  return {
    experimentId: "exp-20260806-183001",
    name: "base-binary-control",
    notes: "",
    runAt: "2026-08-06T18:30:01.000Z",
    gitCommit: "abc1234",
    mode: "fast",
    featureSetName: "baseline",
    objective: "binary",
    featureCols: ["course", "going", "officialRating"],
    newFeatureCols: [],
    featureCoverage: [{ col: "course", populatedPct: 100 }],
    trainingParams: { maxDepth: 5 },
    foldYears: ["2022", "2023"],
    foldCount: 2,
    scoredRows: 189640,
    unscoredRows: 296758,
    droppedTrainRaces: 0,
    coverageMinDate: "2022-01-01",
    coverageMaxDate: "2026-08-05",
    overall: {
      model: metrics,
      calibrated: metrics,
      market: { ...metrics, brierScore: 0.088829, aucRoc: 0.785405, resolution: 0.01363617 },
      bss: -0.072724,
    },
    folds: [{ year: "2022", trainRows: 265382, scoredRows: 42863 }],
    spBandTable: [],
    segments: [
      {
        dimension: "spBand",
        bucket: "5.0-10.0",
        bucketOrder: 3,
        n: 44000,
        scoredN: 43980,
        wins: 5100,
        strikeRate: 11.6,
        model: metrics,
        market: metrics,
        bss: -0.026,
        selections: {
          all: {
            n: 44000,
            wins: 5100,
            strikeRate: 11.6,
            bettableN: 43980,
            pnl: {
              toWin1: { staked: 8000, returns: 7900, pnl: -100, roiPct: -1.25 },
              level: { staked: 44000, returns: 43000, pnl: -1000, roiPct: -2.27 },
            },
          },
        },
        yearsPositiveToWin1: 2,
        yearsPositiveLevel: 1,
      },
    ],
    acceptanceRule: { minN: 20000 },
    discoveredSegments: [],
    filterBattery: [],
    totalSeconds: 338.6,
    wroteModelArtifacts: false,
    ...overrides,
  };
}

describe("ModelExperimentDAO (integration)", () => {
  let client: MongoClient;
  let db: Db;
  let dao: ModelExperimentDAO;

  beforeAll(async () => {
    client = new MongoClient(MONGO_URI);
    await client.connect();
    db = client.db(DB_NAME);
    dao = new ModelExperimentDAO(db);
    await dao.createIndexes();

    await db.collection("model_experiments").insertMany([
      makeDoc({ experimentId: "exp-20260806-183001", runAt: "2026-08-06T18:30:01.000Z", mode: "fast" }),
      makeDoc({ experimentId: "exp-20260806-190210", runAt: "2026-08-06T19:02:10.000Z", mode: "fast", name: "rel-softmax" }),
      makeDoc({ experimentId: "exp-20260807-020000", runAt: "2026-08-07T02:00:00.000Z", mode: "full", name: "rel-softmax-full" }),
    ] as unknown as ModelExperimentDocument[]);
  }, 15000);

  afterAll(async () => {
    await db.dropDatabase();
    await client.close();
  });

  it("returns every experiment, newest first", async () => {
    const rows = await dao.getAll();
    expect(rows).toHaveLength(3);
    expect(rows.map(r => r.experimentId)).toEqual([
      "exp-20260807-020000",
      "exp-20260806-190210",
      "exp-20260806-183001",
    ]);
  });

  // The one invariant that is completely invisible unless it is asserted. A
  // single experiment carries ~56 segments, each with three selections' worth
  // of P&L under two staking conventions, plus a coverage row per feature —
  // fifty of those is megabytes of payload for a screen showing one line each.
  it("the list projection omits the heavyweight sub-documents", async () => {
    const [row] = await dao.getAll();
    expect(row.experimentId).toBeDefined();
    expect(row.overall.model.brierScore).toBeCloseTo(0.095289);
    expect((row as Record<string, unknown>).segments).toBeUndefined();
    expect((row as Record<string, unknown>).folds).toBeUndefined();
    expect((row as Record<string, unknown>).featureCoverage).toBeUndefined();
    expect((row as Record<string, unknown>).spBandTable).toBeUndefined();
  });

  // The counterpart to the projection: the list still has to say how many
  // features a run used, without shipping the ~143-entry array to display one
  // integer. Caught by querying the running API — every row read "0 features".
  it("still reports featureCount even though featureCols is projected away", async () => {
    const [row] = await dao.getAll();
    expect((row as Record<string, unknown>).featureCols).toBeUndefined();
    expect(row.featureCount).toBe(3);
  });

  it("getById returns the full document including segments", async () => {
    const doc = await dao.getById("exp-20260806-183001");
    expect(doc).not.toBeNull();
    expect(doc!.segments).toHaveLength(1);
    expect(doc!.folds).toHaveLength(1);
    expect(doc!.featureCols).toContain("officialRating");
  });

  it("getById returns null for an unknown id", async () => {
    expect(await dao.getById("exp-does-not-exist")).toBeNull();
  });

  it("narrows by mode", async () => {
    // Fast runs score five folds on half the races with a tree cap, so their
    // metrics are not comparable to a full run's — reading a mixed list
    // top-to-bottom invites exactly that comparison.
    const full = await dao.getAll({ mode: "full" });
    expect(full).toHaveLength(1);
    expect(full[0].mode).toBe("full");
    expect(await dao.getAll({ mode: "fast" })).toHaveLength(2);
  });

  it("segment P&L survives the round trip as numbers under both stakings", async () => {
    const doc = await dao.getById("exp-20260806-183001");
    const selection = doc!.segments[0].selections.all;
    expect(typeof selection.pnl.toWin1!.roiPct).toBe("number");
    expect(typeof selection.pnl.level!.roiPct).toBe("number");
    expect(typeof doc!.segments[0].bss).toBe("number");
  });

  it("rejects a duplicate experimentId", async () => {
    await expect(
      db.collection("model_experiments").insertOne(makeDoc({ experimentId: "exp-20260806-183001" }) as never)
    ).rejects.toThrow();
  });

  // THE compatibility guard. model_evaluations is read by the training
  // pipeline's champion gate and by the deployed daily-prediction path, and
  // both were allow-by-default over document type — an experiment doc landing
  // there would have become a permanent champion no genuine retrain could
  // beat, while having no model artifact anywhere to deploy. Separate
  // collections are what make that impossible rather than merely unlikely.
  describe("cannot disturb model_evaluations", () => {
    it("experiment documents are invisible to ModelVersionDAO", async () => {
      const versionDao = new ModelVersionDAO(db);
      await db.collection("model_evaluations").insertOne({
        modelVersionId: "xgb-20260101-090000",
        runLabel: "real-training-run",
        runAt: "2026-01-01T09:00:00.000Z",
        logLoss: 0.32,
      } as never);

      const before = await versionDao.getAll();
      expect(before).toHaveLength(1);

      // A dozen more experiments change nothing about what the version list
      // or the coverage lookup return.
      await db.collection("model_experiments").insertMany(
        Array.from({ length: 12 }, (_, i) =>
          makeDoc({ experimentId: `exp-guard-${i}`, runAt: `2026-09-0${(i % 9) + 1}T00:00:00.000Z` })
        ) as unknown as ModelExperimentDocument[]
      );

      const after = await versionDao.getAll();
      expect(after.map(v => v.modelVersionId)).toEqual(before.map(v => v.modelVersionId));
      // No walk-forward doc was ever written, so coverage stays null rather
      // than picking up an experiment's coverage dates.
      expect(await versionDao.getWalkForwardCoverage()).toBeNull();
    });
  });
});
