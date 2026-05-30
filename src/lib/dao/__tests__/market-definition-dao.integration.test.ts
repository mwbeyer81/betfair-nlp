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

    expect(Array.isArray(groups)).toBe(true);
    expect(groups.length).toBeGreaterThan(0);
  });

  it("each group has the required shape", async () => {
    const groups = await dao.groupByEventId();

    for (const group of groups) {
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

    for (const group of groups) {
      const unique = new Set(group.marketIds);
      expect(unique.size).toBe(group.marketIds.length);
    }
  });

  it("count equals the number of unique marketIds (not raw doc count)", async () => {
    const groups = await dao.groupByEventId();
    const first = groups[0];

    expect(first.count).toBe(first.marketIds.length);
  });

  it("results are sorted descending by count", async () => {
    const groups = await dao.groupByEventId();

    for (let i = 1; i < groups.length; i++) {
      expect(groups[i - 1].count).toBeGreaterThanOrEqual(groups[i].count);
    }
  });

  it("returns known Cheltenham event from seed data", async () => {
    const groups = await dao.groupByEventId();

    const cheltenham = groups.find(g => g.eventId === "33858191");
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
      const ids = race.runners.map(r => r.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("races are sorted by marketTime ascending", async () => {
    const races = await dao.getRunnersByRaceForEvent("33988522");
    for (let i = 1; i < races.length; i++) {
      expect(new Date(races[i - 1].marketTime).getTime())
        .toBeLessThanOrEqual(new Date(races[i].marketTime).getTime());
    }
  });

  it("returns empty array for unknown eventId", async () => {
    const races = await dao.getRunnersByRaceForEvent("nonexistent-event-99999");
    expect(races).toHaveLength(0);
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
