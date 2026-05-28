import { MongoClient, Db } from "mongodb";
import { MarketDefinitionDAO, EventGroup } from "../market-definition-dao";

const MONGO_URI = "mongodb://localhost:27017";
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

  it("count matches the actual number of documents for the event", async () => {
    const groups = await dao.groupByEventId();
    const first = groups[0];

    const actualCount = await db
      .collection("market_definitions")
      .countDocuments({ eventId: first.eventId });

    expect(first.count).toBe(actualCount);
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
