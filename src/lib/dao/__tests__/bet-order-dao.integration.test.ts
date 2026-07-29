import { MongoClient, Db, ObjectId } from "mongodb";
import { BetOrderDAO, BetOrderDocument } from "../bet-order-dao";

const MONGO_URI = "mongodb://localhost:27019";
// Uniquely-named throwaway database per test run, same convention as
// model-version-dao.integration.test.ts — this suite writes synthetic
// orders, so a fresh db avoids colliding with real data or a concurrently
// running test suite, dropped entirely in afterAll.
const DB_NAME = `betfair_nlp_test_bet_orders_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

function makeDoc(overrides: Partial<BetOrderDocument> = {}): Omit<BetOrderDocument, "_id"> {
  const now = "2026-07-29T08:00:00.000Z";
  return {
    userId: "user1",
    runnerId: "hrs_1",
    horse: "Artagnan",
    course: "Redcar",
    offTime: "2:05",
    offDt: "2026-07-29T14:05:00.000Z",
    raceId: "rac_1",
    eventId: "redcar-2026-07-29",
    targetProfit: 20,
    maxStake: 10,
    minQualifyingPrice: 3,
    status: "pending",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("BetOrderDAO (integration)", () => {
  let client: MongoClient;
  let db: Db;
  let dao: BetOrderDAO;

  beforeAll(async () => {
    client = new MongoClient(MONGO_URI);
    await client.connect();
    db = client.db(DB_NAME);
    dao = new BetOrderDAO(db);
    await dao.createIndexes();
  }, 15000);

  afterAll(async () => {
    await db.dropDatabase();
    await client.close();
  });

  it("creates an order and lists it back for its owner, newest first", async () => {
    await dao.create(makeDoc({ userId: "userA", createdAt: "2026-07-29T08:00:00.000Z" }));
    await dao.create(makeDoc({ userId: "userA", createdAt: "2026-07-29T09:00:00.000Z", horse: "Vanilla Skies" }));
    await dao.create(makeDoc({ userId: "userB" }));

    const forA = await dao.listByUser("userA");
    expect(forA).toHaveLength(2);
    expect(forA[0].horse).toBe("Vanilla Skies"); // newest createdAt first
  });

  it("getByIdForUser returns null for another user's order (ownership isolation)", async () => {
    const created = await dao.create(makeDoc({ userId: "userC" }));
    const asOwner = await dao.getByIdForUser(created._id!.toString(), "userC");
    const asOther = await dao.getByIdForUser(created._id!.toString(), "someone-else");
    expect(asOwner).not.toBeNull();
    expect(asOther).toBeNull();
  });

  it("cancelByIdForUser cancels a pending order and is reflected in a re-fetch", async () => {
    const created = await dao.create(makeDoc({ userId: "userD", status: "pending" }));
    const cancelled = await dao.cancelByIdForUser(created._id!.toString(), "userD");
    expect(cancelled).toBe(true);
    const refetched = await dao.getByIdForUser(created._id!.toString(), "userD");
    expect(refetched?.status).toBe("cancelled");
  });

  it("cancelByIdForUser refuses to cancel an already-triggered order", async () => {
    const created = await dao.create(makeDoc({ userId: "userE", status: "triggered" }));
    const cancelled = await dao.cancelByIdForUser(created._id!.toString(), "userE");
    expect(cancelled).toBe(false);
  });

  it("listAllOpen returns pending/unmatched orders across all users, excluding terminal statuses", async () => {
    await db.collection("bet_orders").deleteMany({}); // isolate from prior tests' leftover docs
    await dao.create(makeDoc({ userId: "u1", status: "pending" }));
    await dao.create(makeDoc({ userId: "u2", status: "unmatched" }));
    await dao.create(makeDoc({ userId: "u3", status: "triggered" }));
    await dao.create(makeDoc({ userId: "u4", status: "expired" }));
    await dao.create(makeDoc({ userId: "u5", status: "cancelled" }));
    await dao.create(makeDoc({ userId: "u6", status: "error" }));

    const open = await dao.listAllOpen();
    expect(open.map(o => o.userId).sort()).toEqual(["u1", "u2"]);
  });

  it("tryTransition only succeeds when the current status matches `from`, and is not re-triggerable after winning once", async () => {
    const created = await dao.create(makeDoc({ status: "pending" }));
    const id = created._id!;

    const firstAttempt = await dao.tryTransition(id, "pending", "placing");
    expect(firstAttempt).toBe(true);

    // Simulates a second, overlapping evaluator invocation trying the same
    // compare-and-swap immediately after — this is the real double-bet
    // guard, so it must fail once the first attempt already won.
    const secondAttempt = await dao.tryTransition(id, "pending", "placing");
    expect(secondAttempt).toBe(false);

    const refetched = await dao.getByIdForUser(id.toString(), created.userId);
    expect(refetched?.status).toBe("placing");
  });

  it("updateFields with an explicit undefined value clears the field via $unset, not a silent no-op", async () => {
    const created = await dao.create(makeDoc({ note: "stale unmatched reason" }));
    await dao.updateFields(created._id!, { status: "pending", note: undefined });
    const refetched = await dao.getByIdForUser(created._id!.toString(), created.userId);
    expect(refetched?.status).toBe("pending");
    expect(refetched?.note).toBeUndefined();
  });
});
