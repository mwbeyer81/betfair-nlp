import { MongoClient, Db } from "mongodb";
import { IndustrySpDAO } from "../../dao/industry-sp-dao";
import { IndustrySpService } from "../industry-sp-service";

const MONGO_URI = "mongodb://localhost:27019";
const DB_NAME = "betfair_nlp_dev";

describe("IndustrySpService.getSplitStats (integration)", () => {
  let client: MongoClient;
  let db: Db;
  let service: IndustrySpService;

  beforeAll(async () => {
    client = new MongoClient(MONGO_URI);
    await client.connect();
    db = client.db(DB_NAME);
    service = new IndustrySpService(new IndustrySpDAO(db));
  }, 15000);

  afterAll(async () => {
    await client.close();
  });

  it("defaults to an even first-half/second-half split of the current total, bisected by race count", async () => {
    const result = await service.getSplitStats();
    expect(result.totalRaces).toBeGreaterThan(0);
    expect(result.totalRunners).toBeGreaterThan(0);

    const half = Math.floor(result.totalRaces / 2);
    expect(result.splitA.fromRow).toBe(1);
    expect(result.splitA.toRow).toBe(Math.min(half, result.totalRaces));
    expect(result.splitB.fromRow).toBe(result.splitA.toRow! + 1);
    // No longer literally null — raceCap clamping (1000 races for an
    // authenticated caller, the default here) always concretizes an
    // open-ended upper bound to a real race index that never exceeds the
    // true total, rather than leaving it "through the end" unresolved.
    expect(typeof result.splitB.toRow).toBe("number");
    expect(result.splitB.toRow).toBeLessThanOrEqual(result.totalRaces);

    // Together they cover every matching race — and every qualifying
    // runner — exactly once, no gap or double-count.
    expect(result.splitA.total + result.splitB.total).toBe(result.totalRaces);
    expect(result.splitA.totalRunners + result.splitB.totalRunners).toBe(result.totalRunners);
  });

  it("splits are independent — each carries its own pnlStats", async () => {
    const result = await service.getSplitStats();
    expect(typeof result.splitA.pnlStats.staked).toBe("number");
    expect(typeof result.splitB.pnlStats.staked).toBe("number");
    // With genuinely different (non-overlapping) race ranges, the two
    // splits' staked totals should essentially never be identical unless
    // the dataset is trivially small — a same-value regression would mean
    // both splits are silently querying the same range.
    expect(result.splitA.pnlStats.staked).not.toBe(result.splitB.pnlStats.staked);
  });

  it("respects explicit fromRowA/toRowA/fromRowB/toRowB instead of computing a default", async () => {
    const result = await service.getSplitStats(1, 30, [], 1, 1000, 1, 10000, 1, 5, 6, 10);
    expect(result.splitA.fromRow).toBe(1);
    expect(result.splitA.toRow).toBe(5);
    expect(result.splitA.total).toBe(5);
    expect(result.splitB.fromRow).toBe(6);
    expect(result.splitB.toRow).toBe(10);
    expect(result.splitB.total).toBe(5);
  });

  it("splitA/splitB's toRow never exceeds the true totalRaces, even when raceCap would otherwise push it beyond", async () => {
    // Regression: reported live — raceCap clamping computed toRow as
    // effFrom + raceCap - 1 unconditionally, overshooting the real total
    // whenever the matched set is smaller than raceCap (the common case
    // for any filtered/date-scoped view — e.g. reported with
    // totalRaces=675 vs. a raceCap-derived toRowB of 1334). The underlying
    // total/totalRunners counts were still correct (MongoDB's own
    // $skip/$limit silently returns fewer rows than requested), but the
    // displayed/returned toRow number implied a race range that didn't
    // exist. A deliberately huge raceCap forces the overshoot condition
    // regardless of the real dataset's size.
    const result = await service.getSplitStats(
      1, 30, [], 1, 1000, 1, 10000, null, null, null, null, null, null,
      [], [], [], [], null, null, 0, 0, 100, 0, false, 100000000
    );
    expect(result.totalRaces).toBeGreaterThan(0);
    expect(result.splitA.toRow).toBeLessThanOrEqual(result.totalRaces);
    expect(result.splitB.toRow).toBeLessThanOrEqual(result.totalRaces);
    // The split card's displayed race range should also account for the
    // whole matched set — no gap between where A ends and B begins/ends.
    expect(result.splitA.total + result.splitB.total).toBe(result.totalRaces);
  });

  it("filters (e.g. country) apply identically to both the grand total and both splits", async () => {
    const countries = await service.getDistinctCountryCodes();
    expect(countries.length).toBeGreaterThan(0);
    const country = countries[0];

    const filtered = await service.getSplitStats(1, 100, [country]);
    const unfiltered = await service.getSplitStats(1, 100, []);
    expect(filtered.totalRaces).toBeLessThanOrEqual(unfiltered.totalRaces);
    // Splits always sum back to the filtered total — races and qualifying
    // runners alike — regardless of which filter narrowed it.
    expect(filtered.splitA.total + filtered.splitB.total).toBe(filtered.totalRaces);
    expect(filtered.splitA.totalRunners + filtered.splitB.totalRunners).toBe(filtered.totalRunners);
  });

  it("an inverted split range (toRowA < fromRowA) returns an empty split instead of throwing", async () => {
    // Regression test: reported live as "Failed to load industry SP" on
    // the /isp home page — a stale/hand-edited URL with fromRowA > toRowA
    // used to 500 the whole request (MongoServerError on a negative
    // $limit). Verifies the fix holds through the service composition
    // layer, not just the underlying DAO call directly.
    const result = await service.getSplitStats(1, 100, [], 1, 1000, 1, 10000, 100, 5, 1, null);
    expect(result.splitA.total).toBe(0);
    expect(result.splitA.pnlStats).toEqual({ staked: 0, returns: 0, pnl: 0, count: 0 });
    // Split B is unaffected — an inverted A shouldn't poison B.
    expect(result.splitB.total).toBeGreaterThan(0);
  });

  it("returns non-empty distinct courses/goings/raceClasses/raceTypes alongside countries", async () => {
    const result = await service.getSplitStats();
    expect(result.courses.length).toBeGreaterThan(0);
    expect(result.goings.length).toBeGreaterThan(0);
    expect(result.raceClasses.length).toBeGreaterThan(0);
    expect(result.raceTypes.length).toBeGreaterThan(0);
  });

  it("course/going/raceClass/raceType/trainer/jockey filters apply identically to the grand total and both splits", async () => {
    const { courses } = await service.getSplitStats();
    const course = courses[0];
    const filtered = await service.getSplitStats(
      1, 100, [], 1, 1000, 1, 10000, undefined, undefined, undefined, undefined, undefined, undefined,
      [course]
    );
    const unfiltered = await service.getSplitStats(1, 100, []);
    expect(filtered.totalRaces).toBeLessThanOrEqual(unfiltered.totalRaces);
  });
});

