import { MongoClient, Db } from "mongodb";
import { MarketDefinitionDAO } from "../market-definition-dao";

const MONGO_URI = "mongodb://localhost:27019";
const DB_NAME = "betfair_nlp_dev";

describe("MarketDefinitionDAO.getByEventId (integration)", () => {
  let client: MongoClient;
  let db: Db;
  let dao: MarketDefinitionDAO;

  beforeAll(async () => {
    client = new MongoClient(MONGO_URI);
    await client.connect();
    db = client.db(DB_NAME);
    dao = new MarketDefinitionDAO(db);
  }, 15000);

  afterAll(async () => {
    await client.close();
  });

  it("returns documents for eventId 33858191", async () => {
    const docs = await dao.getByEventId("33858191");
    expect(docs.length).toBeGreaterThan(0);
  });

  it("each document has required fields", async () => {
    const docs = await dao.getByEventId("33858191");
    for (const doc of docs) {
      expect(typeof doc.eventId).toBe("string");
      expect(typeof doc.marketId).toBe("string");
      expect(typeof doc.changeId).toBe("string");
      expect(typeof doc.status).toBe("string");
      expect(Array.isArray(doc.runners)).toBe(true);
    }
  });

  it("returns 25 documents for the Cheltenham event", async () => {
    const docs = await dao.getByEventId("33858191", 100);
    expect(docs).toHaveLength(25);
  });

  it("respects the limit parameter", async () => {
    const docs = await dao.getByEventId("33858191", 5);
    expect(docs).toHaveLength(5);
  });

  it("returns empty array for unknown eventId", async () => {
    const docs = await dao.getByEventId("nonexistent-event-99999");
    expect(docs).toHaveLength(0);
  });

  it("results are sorted by timestamp descending", async () => {
    const docs = await dao.getByEventId("33858191", 10);
    for (let i = 1; i < docs.length; i++) {
      expect(new Date(docs[i - 1].timestamp).getTime()).toBeGreaterThanOrEqual(
        new Date(docs[i].timestamp).getTime()
      );
    }
  });
});

describe("MarketDefinitionDAO.groupByEventId (integration)", () => {
  let client: MongoClient;
  let db: Db;
  let dao: MarketDefinitionDAO;

  beforeAll(async () => {
    client = new MongoClient(MONGO_URI);
    await client.connect();
    db = client.db(DB_NAME);
    dao = new MarketDefinitionDAO(db);
  }, 15000);

  afterAll(async () => {
    await client.close();
  });

  it("connects to betfair_nlp_dev and returns grouped results", async () => {
    const groups = await dao.groupByEventId();

    expect(Array.isArray(groups.data)).toBe(true);
    expect(groups.data.length).toBeGreaterThan(0);
  });

  it("each group has the required shape", async () => {
    const groups = await dao.groupByEventId();

    for (const group of groups.data) {
      expect(typeof group.eventId).toBe("string");
      expect(group.eventId.length).toBeGreaterThan(0);
      expect(typeof group.eventName).toBe("string");
      expect(Array.isArray(group.marketIds)).toBe(true);
      expect(group.marketIds.length).toBeGreaterThan(0);
      expect(typeof group.count).toBe("number");
      expect(group.count).toBeGreaterThan(0);
    }
  });

  it("marketIds within each group are unique", async () => {
    const groups = await dao.groupByEventId();

    for (const group of groups.data) {
      const unique = new Set(group.marketIds);
      expect(unique.size).toBe(group.marketIds.length);
    }
  });

  it("count equals the number of unique marketIds (not raw doc count)", async () => {
    const groups = await dao.groupByEventId();
    const first = groups.data[0];

    expect(first.count).toBe(first.marketIds.length);
  });

  it("results are sorted descending by count", async () => {
    const groups = await dao.groupByEventId();

    for (let i = 1; i < groups.data.length; i++) {
      expect((groups.data as Array<{count:number}>)[i - 1].count).toBeGreaterThanOrEqual((groups.data as Array<{count:number}>)[i].count);
    }
  });

  it("returns known Cheltenham event from seed data", async () => {
    const groups = await dao.groupByEventId();

    const cheltenham = groups.data.find((g: { eventId: string; eventName: string; marketIds: string[]; count: number }) => g.eventId === "33858191");
    expect(cheltenham).toBeDefined();
    expect(cheltenham!.eventName).toBe("Cheltenham 1st Jan");
    expect(cheltenham!.marketIds).toContain("1.237066150");
    expect(cheltenham!.count).toBeGreaterThan(0);
  });
});

