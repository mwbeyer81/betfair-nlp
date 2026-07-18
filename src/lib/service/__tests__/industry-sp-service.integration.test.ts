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

  it("defaults to two fixed 1000-race windows (1-1000, 1001-2000)", async () => {
    const result = await service.getSplitStats();
    expect(result.totalRaces).toBeGreaterThan(2000);

    expect(result.splitA.fromRow).toBe(1);
    expect(result.splitA.toRow).toBe(1000);
    expect(result.splitB.fromRow).toBe(1001);
    expect(result.splitB.toRow).toBe(2000);

    // A fixed-size sample regardless of how large the total is — unlike
    // the old even-half default, these don't add up to totalRaces.
    expect(result.splitA.total).toBe(1000);
    expect(result.splitB.total).toBe(1000);
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

  it("filters (e.g. country) apply identically to both the grand total and both splits", async () => {
    const countries = await service.getDistinctCountryCodes();
    expect(countries.length).toBeGreaterThan(0);
    const country = countries[0];

    const filtered = await service.getSplitStats(1, 100, [country]);
    const unfiltered = await service.getSplitStats(1, 100, []);
    expect(filtered.totalRaces).toBeLessThanOrEqual(unfiltered.totalRaces);
    // Each fixed 1000-race window is clamped to whatever actually matched
    // the filter — the two windows only sum to the full total when the
    // filtered total happens to be <= 2000, so assert the clamp directly
    // rather than an equality that only held under the old half/half split.
    expect(filtered.splitA.total).toBe(Math.min(1000, filtered.totalRaces));
    expect(filtered.splitB.total).toBe(Math.max(0, Math.min(1000, filtered.totalRaces - 1000)));
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
});
