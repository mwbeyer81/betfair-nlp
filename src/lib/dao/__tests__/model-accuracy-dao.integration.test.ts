import { MongoClient, Db } from "mongodb";
import { ModelAccuracyDAO } from "../model-accuracy-dao";
import { ModelAccuracyService, ModelAccuracyBand } from "../../service/model-accuracy-service";

const MONGO_URI = "mongodb://localhost:27019";
// Uniquely-named throwaway database, dropped in afterAll — same convention as
// model-version-dao.integration.test.ts and
// industry-sp-dao-model-version-filter.integration.test.ts, deliberately not
// the shared betfair_nlp_dev fixtures.
const DB_NAME = `betfair_nlp_test_model_accuracy_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

// Seed arithmetic, worked by hand so the expectations below are checkable
// rather than snapshotted:
//
// Race 1 (2026-01-01, Ascot, Flat) — 4 runners, isp 2 / 4 / 6 / 8
//   raw implied:  50, 25, 16.667, 12.5     -> bookSum = 104.1667 (= 625/6)
//   fair (raw/bookSum*100): 48, 24, 16, 12 -> sums to exactly 100
//   model:        60, 25, 12, 3            -> also sums to 100
//   bands:        under 2.0 / 3.0-5.0 / 5.0-10.0 / 20.0+
//   Runner A (isp 2) WINS.
//   stakes 1/(isp-1): 1, 0.3333, 0.2, 0.142857
//
// Race 2 (2026-02-01, Kempton, Flat) — 3 runners, only one bandable
//   isp 2.5 (model 40, WINNER), isp 1.5 (model null -> excluded),
//   isp null (model 30 -> excluded).
//   bookSum counts BOTH priced runners: 40 + 66.667 = 106.667 (= 320/3),
//   so fair for isp 2.5 = 37.5. A runner the ML pipeline never scored still
//   belongs to the book even though it can't be banded.
const RACE_1 = {
  _id: 1,
  raceId: 1,
  meetingId: "m1",
  meetingName: "Ascot",
  course: "Ascot",
  countryCode: "GB",
  raceTime: "2026-01-01T14:00:00.000Z",
  raceName: "Test Race 1",
  raceType: "Flat",
  raceClass: "Class 1",
  going: "Good",
  ran: 4,
  runnersWithIspCount: 4,
  runners: [
    { id: 101, name: "A", num: 1, draw: 1, status: "WINNER", sortPriority: 1, isp: 2, ispFraction: "1/1", isFavourite: true, modelWinProbabilityOos: 60 },
    { id: 102, name: "B", num: 2, draw: 2, status: "LOSER", sortPriority: 2, isp: 4, ispFraction: "3/1", isFavourite: false, modelWinProbabilityOos: 25 },
    { id: 103, name: "C", num: 3, draw: 3, status: "LOSER", sortPriority: 3, isp: 6, ispFraction: "5/1", isFavourite: false, modelWinProbabilityOos: 12 },
    { id: 104, name: "D", num: 4, draw: 4, status: "LOSER", sortPriority: 4, isp: 8, ispFraction: "7/1", isFavourite: false, modelWinProbabilityOos: 3 },
  ],
};

const RACE_2 = {
  _id: 2,
  raceId: 2,
  meetingId: "m2",
  meetingName: "Kempton",
  course: "Kempton",
  countryCode: "GB",
  raceTime: "2026-02-01T14:00:00.000Z",
  raceName: "Test Race 2",
  raceType: "Flat",
  raceClass: "Class 2",
  going: "Soft",
  ran: 3,
  runnersWithIspCount: 3,
  runners: [
    { id: 201, name: "E", num: 1, draw: 1, status: "WINNER", sortPriority: 1, isp: 2.5, ispFraction: "6/4", isFavourite: true, modelWinProbabilityOos: 40 },
    { id: 202, name: "F", num: 2, draw: 2, status: "LOSER", sortPriority: 2, isp: 1.5, ispFraction: "1/2", isFavourite: false, modelWinProbabilityOos: null },
    { id: 203, name: "G", num: 3, draw: 3, status: "LOSER", sortPriority: 3, isp: null, ispFraction: null, isFavourite: false, modelWinProbabilityOos: 30 },
  ],
};

const ALL_RACES = { minRaceTime: null, maxRaceTime: null, countries: [], courses: [], goings: [], raceClasses: [], raceTypes: [], minRunners: 1, maxRunners: 100 };

describe("ModelAccuracyDAO / ModelAccuracyService (integration)", () => {
  let client: MongoClient;
  let db: Db;
  let dao: ModelAccuracyDAO;
  let service: ModelAccuracyService;

  beforeAll(async () => {
    client = new MongoClient(MONGO_URI);
    await client.connect();
    db = client.db(DB_NAME);
    dao = new ModelAccuracyDAO(db);
    // Inject the DAO rather than letting the service resolve its own db — this
    // test has no initialized DatabaseConnection singleton.
    service = new ModelAccuracyService(dao);

    // Cast to `any` — plain numeric _ids, matching how import-industry-sp.ts
    // actually writes this collection.
    await db.collection("industry_starting_prices").insertMany([RACE_1, RACE_2] as any[]);
  }, 15000);

  afterAll(async () => {
    await db.dropDatabase();
    await client.close();
  });

  const bandByLabel = (bands: ModelAccuracyBand[], label: string): ModelAccuracyBand =>
    bands.find(b => b.label === label)!;

  it("returns every band, including ones with no runners", async () => {
    const { bands } = await service.getPriceBandAccuracy(ALL_RACES);
    expect(bands.map(b => b.label)).toEqual([
      "under 2.0",
      "2.0 – 3.0",
      "3.0 – 5.0",
      "5.0 – 10.0",
      "10.0 – 20.0",
      "20.0+",
    ]);
    // $bucket omits empty buckets; the service fills them back in as zero rows.
    expect(bandByLabel(bands, "10.0 – 20.0").runners).toBe(0);
    expect(bandByLabel(bands, "10.0 – 20.0").actualWinRate).toBe(0);
  });

  it("never produces an unbanded row for valid 0-100 probabilities", async () => {
    const { bands } = await service.getPriceBandAccuracy(ALL_RACES);
    expect(bands.find(b => b.label === "unbanded")).toBeUndefined();
  });

  it("places each runner in the band matching its model-implied price", async () => {
    const { bands } = await service.getPriceBandAccuracy({ ...ALL_RACES, courses: ["Ascot"] });
    expect(bandByLabel(bands, "under 2.0").runners).toBe(1); // model 60 -> 1.67
    expect(bandByLabel(bands, "3.0 – 5.0").runners).toBe(1); // model 25 -> 4.0
    expect(bandByLabel(bands, "5.0 – 10.0").runners).toBe(1); // model 12 -> 8.3
    expect(bandByLabel(bands, "20.0+").runners).toBe(1); // model 3 -> 33.3
    expect(bandByLabel(bands, "2.0 – 3.0").runners).toBe(0);
  });

  it("removes the overround from the market probability, keeping the raw one alongside", async () => {
    const { bands } = await service.getPriceBandAccuracy({ ...ALL_RACES, courses: ["Ascot"] });
    // isp 2 -> raw 50%, fair 48% (book sums to 104.17%)
    expect(bandByLabel(bands, "under 2.0").marketMeanProbRaw).toBe(50);
    expect(bandByLabel(bands, "under 2.0").marketMeanProbFair).toBe(48);
    // isp 8 -> raw 12.5%, fair 12%
    expect(bandByLabel(bands, "20.0+").marketMeanProbRaw).toBe(12.5);
    expect(bandByLabel(bands, "20.0+").marketMeanProbFair).toBe(12);
  });

  it("de-overrounded market probabilities sum to 100 across a race", async () => {
    const { bands } = await service.getPriceBandAccuracy({ ...ALL_RACES, courses: ["Ascot"] });
    const fairTotal = bands.reduce((s, b) => s + b.marketMeanProbFair * b.runners, 0);
    const rawTotal = bands.reduce((s, b) => s + b.marketMeanProbRaw * b.runners, 0);
    expect(fairTotal).toBeCloseTo(100, 6);
    // The raw book always overstates — that gap is the bookmaker's margin.
    expect(rawTotal).toBeGreaterThan(100);
  });

  it("raw market probability is never below the fair one in a populated band", async () => {
    const { bands } = await service.getPriceBandAccuracy(ALL_RACES);
    for (const band of bands.filter(b => b.runners > 0)) {
      expect(band.marketMeanProbRaw).toBeGreaterThanOrEqual(band.marketMeanProbFair);
    }
  });

  it("computes strike rate and signed error against what actually happened", async () => {
    const { bands } = await service.getPriceBandAccuracy({ ...ALL_RACES, courses: ["Ascot"] });
    const short = bandByLabel(bands, "under 2.0");
    expect(short.wins).toBe(1);
    expect(short.actualWinRate).toBe(100);
    expect(short.modelMeanProb).toBe(60);
    // Both under-rated the winner; the model was closer to the truth.
    expect(short.modelErrorPp).toBe(-40);
    expect(short.marketErrorPp).toBe(-52);
    expect(Math.abs(short.modelErrorPp)).toBeLessThan(Math.abs(short.marketErrorPp));
  });

  it("computes £1-to-win P&L per band", async () => {
    const { bands } = await service.getPriceBandAccuracy({ ...ALL_RACES, courses: ["Ascot"] });
    // isp 2 winner: stake 1/(2-1) = 1, returns 1+1 = 2, pnl +1
    const short = bandByLabel(bands, "under 2.0");
    expect(short.staked).toBe(1);
    expect(short.returns).toBe(2);
    expect(short.pnl).toBe(1);
    expect(short.roiPercent).toBe(100);
    // isp 4 loser: stake 1/3, returns 0
    const mid = bandByLabel(bands, "3.0 – 5.0");
    expect(mid.staked).toBeCloseTo(0.33, 2);
    expect(mid.returns).toBe(0);
    expect(mid.roiPercent).toBe(-100);
  });

  it("pnl equals returns minus staked in every band", async () => {
    const { bands, overall } = await service.getPriceBandAccuracy(ALL_RACES);
    // Exact, not approximate: pnl is derived from the same rounded figures the
    // screen displays, so the columns must add up on the penny.
    for (const band of [...bands, overall]) {
      expect(band.pnl).toBe(Math.round((band.returns - band.staked) * 100) / 100);
    }
  });

  it("computes Brier scores for model and market over the same runners", async () => {
    const { bands } = await service.getPriceBandAccuracy({ ...ALL_RACES, courses: ["Ascot"] });
    const short = bandByLabel(bands, "under 2.0");
    // model 60% on a winner -> (0.6 - 1)^2 = 0.16; market fair 48% -> 0.2704
    expect(short.modelBrier).toBeCloseTo(0.16, 6);
    expect(short.marketBrier).toBeCloseTo(0.2704, 6);
  });

  it("excludes runners with no model probability and runners with no isp", async () => {
    const { overall } = await service.getPriceBandAccuracy({ ...ALL_RACES, courses: ["Kempton"] });
    // Race 2 has 3 runners; only the isp 2.5 one is both priced and scored.
    expect(overall.runners).toBe(1);
    expect(overall.wins).toBe(1);
  });

  it("still counts unscored runners in the book when de-overrounding", async () => {
    const { bands } = await service.getPriceBandAccuracy({ ...ALL_RACES, courses: ["Kempton"] });
    // book = 100/2.5 + 100/1.5 = 106.667, so fair for isp 2.5 is 37.5, not 100.
    expect(bandByLabel(bands, "2.0 – 3.0").marketMeanProbRaw).toBe(40);
    expect(bandByLabel(bands, "2.0 – 3.0").marketMeanProbFair).toBe(37.5);
  });

  it("band runner counts sum to the overall row", async () => {
    const { bands, overall } = await service.getPriceBandAccuracy(ALL_RACES);
    expect(bands.reduce((s, b) => s + b.runners, 0)).toBe(overall.runners);
    expect(bands.reduce((s, b) => s + b.wins, 0)).toBe(overall.wins);
    expect(bands.reduce((s, b) => s + b.staked, 0)).toBeCloseTo(overall.staked, 2);
    expect(overall.runners).toBe(5); // 4 from race 1 + 1 bandable from race 2
  });

  it("every strike rate is a percentage and wins never exceed runners", async () => {
    const { bands, overall } = await service.getPriceBandAccuracy(ALL_RACES);
    for (const band of [...bands, overall]) {
      expect(band.actualWinRate).toBeGreaterThanOrEqual(0);
      expect(band.actualWinRate).toBeLessThanOrEqual(100);
      expect(band.wins).toBeLessThanOrEqual(band.runners);
    }
  });

  it("scopes to a date range", async () => {
    const { overall } = await service.getPriceBandAccuracy({
      ...ALL_RACES,
      minRaceTime: "2026-01-01",
      maxRaceTime: "2026-01-31T23:59:59.999",
    });
    expect(overall.runners).toBe(4); // race 1 only
  });

  // The model-version scoping test that used to live here was removed with the
  // filter itself: an out-of-sample probability has no single model behind it
  // (2019's rows come from a model fitted on 2015-2018, 2020's from one fitted
  // on 2015-2019), so there is nothing coherent for a version filter to select.

  it("reports coverage: how many eligible runners could actually be scored", async () => {
    const { coverage } = await service.getPriceBandAccuracy(ALL_RACES);
    // Seven runners across the two races. Runner G has no isp at all, so it
    // is not part of the measurable population — six eligible. Of those,
    // runner F is priced but carries no out-of-sample score.
    expect(coverage.eligibleRunners).toBe(6);
    expect(coverage.scoredRunners).toBe(5);
    expect(coverage.unscoredRunners).toBe(1);
    expect(coverage.coveragePercent).toBeCloseTo(83.33, 2);
  });

  it("the coverage scored count is exactly the population the bands describe", async () => {
    const { overall, coverage } = await service.getPriceBandAccuracy(ALL_RACES);
    // If these drift apart, the sentence on the screen is describing a
    // different set of runners from the table beneath it.
    expect(coverage.scoredRunners).toBe(overall.runners);
  });

  it("an unscored runner is left out of the bands, not counted as a 0% prediction", async () => {
    const { bands, overall } = await service.getPriceBandAccuracy({ ...ALL_RACES, courses: ["Kempton"] });
    // Race 2's runner F has a real SP (1.5) but no out-of-sample score. If it
    // were zero-filled it would land in the 20.0+ band as a runner the model
    // supposedly rated at 0% — inventing a prediction that was never made.
    expect(bandByLabel(bands, "20.0+").runners).toBe(0);
    expect(overall.runners).toBe(1);
  });

  it("a window with nothing scoreable reports 0% coverage rather than 100%", async () => {
    const { coverage } = await service.getPriceBandAccuracy({
      ...ALL_RACES,
      courses: ["Nowhere"],
    });
    expect(coverage.eligibleRunners).toBe(0);
    expect(coverage.scoredRunners).toBe(0);
    expect(coverage.coveragePercent).toBe(0);
  });

  it("scopes to going and race class", async () => {
    const soft = await service.getPriceBandAccuracy({ ...ALL_RACES, goings: ["Soft"] });
    expect(soft.overall.runners).toBe(1);
    const class1 = await service.getPriceBandAccuracy({ ...ALL_RACES, raceClasses: ["Class 1"] });
    expect(class1.overall.runners).toBe(4);
  });

  it("respects the field-size range", async () => {
    const bigFields = await service.getPriceBandAccuracy({ ...ALL_RACES, minRunners: 4 });
    expect(bigFields.overall.runners).toBe(4); // race 2 has only 3 runners
  });

  it("returns all-zero rows rather than NaN when nothing matches", async () => {
    const { bands, overall } = await service.getPriceBandAccuracy({ ...ALL_RACES, courses: ["Nowhere"] });
    expect(overall.runners).toBe(0);
    expect(overall.actualWinRate).toBe(0);
    expect(overall.roiPercent).toBe(0);
    expect(overall.modelBrier).toBe(0);
    for (const band of bands) {
      expect(Number.isNaN(band.modelMeanProb)).toBe(false);
      expect(Number.isNaN(band.marketErrorPp)).toBe(false);
    }
  });
});