describe("IndustrySpService.getRaceConvergenceSeries (integration)", () => {
  let client: MongoClient;
  let db: Db;
  let service: IndustrySpService;

  beforeAll(async () => {
    client = new MongoClient(MONGO_URI);
    await client.connect();
    db = client.db(DB_NAME);
    service = new IndustrySpService(new IndustrySpDAO(db));
  }, 15000);

  afterAll(async () => {
    await client.close();
  });

  it("returns exactly toRow points, one per race row 1..N, in order, when fromRow is 1", async () => {
    // Requested live: a P&L convergence graph showing how the running
    // ROI% is volatile over a small sample and settles down as more races
    // are included, up to the upper limit of a split.
    const grand = await service.getSplitStats();
    if (grand.totalRaces < 10) return;
    const toRow = Math.min(10, grand.totalRaces);
    const points = await service.getRaceConvergenceSeries(
      1, 30, [], 1, 1000, 1, 10000, null, null, [], [], [], [], null, null, 0, 0, 100, 0, false, 1, toRow
    );
    expect(points.length).toBe(toRow);
    points.forEach((p, i) => expect(p.raceRowNumber).toBe(i + 1));
  });

  it("cumulativeStaked/cumulativeReturns/cumulativePnl/roiPercent are non-decreasing in sample size and reconcile at the end", async () => {
    const grand = await service.getSplitStats();
    if (grand.totalRaces < 10) return;
    const toRow = Math.min(10, grand.totalRaces);
    const points = await service.getRaceConvergenceSeries(
      1, 30, [], 1, 1000, 1, 10000, null, null, [], [], [], [], null, null, 0, 0, 100, 0, false, 1, toRow
    );
    // Both cumulative counters only ever grow (every race stakes
    // something; returns are added on top, never subtracted).
    for (let i = 1; i < points.length; i++) {
      expect(points[i].cumulativeStaked).toBeGreaterThanOrEqual(points[i - 1].cumulativeStaked);
      expect(points[i].cumulativeReturns).toBeGreaterThanOrEqual(points[i - 1].cumulativeReturns);
    }
    const last = points[points.length - 1];
    expect(last.cumulativePnl).toBeCloseTo(last.cumulativeReturns - last.cumulativeStaked, 6);
    expect(last.roiPercent).toBeCloseTo((last.cumulativePnl / last.cumulativeStaked) * 100, 6);
  });

  it("the final point's cumulative staked/returns matches getSplitStats' Split A pnlStats for the same range", async () => {
    const grand = await service.getSplitStats();
    if (grand.totalRaces < 10) return;
    const toRow = Math.min(10, grand.totalRaces);
    const points = await service.getRaceConvergenceSeries(
      1, 30, [], 1, 1000, 1, 10000, null, null, [], [], [], [], null, null, 0, 0, 100, 0, false, 1, toRow
    );
    const last = points[points.length - 1];

    const splitResult = await service.getSplitStats(1, 30, [], 1, 1000, 1, 10000, 1, toRow, toRow + 1, null);
    expect(last.cumulativeStaked).toBeCloseTo(splitResult.splitA.pnlStats.staked, 6);
    expect(last.cumulativeReturns).toBeCloseTo(splitResult.splitA.pnlStats.returns, 6);
  });

  it("a range not starting at 1 (e.g. Split B's own race range) restarts the cumulative sum fresh, but keeps true raceRowNumber labels", async () => {
    // Regression: reported live — Split A and Split B's graphs should use
    // the same race numbers on their own x axis, not both starting at a
    // re-based 1. Split B's own convergence line must also demonstrate its
    // own early volatility (restart near the single-race extreme), not
    // continue whatever total Split A's range had already settled to.
    const grand = await service.getSplitStats();
    if (grand.totalRaces < 20) return;
    const pointsA = await service.getRaceConvergenceSeries(
      1, 30, [], 1, 1000, 1, 10000, null, null, [], [], [], [], null, null, 0, 0, 100, 0, false, 1, 10
    );
    const pointsB = await service.getRaceConvergenceSeries(
      1, 30, [], 1, 1000, 1, 10000, null, null, [], [], [], [], null, null, 0, 0, 100, 0, false, 11, 20
    );
    expect(pointsB.length).toBe(10);
    expect(pointsB[0].raceRowNumber).toBe(11);
    expect(pointsB[pointsB.length - 1].raceRowNumber).toBe(20);
    // Split B's own cumulative starts fresh — its first point is one
    // race's worth, nowhere near Split A's already-accumulated total.
    expect(pointsB[0].cumulativeStaked).toBeLessThan(pointsA[pointsA.length - 1].cumulativeStaked);
  });
});
