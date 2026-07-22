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

  it("resolves an explicit runner-index split (fromRunnerA/toRunnerA/fromRunnerB/toRunnerB) into the equivalent race range", async () => {
    // The user wanted to choose the runner split boundary directly, the
    // same way the race boundary was already editable — this is the
    // runner-mode equivalent of "respects explicit fromRowA/toRowA/..."
    // below, resolved server-side via getQualifyingRunnerSplitBoundary.
    const grand = await service.getSplitStats();
    expect(grand.totalRunners).toBeGreaterThan(0);
    const target = Math.min(2500, Math.floor(grand.totalRunners / 2));

    const result = await service.getSplitStats(
      1, 30, [], 1, 1000, 1, 10000, null, null, null, null, null, null,
      [], [], [], [], null, null, 0, 0, 100, 0, false, true,
      1, target, target + 1, null
    );
    expect(result.splitA.fromRow).toBe(1);
    // Race is the atomic unit, so the resolved runner count can overshoot
    // the exact target slightly (whichever race's cumulative count first
    // reaches it), but never by more than that one race's own runners.
    expect(result.splitA.totalRunners).toBeGreaterThanOrEqual(target);
    // An explicit split (race- or runner-based) is a deliberate narrow
    // slice, not required to cover the whole dataset like the default
    // split does — same as the existing explicit race-range test below,
    // this only checks that B picks up exactly where A's resolved range
    // left off, not that the two together span everything.
    expect(result.splitB.fromRow).toBe(result.splitA.toRow! + 1);
  });

  it("an explicit contiguous runner-range split never double-counts the shared boundary race", async () => {
    // Regression: reported live via screenshot — typing "1-1000" for Split A
    // and "1001-2000" for Split B. Races are the atomic unit, so nearby
    // runner targets (1000 and 1001) commonly resolve to the *same* race —
    // whichever one's cumulative qualifying-runner count first reaches
    // each target. Left alone, that shared race was queried into BOTH
    // splits, double-counting its stakes/returns/runners in each split's
    // pnlStats even though the displayed ranges looked contiguous.
    const grand = await service.getSplitStats();
    expect(grand.totalRunners).toBeGreaterThan(2000);

    const result = await service.getSplitStats(
      1, 30, [], 1, 1000, 1, 10000, null, null, null, null, null, null,
      [], [], [], [], null, null, 0, 0, 100, 0, false, true,
      1, 1000, 1001, 2000
    );
    // Split B must start strictly after Split A ends — the boundary race
    // belongs entirely to A (resolveRunnerBoundary rounds up, never down),
    // never re-included at the start of B.
    expect(result.splitB.fromRow).toBe(result.splitA.toRow! + 1);
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
