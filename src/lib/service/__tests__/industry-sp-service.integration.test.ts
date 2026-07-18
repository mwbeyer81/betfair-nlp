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

  it("defaults to an even first-half/second-half split of the grand total", async () => {
    const result = await service.getSplitStats();
    expect(result.totalRaces).toBeGreaterThan(0);

    const half = Math.floor(result.totalRaces / 2);
    expect(result.splitA.fromRow).toBe(1);
    expect(result.splitA.toRow).toBe(half);
    expect(result.splitB.fromRow).toBe(half + 1);
    expect(result.splitB.toRow).toBeNull();

    // Split A's own total should match the size of its row range.
    expect(result.splitA.total).toBe(half);
    // Split B picks up everything from half+1 through the end.
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
    expect(filtered.splitA.total + filtered.splitB.total).toBe(filtered.totalRaces);
  });
});