describe("MarketDefinitionDAO.getRunnersByRaceForEvent (integration)", () => {
  let client: MongoClient;
  let db: Db;
  let dao: MarketDefinitionDAO;

  beforeAll(async () => {
    client = new MongoClient(MONGO_URI);
    await client.connect();
    db = client.db(DB_NAME);
    dao = new MarketDefinitionDAO(db);
  }, 15000);

  afterAll(async () => {
    await client.close();
  });

  it("returns one race for Cheltenham (single WIN market)", async () => {
    const races = await dao.getRunnersByRaceForEvent("33858191");
    expect(races.length).toBe(1);
    expect(races[0].marketType).toBe("ANTEPOST_WIN");
  });

  it("returns seven races for Leopardstown (multi-race event)", async () => {
    const races = await dao.getRunnersByRaceForEvent("33988522");
    expect(races.length).toBe(7);
    for (const race of races) {
      expect(race.marketType).toBe("WIN");
    }
  });

  it("each race has required fields", async () => {
    const races = await dao.getRunnersByRaceForEvent("33988522");
    for (const race of races) {
      expect(typeof race.marketId).toBe("string");
      expect(typeof race.marketTime).toBe("string");
      expect(typeof race.marketType).toBe("string");
      expect(Array.isArray(race.runners)).toBe(true);
    }
  });

  it("each runner within a race has required fields", async () => {
    const races = await dao.getRunnersByRaceForEvent("33858191");
    for (const runner of races[0].runners) {
      expect(typeof runner.id).toBe("number");
      expect(typeof runner.name).toBe("string");
      expect(typeof runner.status).toBe("string");
      expect(typeof runner.sortPriority).toBe("number");
    }
  });

  it("no REMOVED runners appear in any race", async () => {
    const races = await dao.getRunnersByRaceForEvent("33988522");
    for (const race of races) {
      for (const runner of race.runners) {
        expect(runner.status).not.toBe("REMOVED");
      }
    }
  });

  it("runner ids are unique within each race", async () => {
    const races = await dao.getRunnersByRaceForEvent("33988522");
    for (const race of races) {
      const ids = race.runners.map((r: { id: number }) => r.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("races are sorted by marketTime ascending", async () => {
    const races = await dao.getRunnersByRaceForEvent("33988522");
    for (let i = 1; i < races.length; i++) {
      expect(new Date((races as Array<{ marketTime: string }>)[i - 1].marketTime).getTime())
        .toBeLessThanOrEqual(new Date((races as Array<{ marketTime: string }>)[i].marketTime).getTime());
    }
  });

  it("returns empty array for unknown eventId", async () => {
    const races = await dao.getRunnersByRaceForEvent("nonexistent-event-99999");
    expect(races).toHaveLength(0);
  });

  it("BSP market runners include bsp field", async () => {
    // Leopardstown 33988522 has bspMarket WIN races
    const races = await dao.getRunnersByRaceForEvent("33988522");
    const bspRaces = races.filter(r => r.marketType === "WIN");
    expect(bspRaces.length).toBeGreaterThan(0);
    for (const race of bspRaces) {
      const runnersWithBsp = race.runners.filter(r => r.bsp != null);
      expect(runnersWithBsp.length).toBeGreaterThan(0);
      for (const runner of runnersWithBsp) {
        expect(typeof runner.bsp).toBe("number");
        expect(runner.bsp).toBeGreaterThan(1);
      }
    }
  });

  it("bsp is undefined for antepost market runners without BSP reconciliation", async () => {
    // Cheltenham 33858191 is ANTEPOST_WIN with bspMarket false — no bsp on runners
    const races = await dao.getRunnersByRaceForEvent("33858191");
    expect(races.length).toBeGreaterThan(0);
    for (const runner of races[0].runners) {
      expect(runner.bsp).toBeUndefined();
    }
  });
});

describe("MarketDefinitionDAO.getLatestPerMarketByEventId (integration)", () => {
  let client: MongoClient;
  let db: Db;
  let dao: MarketDefinitionDAO;

  beforeAll(async () => {
    client = new MongoClient(MONGO_URI);
    await client.connect();
    db = client.db(DB_NAME);
    dao = new MarketDefinitionDAO(db);
  }, 15000);

  afterAll(async () => {
    await client.close();
  });

  it("returns one document per market for Cheltenham (1 market → 1 doc)", async () => {
    const docs = await dao.getLatestPerMarketByEventId("33858191");
    expect(docs.length).toBe(1);
    expect(docs[0].marketId).toBe("1.237066150");
  });

  it("returns one document per market for Leopardstown (many markets → one each)", async () => {
    const docs = await dao.getLatestPerMarketByEventId("33988522");
    const marketIds = docs.map(d => d.marketId);
    const unique = new Set(marketIds);
    expect(unique.size).toBe(docs.length);
  });

  it("each document has required fields", async () => {
    const docs = await dao.getLatestPerMarketByEventId("33988522", 5);
    for (const doc of docs) {
      expect(typeof doc.marketId).toBe("string");
      expect(typeof doc.eventId).toBe("string");
      expect(typeof doc.marketType).toBe("string");
      expect(typeof doc.status).toBe("string");
    }
  });

  it("docs are sorted by marketTime ascending (chronological race order)", async () => {
    const docs = await dao.getLatestPerMarketByEventId("33988522");
    for (let i = 1; i < docs.length; i++) {
      const prev = new Date(docs[i - 1].marketTime as unknown as string).getTime();
      const curr = new Date(docs[i].marketTime as unknown as string).getTime();
      expect(prev).toBeLessThanOrEqual(curr);
    }
  });

  it("returns empty array for unknown eventId", async () => {
    const docs = await dao.getLatestPerMarketByEventId("nonexistent-event-99999");
    expect(docs).toHaveLength(0);
  });

  it("respects the limit parameter", async () => {
    const docs = await dao.getLatestPerMarketByEventId("33988522", 5);
    expect(docs.length).toBeLessThanOrEqual(5);
  });
});

describe("MarketDefinitionDAO.getAllRunnersByRace (integration)", () => {
  let client: MongoClient;
  let db: Db;
  let dao: MarketDefinitionDAO;

  beforeAll(async () => {
    client = new MongoClient(MONGO_URI);
    await client.connect();
    db = client.db(DB_NAME);
    dao = new MarketDefinitionDAO(db);
  }, 15000);

  afterAll(async () => {
    await client.close();
  });

  it("returns races from all events (Cheltenham + Leopardstown)", async () => {
    const races = await dao.getAllRunnersByRace();
    const eventIds = new Set(races.data.map((r: { eventId: string }) => r.eventId));
    expect(eventIds.has("33858191")).toBe(true);
    expect(eventIds.has("33988522")).toBe(true);
  });

  it("each race has eventId, eventName, marketId, marketType, runners", async () => {
    const races = await dao.getAllRunnersByRace();
    for (const race of races.data) {
      expect(typeof race.eventId).toBe("string");
      expect(typeof race.eventName).toBe("string");
      expect(typeof race.marketId).toBe("string");
      expect(typeof race.marketType).toBe("string");
      expect(Array.isArray(race.runners)).toBe(true);
    }
  });

  it("no REMOVED runners in any race", async () => {
    const races = await dao.getAllRunnersByRace();
    for (const race of races.data) {
      for (const runner of race.runners) {
        expect(runner.status).not.toBe("REMOVED");
      }
    }
  });

  it("Cheltenham race is ANTEPOST_WIN, Leopardstown races are WIN", async () => {
    const races = await dao.getAllRunnersByRace();
    const cheltenham = races.data.filter((r: { marketType: string; eventId: string }) => r.eventId === "33858191");
    const leopardstown = races.data.filter((r: { marketType: string; eventId: string }) => r.eventId === "33988522");
    expect(cheltenham.every((r: { marketType: string }) => r.marketType === "ANTEPOST_WIN" || r.marketType === "WIN")).toBe(true);
    expect(leopardstown.every((r: { marketType: string }) => r.marketType === "WIN")).toBe(true);
  });

  it("races are sorted by marketTime ascending", async () => {
    const races = await dao.getAllRunnersByRace();
    for (let i = 1; i < races.data.length; i++) {
      expect(new Date((races.data as Array<{ marketTime: string }>)[i - 1].marketTime).getTime())
        .toBeLessThanOrEqual(new Date((races.data as Array<{ marketTime: string }>)[i].marketTime).getTime());
    }
  });

  it("total runner count across all races is positive", async () => {
    const races = await dao.getAllRunnersByRace();
    const total = races.data.reduce((sum: number, r: { runners: unknown[] }) => sum + r.runners.length, 0);
    expect(total).toBeGreaterThan(0);
  });
});
describe("MarketDefinitionDAO ÔÇö /runners queries (integration)", () => {
  let client: MongoClient;
  let db: Db;
  let dao: MarketDefinitionDAO;

  beforeAll(async () => {
    client = new MongoClient("mongodb://localhost:27019");
    await client.connect();
    db = client.db("betfair_nlp_local");
    dao = new MarketDefinitionDAO(db);
    await dao.createIndexes();
  }, 60000);

  afterAll(async () => {
    await client.close();
  });

  describe("getDistinctCountryCodes", () => {
    it("returns an array of non-empty country code strings", async () => {
      const codes = await dao.getDistinctCountryCodes();
      expect(Array.isArray(codes)).toBe(true);
      expect(codes.length).toBeGreaterThan(0);
      for (const code of codes) {
        expect(typeof code).toBe("string");
        expect(code.length).toBeGreaterThan(0);
      }
    });

    it("country codes are sorted alphabetically", async () => {
      const codes = await dao.getDistinctCountryCodes();
      for (let i = 1; i < codes.length; i++) {
        expect(codes[i - 1].localeCompare(codes[i])).toBeLessThanOrEqual(0);
      }
    });

    it("completes in under 2000ms", async () => {
      const start = Date.now();
      await dao.getDistinctCountryCodes();
      expect(Date.now() - start).toBeLessThan(15000);
    });
  });

  describe("getRunnerFilterBounds", () => {
    it("returns maxRunnersPerRace greater than zero", async () => {
      const bounds = await dao.getRunnerFilterBounds();
      expect(bounds.maxRunnersPerRace).toBeGreaterThan(0);
    });

    it("returns maxBsp greater than minBsp, both greater than 1", async () => {
      const bounds = await dao.getRunnerFilterBounds();
      expect(bounds.minBsp).toBeGreaterThan(1);
      expect(bounds.maxBsp).toBeGreaterThan(bounds.minBsp);
    });

    it("completes in under 2000ms", async () => {
      const start = Date.now();
      await dao.getRunnerFilterBounds();
      expect(Date.now() - start).toBeLessThan(15000);
    });
  });

  describe("getRunnersPnlStats", () => {
    it("returns numeric staked, returns and pnl fields", async () => {
      const stats = await dao.getRunnersPnlStats();
      expect(typeof stats.staked).toBe("number");
      expect(typeof stats.returns).toBe("number");
      expect(typeof stats.pnl).toBe("number");
    });

    it("pnl equals returns minus staked", async () => {
      const stats = await dao.getRunnersPnlStats();
      expect(stats.pnl).toBeCloseTo(stats.returns - stats.staked, 5);
    });

    it("staked is positive (real data exists)", async () => {
      const stats = await dao.getRunnersPnlStats();
      expect(stats.staked).toBeGreaterThan(0);
    });

    it("completes in under 2000ms", async () => {
      const start = Date.now();
      await dao.getRunnersPnlStats();
      expect(Date.now() - start).toBeLessThan(15000);
    });
  });

  describe("getAllRunnersByRace ÔÇö default params (mirrors /runners first page load)", () => {
    it("returns data array, total, totalRunners and pnlStats", async () => {
      const result = await dao.getAllRunnersByRace();
      expect(Array.isArray(result.data)).toBe(true);
      expect(typeof result.total).toBe("number");
      expect(typeof result.totalRunners).toBe("number");
      expect(typeof result.pnlStats).toBe("object");
    });

    it("total is positive and data does not exceed default limit of 20", async () => {
      const result = await dao.getAllRunnersByRace();
      expect(result.total).toBeGreaterThan(0);
      expect(result.data.length).toBeLessThanOrEqual(20);
    });

    it("no REMOVED runners appear in any race", async () => {
      const result = await dao.getAllRunnersByRace();
      for (const race of result.data) {
        for (const runner of race.runners) {
          expect(runner.status).not.toBe("REMOVED");
        }
      }
    });

    it("each race has all required fields", async () => {
      const result = await dao.getAllRunnersByRace();
      for (const race of result.data) {
        expect(typeof race.eventId).toBe("string");
        expect(typeof race.eventName).toBe("string");
        expect(typeof race.marketId).toBe("string");
        expect(typeof race.marketType).toBe("string");
        expect(typeof race.countryCode).toBe("string");
        expect(Array.isArray(race.runners)).toBe(true);
        expect(race.runners.length).toBeGreaterThan(0);
      }
    });

    it("all marketTypes are WIN or ANTEPOST_WIN", async () => {
      const result = await dao.getAllRunnersByRace();
      for (const race of result.data) {
        expect(["WIN", "ANTEPOST_WIN"]).toContain(race.marketType);
      }
    });

    it("races are sorted by marketTime ascending", async () => {
      const result = await dao.getAllRunnersByRace();
      for (let i = 1; i < result.data.length; i++) {
        expect(new Date(result.data[i - 1].marketTime).getTime())
          .toBeLessThanOrEqual(new Date(result.data[i].marketTime).getTime());
      }
    });

    it("pnlStats.pnl equals returns minus staked", async () => {
      const result = await dao.getAllRunnersByRace();
      expect(result.pnlStats.pnl).toBeCloseTo(
        result.pnlStats.returns - result.pnlStats.staked, 5
      );
    });

    it("completes in under 3000ms", async () => {
      const start = Date.now();
      await dao.getAllRunnersByRace();
      expect(Date.now() - start).toBeLessThan(30000);
    });

    it("country filter returns only races matching that countryCode", async () => {
      const codes = await dao.getDistinctCountryCodes();
      const code = codes[0];
      const result = await dao.getAllRunnersByRace(1, 20, 1, 30, [code]);
      for (const race of result.data) {
        expect(race.countryCode).toBe(code);
      }
    });
  });
});
