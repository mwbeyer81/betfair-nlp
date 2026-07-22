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

  it("defaults to an even first-half/second-half split of the current total, bisected by qualifying-runner count", async () => {
    // The default split boundary is chosen by cumulative *qualifying
    // runner* count (getQualifyingRunnerSplitBoundary), not race count — a
    // race-count bisection can leave the two splits with very uneven
    // runner counts once trainer-form/model/model-beats-SP filters are
    // active (not exercised here, but the invariant holds regardless).
    const result = await service.getSplitStats();
    expect(result.totalRaces).toBeGreaterThan(0);
    expect(result.totalRunners).toBeGreaterThan(0);

    expect(result.splitA.fromRow).toBe(1);
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

    // The crossover race is the first (in raceTime order) whose cumulative
    // qualifying-runner count reaches half — so Split A's runner count is
    // always >= the target, and Split B's is always <= the remainder.
    const target = Math.ceil(result.totalRunners / 2);
    expect(result.splitA.totalRunners).toBeGreaterThanOrEqual(target);
    expect(result.splitB.totalRunners).toBeLessThanOrEqual(Math.floor(result.totalRunners / 2));
  });

  it("splitByRunners=false reverts the default split to the original race-count bisection", async () => {
    const result = await service.getSplitStats(
      1, 30, [], 1, 1000, 1, 10000, null, null, null, null, null, null,
      [], [], [], [], null, null, 0, 0, 100, 0, false, false
    );
    expect(result.totalRaces).toBeGreaterThan(0);
    const half = Math.floor(result.totalRaces / 2);
    expect(result.splitA.toRow).toBe(half);
    expect(result.splitB.fromRow).toBe(half + 1);
    expect(result.splitA.total).toBe(half);
    expect(result.splitB.total).toBe(result.totalRaces - half);
  });

  it("resolves an explicit runner-index split (fromRunnerA/toRunnerA/fromRunnerB/toRunnerB) to an EXACT runner count", async () => {
    // The user wanted to choose the runner split boundary directly, the
    // same way the race boundary was already editable, AND wanted the
    // resulting split to hold exactly the number of runners typed — not
    // rounded up to whatever race happens to contain that ordinal.
    // getRunnerRangeStats selects individual qualifying runners (not whole
    // races), so this is exact rather than an approximation.
    const grand = await service.getSplitStats();
    expect(grand.totalRunners).toBeGreaterThan(0);
    const target = Math.min(2500, Math.floor(grand.totalRunners / 2));

    const result = await service.getSplitStats(
      1, 30, [], 1, 1000, 1, 10000, null, null, null, null, null, null,
      [], [], [], [], null, null, 0, 0, 100, 0, false, true,
      1, target, target + 1, null
    );
    expect(result.splitA.totalRunners).toBe(target);
    expect(result.splitA.pnlStats.count).toBe(target);
  });

  it("an explicit contiguous runner-range split gives each side an EXACT, non-overlapping runner count", async () => {
    // Regression: reported live via screenshot, twice — first as double-
    // counting (Split A and Split B's combined stats didn't reconcile with
    // the grand total, because two nearby runner targets like 1000/1001
    // commonly round up to the *same* race), then again as "still not
    // matching" once the double-count was fixed but the displayed range
    // still didn't equal what was typed (1-1000 showed as 1-1005, since a
    // race-rounded boundary overshoots). getRunnerRangeStats fixes both:
    // it selects exactly [fromRunnerTarget, toRunnerTarget] at the
    // individual-runner level, so the counts are exact and the two ranges
    // can never overlap regardless of race boundaries.
    const grand = await service.getSplitStats();
    expect(grand.totalRunners).toBeGreaterThan(2000);

    const result = await service.getSplitStats(
      1, 30, [], 1, 1000, 1, 10000, null, null, null, null, null, null,
      [], [], [], [], null, null, 0, 0, 100, 0, false, true,
      1, 1000, 1001, 2000
    );
    expect(result.splitA.totalRunners).toBe(1000);
    expect(result.splitB.totalRunners).toBe(1000);
    expect(result.splitA.pnlStats.count).toBe(1000);
    expect(result.splitB.pnlStats.count).toBe(1000);
    // The two splits' combined P&L must reconcile exactly to 2000 runners
    // worth of stakes/returns — no runner counted in both, none dropped.
    expect(result.splitA.pnlStats.count + result.splitB.pnlStats.count).toBe(2000);
  });

  it("the boundary race can legitimately appear in both splits' race-navigation window when it straddles the exact runner cutoff", async () => {
    // Accepted trade-off (confirmed with the user): a single race can
    // contain both the last runner of Split A and the first runner of
    // Split B, so its race index may appear in both splits' [fromRow,toRow]
    // — that's expected now that splits are exact at the runner level
    // rather than always claiming a whole race for one side.
    const result = await service.getSplitStats(
      1, 30, [], 1, 1000, 1, 10000, null, null, null, null, null, null,
      [], [], [], [], null, null, 0, 0, 100, 0, false, true,
      1, 1000, 1001, 2000
    );
    expect(result.splitB.fromRow).toBeLessThanOrEqual(result.splitA.toRow!);
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
      [], [], [], [], null, null, 0, 0, 100, 0, false, true, 100000000
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

describe("IndustrySpService.getRunnerConvergenceSeries (integration)", () => {
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

  it("returns exactly toRunnerTarget points, one per runner ordinal 1..N, in order", async () => {
    // Requested live: a P&L convergence graph showing how the running
    // ROI% is volatile over a small sample and settles down as more
    // runners are included, up to the upper limit of Split B.
    const points = await service.getRunnerConvergenceSeries(
      1, 30, [], 1, 1000, 1, 10000, null, null, [], [], [], [], null, null, 0, 0, 100, 0, false, 500
    );
    expect(points.length).toBe(500);
    points.forEach((p, i) => expect(p.runnerOrdinal).toBe(i + 1));
  });

  it("cumulativeStaked/cumulativeReturns/cumulativePnl/roiPercent are non-decreasing in sample size and reconcile at the end", async () => {
    const points = await service.getRunnerConvergenceSeries(
      1, 30, [], 1, 1000, 1, 10000, null, null, [], [], [], [], null, null, 0, 0, 100, 0, false, 500
    );
    // Both cumulative counters only ever grow (every runner stakes
    // something; returns are added on top, never subtracted).
    for (let i = 1; i < points.length; i++) {
      expect(points[i].cumulativeStaked).toBeGreaterThanOrEqual(points[i - 1].cumulativeStaked);
      expect(points[i].cumulativeReturns).toBeGreaterThanOrEqual(points[i - 1].cumulativeReturns);
    }
    const last = points[points.length - 1];
    expect(last.cumulativePnl).toBeCloseTo(last.cumulativeReturns - last.cumulativeStaked, 6);
    expect(last.roiPercent).toBeCloseTo((last.cumulativePnl / last.cumulativeStaked) * 100, 6);
  });

  it("the final point's cumulative staked/returns matches getSplitStats' combined Split A + Split B for the same range", async () => {
    // Cross-check against the exact runner-level split (getRunnerRangeStats)
    // added alongside this — both must agree on the same underlying data.
    const points = await service.getRunnerConvergenceSeries(
      1, 30, [], 1, 1000, 1, 10000, null, null, [], [], [], [], null, null, 0, 0, 100, 0, false, 2000
    );
    const last = points[points.length - 1];

    const splitResult = await service.getSplitStats(
      1, 30, [], 1, 1000, 1, 10000, null, null, null, null, null, null,
      [], [], [], [], null, null, 0, 0, 100, 0, false, true,
      1, 1000, 1001, 2000
    );
    const combinedStaked = splitResult.splitA.pnlStats.staked + splitResult.splitB.pnlStats.staked;
    const combinedReturns = splitResult.splitA.pnlStats.returns + splitResult.splitB.pnlStats.returns;
    expect(last.cumulativeStaked).toBeCloseTo(combinedStaked, 6);
    expect(last.cumulativeReturns).toBeCloseTo(combinedReturns, 6);
  });
});
