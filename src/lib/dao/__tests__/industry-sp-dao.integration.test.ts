import { MongoClient, Db } from "mongodb";
import { IndustrySpDAO } from "../industry-sp-dao";

const MONGO_URI = "mongodb://localhost:27019";
const DB_NAME = "betfair_nlp_dev";

describe("IndustrySpDAO (integration)", () => {
  let client: MongoClient;
  let db: Db;
  let dao: IndustrySpDAO;

  beforeAll(async () => {
    client = new MongoClient(MONGO_URI);
    await client.connect();
    db = client.db(DB_NAME);
    dao = new IndustrySpDAO(db);
  }, 15000);

  afterAll(async () => {
    await client.close();
  });

  it("returns races with total/totalRunners/pnlStats populated", async () => {
    const { data, total, totalRunners, pnlStats } = await dao.getAllRacesByRace(1, 20);
    expect(total).toBeGreaterThan(0);
    expect(totalRunners).toBeGreaterThan(0);
    expect(data.length).toBeGreaterThan(0);
    expect(typeof pnlStats.staked).toBe("number");
    expect(typeof pnlStats.returns).toBe("number");
    expect(typeof pnlStats.pnl).toBe("number");
  });

  it("each race has required fields with correct types", async () => {
    const { data } = await dao.getAllRacesByRace(1, 10);
    for (const race of data) {
      expect(typeof race.raceId).toBe("number");
      expect(typeof race.meetingId).toBe("string");
      expect(typeof race.course).toBe("string");
      expect(typeof race.countryCode).toBe("string");
      expect(typeof race.raceTime).toBe("string");
      expect(Array.isArray(race.runners)).toBe(true);
      for (const runner of race.runners) {
        expect(typeof runner.id).toBe("number");
        expect(typeof runner.name).toBe("string");
        expect(["WINNER", "PLACED", "LOSER", "NON_FINISHER"]).toContain(runner.status);
        expect(runner.isp).not.toBeNull();
        expect(runner.isp as number).toBeGreaterThan(1);
      }
    }
  });

  it("excludes REMOVED-equivalent (null-isp) runners from race counts", async () => {
    const bounds = await dao.getFilterBounds();
    const { data } = await dao.getAllRacesByRace(1, 5, 1, bounds.maxRunnersPerRace, [], bounds.minIsp, bounds.maxIsp);
    for (const race of data) {
      for (const runner of race.runners) {
        expect(runner.isp).toBeGreaterThanOrEqual(bounds.minIsp);
        expect(runner.isp).toBeLessThanOrEqual(bounds.maxIsp);
      }
    }
  });

  it("filters by country code", async () => {
    const countries = await dao.getDistinctCountryCodes();
    expect(countries.length).toBeGreaterThan(0);
    const country = countries[0];
    const { data } = await dao.getAllRacesByRace(1, 20, 1, 100, [country]);
    for (const race of data) {
      expect(race.countryCode).toBe(country);
    }
  });

  it("respects the limit parameter", async () => {
    const { data } = await dao.getAllRacesByRace(1, 3);
    expect(data.length).toBeLessThanOrEqual(3);
  });

  it("returns empty results for an unknown country", async () => {
    const { data, total } = await dao.getAllRacesByRace(1, 20, 1, 100, ["ZZ"]);
    expect(data).toHaveLength(0);
    expect(total).toBe(0);
  });

  it("sorts by raceTime ascending by default, descending when requested", async () => {
    const asc = await dao.getAllRacesByRace(1, 50, 1, 100, [], 1, 100000, "asc");
    for (let i = 1; i < asc.data.length; i++) {
      expect(new Date(asc.data[i].raceTime).getTime()).toBeGreaterThanOrEqual(
        new Date(asc.data[i - 1].raceTime).getTime()
      );
    }

    const desc = await dao.getAllRacesByRace(1, 50, 1, 100, [], 1, 100000, "desc");
    for (let i = 1; i < desc.data.length; i++) {
      expect(new Date(desc.data[i].raceTime).getTime()).toBeLessThanOrEqual(
        new Date(desc.data[i - 1].raceTime).getTime()
      );
    }
  });

  it("getFilterBounds returns sensible bounds", async () => {
    const bounds = await dao.getFilterBounds();
    expect(bounds.maxRunnersPerRace).toBeGreaterThan(0);
    expect(bounds.minIsp).toBeGreaterThan(1);
    expect(bounds.maxIsp).toBeGreaterThan(bounds.minIsp);
  });
});
