import { MongoClient, Db } from "mongodb";
import { PriceUpdateDAO } from "../price-update-dao";

const MONGO_URI = "mongodb://localhost:27019";
const DB_NAME = "betfair_nlp_dev";

describe("PriceUpdateDAO.getByEventId (integration)", () => {
  let client: MongoClient;
  let db: Db;
  let dao: PriceUpdateDAO;

  beforeAll(async () => {
    client = new MongoClient(MONGO_URI);
    await client.connect();
    db = client.db(DB_NAME);
    dao = new PriceUpdateDAO(db);
  }, 15000);

  afterAll(async () => {
    await client.close();
  });

  it("returns documents for eventId 33858191", async () => {
    const docs = await dao.getByEventId("33858191");
    expect(docs.length).toBeGreaterThan(0);
  });

  it("each document has required fields", async () => {
    const docs = await dao.getByEventId("33858191", 10);
    for (const doc of docs) {
      expect(typeof doc.eventId).toBe("string");
      expect(typeof doc.marketId).toBe("string");
      expect(typeof doc.runnerId).toBe("number");
      expect(typeof doc.runnerName).toBe("string");
      expect(typeof doc.lastTradedPrice).toBe("number");
      expect(typeof doc.changeId).toBe("string");
    }
  });

  it("respects the limit parameter", async () => {
    const docs = await dao.getByEventId("33858191", 5);
    expect(docs.length).toBeLessThanOrEqual(5);
  });

  it("returns empty array for unknown eventId", async () => {
    const docs = await dao.getByEventId("unknown-event-xyz-000");
    expect(docs).toEqual([]);
  });

  it("returns docs sorted descending by timestamp", async () => {
    const docs = await dao.getByEventId("33858191", 10);
    for (let i = 1; i < docs.length; i++) {
      const prev = new Date(docs[i - 1].timestamp).getTime();
      const curr = new Date(docs[i].timestamp).getTime();
      expect(prev).toBeGreaterThanOrEqual(curr);
    }
  });

  it("all returned docs belong to the requested eventId", async () => {
    const docs = await dao.getByEventId("33858191", 20);
    for (const doc of docs) {
      expect(doc.eventId).toBe("33858191");
    }
  });
});
