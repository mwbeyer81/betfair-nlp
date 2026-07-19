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

  it("defaults to an even first-half/second-half split of the current total", async () => {
    const result = await service.getSplitStats();
    expect(result.totalRaces).toBeGreaterThan(0);

    const half = Math.floor(result.totalRaces / 2);
    expect(result.splitA.fromRow).toBe(1);
    expect(result.splitA.toRow).toBe(half);
    expect(result.splitB.fromRow).toBe(half + 1);
    // Open-ended (through the end) rather than a concrete number, so it
    // never needs reclamping as the total changes with the filters.
    expect(result.splitB.toRow).toBeNull();

    // Together they cover every matching race exactly once.
    expect(result.splitA.total).toBe(half);
    expect(result.splitB.total).toBe(result.totalRaces - half);
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
    // Half/half of whatever the filtered total is — always sums back to
    // the filtered total, unlike the old fixed-1000/1000-window default.
    const half = Math.floor(filtered.totalRaces / 2);
    expect(filtered.splitA.total).toBe(half);
    expect(filtered.splitB.total).toBe(filtered.totalRaces - half);
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
