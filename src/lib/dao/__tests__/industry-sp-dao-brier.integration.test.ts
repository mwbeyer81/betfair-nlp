import { MongoClient, Db } from "mongodb";
import { IndustrySpDAO } from "../industry-sp-dao";

const MONGO_URI = "mongodb://localhost:27019";
// Uniquely-named throwaway database, dropped in afterAll — same convention as
// model-accuracy-dao.integration.test.ts and its siblings, deliberately not the
// shared betfair_nlp_dev fixtures.
const DB_NAME = `betfair_nlp_test_brier_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

// Seed arithmetic, worked by hand so every expectation below is checkable
// rather than snapshotted.
//
// RACE 1 — 4 runners, isp 2 / 4 / 5 / 20
//   raw implied (100/isp):  50, 25, 20, 5  ->  bookSum = 100 exactly.
//   Chosen deliberately: with a book of exactly 100% the fair probability
//   equals the raw one, so this race's market Brier can be checked without the
//   normalisation in the way. RACE 2 then exercises normalisation on its own.
//   model:  55, 20, 15, 10   (sums to 100, as normalize_within_race guarantees)
//   Runner A (isp 2, model 55) WINS.
//
//   model squared errors:  (0.55-1)^2 = 0.2025
//                          (0.20-0)^2 = 0.04
//                          (0.15-0)^2 = 0.0225
//                          (0.10-0)^2 = 0.01
//                          sum = 0.275, mean over 4 = 0.06875
//   market squared errors: (0.50-1)^2 = 0.25
//                          (0.25-0)^2 = 0.0625
//                          (0.20-0)^2 = 0.04
//                          (0.05-0)^2 = 0.0025
//                          sum = 0.355, mean over 4 = 0.08875
//   So on race 1 the model beats the market by 0.02.
const RACE_1 = {
  _id: 1,
  raceId: 1,
  meetingId: "m1",
  meetingName: "Ascot",
  course: "Ascot",
  countryCode: "GB",
  raceTime: "2026-01-01T14:00:00.000Z",
  raceName: "Brier Race 1",
  raceType: "Flat",
  raceClass: "Class 1",
  going: "Good",
  ran: 4,
  runnersWithIspCount: 4,
  // Precomputed at import time in the real collection; the pnlStats fast path
  // reads these directly, which is exactly the path the Brier branch must work
  // alongside without depending on.
  raceStaked: 1 + 1 / 3 + 0.25 + 1 / 19,
  raceReturns: 1 + 1,
  runners: [
    { id: 101, name: "A", num: 1, draw: 1, status: "WINNER", sortPriority: 1, isp: 2, ispFraction: "1/1", isFavourite: true, modelWinProbabilityOos: 55 },
    { id: 102, name: "B", num: 2, draw: 2, status: "LOSER", sortPriority: 2, isp: 4, ispFraction: "3/1", isFavourite: false, modelWinProbabilityOos: 20 },
    { id: 103, name: "C", num: 3, draw: 3, status: "LOSER", sortPriority: 3, isp: 5, ispFraction: "4/1", isFavourite: false, modelWinProbabilityOos: 15 },
    { id: 104, name: "D", num: 4, draw: 4, status: "LOSER", sortPriority: 4, isp: 20, ispFraction: "19/1", isFavourite: false, modelWinProbabilityOos: 10 },
  ],
};

// RACE 2 — 4 priced runners, isp 2 / 2 / 5 / 10, one of which the model never
// scored.
//   raw implied: 50, 50, 20, 10  ->  bookSum = 130 (a 30% overround).
//   model:       50, 30, 20 on the three SCORED runners.
//   Runner E (isp 2) WINS.
//
//   The fourth runner (H) has NO modelWinProbabilityOos key at all — the shape a
//   real unscored runner has, and not the same thing as an explicit null (see
//   the incident recorded in model-accuracy-dao.integration.test.ts). It is
//   excluded from BOTH scores, while STILL counting towards the book sum,
//   because the overround is a property of the whole field. That asymmetry is
//   the point of this race: fair probabilities are 100/isp/130*100, i.e.
//   38.4615, 38.4615, 15.3846 on the scored three (they sum to 92.3, not 100 —
//   the missing 7.7 is H's, which is exactly right, since H ran).
//
//   model squared errors:  (0.50-1)^2 = 0.25
//                          (0.30-0)^2 = 0.09
//                          (0.20-0)^2 = 0.04
//                          sum = 0.38, mean over 3 = 0.126666..
//   market squared errors: (0.384615-1)^2 = 0.378698..
//                          (0.384615-0)^2 = 0.147929..
//                          (0.153846-0)^2 = 0.023668..
//                          sum = 0.550295.., mean over 3 = 0.183431..
const RACE_2 = {
  _id: 2,
  raceId: 2,
  meetingId: "m2",
  meetingName: "Kempton",
  course: "Kempton",
  countryCode: "GB",
  raceTime: "2026-02-01T14:00:00.000Z",
  raceName: "Brier Race 2",
  raceType: "Hurdle",
  raceClass: "Class 2",
  going: "Soft",
  ran: 4,
  runnersWithIspCount: 4,
  raceStaked: 1 + 1 + 0.25 + 1 / 9,
  raceReturns: 1 + 1,
  runners: [
    { id: 201, name: "E", num: 1, draw: 1, status: "WINNER", sortPriority: 1, isp: 2, ispFraction: "1/1", isFavourite: true, modelWinProbabilityOos: 50 },
    { id: 202, name: "F", num: 2, draw: 2, status: "LOSER", sortPriority: 2, isp: 2, ispFraction: "1/1", isFavourite: false, modelWinProbabilityOos: 30 },
    { id: 203, name: "G", num: 3, draw: 3, status: "LOSER", sortPriority: 3, isp: 5, ispFraction: "4/1", isFavourite: false, modelWinProbabilityOos: 20 },
    { id: 204, name: "H", num: 4, draw: 4, status: "LOSER", sortPriority: 4, isp: 10, ispFraction: "9/1", isFavourite: false },
  ],
};

const R1_MODEL = 0.06875;
const R1_MARKET = 0.08875;
const R2_MODEL = 0.38 / 3;
const R2_MARKET_SUM = 0.37869822485207105 + 0.14792899408284022 + 0.023668639053254437;
const R2_MARKET = R2_MARKET_SUM / 3;

describe("IndustrySpDAO Brier scores (integration)", () => {
  let client: MongoClient;
  let db: Db;
  let dao: IndustrySpDAO;

  beforeAll(async () => {
    client = new MongoClient(MONGO_URI);
    await client.connect();
    db = client.db(DB_NAME);
    dao = new IndustrySpDAO(db);
    // Cast to `any` — plain numeric _ids, matching how import-industry-sp.ts
    // actually writes this collection.
    await db.collection("industry_starting_prices").insertMany([RACE_1, RACE_2] as any[]);
  }, 15000);

  afterAll(async () => {
    await db.dropDatabase();
    await client.close();
  });

  it("scores a single race against hand-derived squared errors", async () => {
    const { brier } = await dao.getAllRacesByRace(1, 1, 1, 30, [], 1, 1000, "asc", 1, 10000, 1, null, null, null, ["Ascot"]);
    expect(brier.scored).toBe(4);
    expect(brier.model).toBeCloseTo(R1_MODEL, 6);
    expect(brier.market).toBeCloseTo(R1_MARKET, 6);
  });

  it("divides the overround out of the market probability", async () => {
    // Race 2's book sums to 130%. Scored on raw 100/isp its market Brier would
    // be (0.25 + 0.25 + 0.04)/3 = 0.18; scored fair it is 0.18343... Close
    // enough to be worth pinning precisely — and the raw figure would flatter
    // the market here rather than penalise it, which is why the assertion
    // below is exact rather than a direction check.
    const { brier } = await dao.getAllRacesByRace(1, 1, 1, 30, [], 1, 1000, "asc", 1, 10000, 1, null, null, null, ["Kempton"]);
    expect(brier.market).toBeCloseTo(R2_MARKET, 6);
    expect(brier.market).not.toBeCloseTo(0.18, 4);
  });

  it("excludes a runner the model never scored, but still counts it in the book", async () => {
    // Runner H has no modelWinProbabilityOos field at all. Excluded from the
    // score: 3 scored, not 4. Still in the book: race 2's bookSum includes its
    // 10 (100/10), which is what makes the fair probabilities above sum to 100
    // — drop it and every other runner's fair probability inflates.
    const { brier } = await dao.getAllRacesByRace(1, 1, 1, 30, [], 1, 1000, "asc", 1, 10000, 1, null, null, null, ["Kempton"]);
    expect(brier.scored).toBe(3);
    expect(brier.model).toBeCloseTo(R2_MODEL, 6);
  });

  it("weights races by their runner count when combining them", async () => {
    // Both races together: 7 scored runners, total model squared error
    // 0.275 + 0.38 = 0.655, so 0.655/7 = 0.0935714...
    // NOT the mean of the two race means ((0.06875 + 0.12666)/2 = 0.0977),
    // which is what a per-race average would wrongly give.
    const { brier } = await dao.getAllRacesByRace(1, 1);
    expect(brier.scored).toBe(7);
    expect(brier.model).toBeCloseTo(0.655 / 7, 6);
    expect(brier.model).not.toBeCloseTo((R1_MODEL + R2_MODEL) / 2, 4);
    expect(brier.market).toBeCloseTo((0.355 + R2_MARKET_SUM) / 7, 6);
  });

  it("scores exactly the runners a narrowed ISP range keeps", async () => {
    // isp 4-20 drops the two isp-2 winners. Left: race 1's B (4), C (5),
    // D (20), and race 2's G (5) and H (10) — 5 qualifying runners, all losers,
    // of which only 4 carry a model probability (H does not).
    //
    // The two counts differing is the case the card has to get right: the P&L
    // is over 5 horses and the Brier over 4, and the UI says so rather than
    // implying one number describes the other's population.
    //
    // Model errors: 0.04 + 0.0225 + 0.01 + 0.04 = 0.1125 -> 0.028125.
    // This also forces the pnlStats SLOW path, so it pins that the Brier branch
    // is genuinely independent of which P&L shape runs.
    const { brier, pnlStats } = await dao.getAllRacesByRace(1, 1, 1, 30, [], 4, 20);
    expect(brier.scored).toBe(4);
    expect(pnlStats.count).toBe(5);
    expect(brier.model).toBeCloseTo(0.028125, 6);
  });

  it("agrees between the fast and slow P&L paths over an identical runner set", async () => {
    // An ISP range wide enough to keep every runner takes the FAST path
    // (precomputed raceStaked/raceReturns, no $lookup); adding a runner-level
    // filter that excludes nothing takes the SLOW one. The Brier must be
    // identical — it is deliberately outside both.
    const fast = await dao.getAllRacesByRace(1, 1);
    const slow = await dao.getAllRacesByRace(
      1, 1, 1, 30, [], 1, 1000, "asc", 1, 10000, 1, null, null, null, [], [], [], [], null, null,
      0, 0, 100, null, /* minModelWinProbability */ 1
    );
    expect(slow.brier.scored).toBe(fast.brier.scored);
    expect(slow.brier.model).toBe(fast.brier.model);
    expect(slow.brier.market).toBe(fast.brier.market);
  });

  it("reports null rather than zero when the filter matches nothing", async () => {
    const { brier } = await dao.getAllRacesByRace(1, 1, 1, 30, ["ZZ"], 1, 1000);
    expect(brier.scored).toBe(0);
    expect(brier.model).toBeNull();
    expect(brier.market).toBeNull();
  });

  it("keeps brier.scored within pnlStats.count on every filter", async () => {
    // The invariant that makes the two numbers safe to show on one card: they
    // must describe the same horses, minus whichever the model never scored.
    for (const [minIsp, maxIsp] of [[1, 1000], [2, 5], [4, 20], [1, 2]]) {
      const { brier, pnlStats } = await dao.getAllRacesByRace(1, 1, 1, 30, [], minIsp, maxIsp);
      expect(brier.scored).toBeLessThanOrEqual(pnlStats.count);
    }
  });

  it("emits per-race sums for the live-results capture, summable to the same score", async () => {
    const races = await dao.getQualifyingRacesForDate({
      raceDate: "2026-01-01",
      countries: [],
      minRunners: 1,
      maxRunners: 30,
      minIsp: 1,
      maxIsp: 1000,
      minInIspRange: 1,
      maxInIspRange: 10000,
      courses: [],
      goings: [],
      raceClasses: [],
      raceTypes: [],
      trainerSearch: null,
      jockeySearch: null,
      trainerFormMinWinRate: 0,
      minTrainerFormRunners: 0,
      maxTrainerFormRunners: 100,
      minModelWinProbability: 0,
      onlyModelBeatsSp: false,
    });
    expect(races).toHaveLength(1);
    // Raw sums, not a mean — the rollup adds these across days before dividing.
    expect(races[0].brierSums.scored).toBe(4);
    expect(races[0].brierSums.modelSqErrSum).toBeCloseTo(0.275, 6);
    expect(races[0].brierSums.modelSqErrSum / races[0].brierSums.scored).toBeCloseTo(R1_MODEL, 6);
  });

  it("does not multiply a race's Brier by its own runner count", async () => {
    // Regression guard for a specific, easy mistake: getQualifyingRacesForDate
    // $unwinds its qualifying runners before grouping, which duplicates the
    // per-race _brier onto each of them. $first is correct there; $sum would
    // return 4x these numbers and nothing else in the app would notice.
    const races = await dao.getQualifyingRacesForDate({
      raceDate: "2026-02-01",
      countries: [], minRunners: 1, maxRunners: 30, minIsp: 1, maxIsp: 1000,
      minInIspRange: 1, maxInIspRange: 10000, courses: [], goings: [], raceClasses: [], raceTypes: [],
      trainerSearch: null, jockeySearch: null, trainerFormMinWinRate: 0,
      minTrainerFormRunners: 0, maxTrainerFormRunners: 100,
      minModelWinProbability: 0, onlyModelBeatsSp: false,
    });
    expect(races[0].brierSums.scored).toBe(3);
    expect(races[0].pnlStats.count).toBe(4);
    expect(races[0].brierSums.modelSqErrSum).toBeCloseTo(0.38, 6);
  });
});
