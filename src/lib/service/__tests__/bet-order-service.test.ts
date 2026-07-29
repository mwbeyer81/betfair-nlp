import { ObjectId } from "mongodb";
import { BetOrderService } from "../bet-order-service";
import { BetOrderDAO, BetOrderDocument } from "../../dao/bet-order-dao";
import { BetfairApiClient } from "../betfair-api-client";
import { resolveMarketForRace } from "../betfair-market-resolver";

jest.mock("../betfair-market-resolver");
const mockResolveMarketForRace = resolveMarketForRace as jest.MockedFunction<typeof resolveMarketForRace>;

function fakeDAO(overrides: Partial<jest.Mocked<BetOrderDAO>> = {}): jest.Mocked<BetOrderDAO> {
  return {
    createIndexes: jest.fn(),
    create: jest.fn(),
    listByUser: jest.fn(),
    getByIdForUser: jest.fn(),
    cancelByIdForUser: jest.fn(),
    listAllOpen: jest.fn().mockResolvedValue([]),
    updateFields: jest.fn(),
    tryTransition: jest.fn().mockResolvedValue(true),
    ...overrides,
  } as unknown as jest.Mocked<BetOrderDAO>;
}

function fakeClient(overrides: Partial<jest.Mocked<BetfairApiClient>> = {}): jest.Mocked<BetfairApiClient> {
  return {
    hasCredentials: jest.fn().mockReturnValue(true),
    isDryRun: jest.fn().mockReturnValue(true),
    listMarketCatalogue: jest.fn(),
    listMarketBook: jest.fn(),
    placeOrders: jest.fn(),
    ...overrides,
  } as unknown as jest.Mocked<BetfairApiClient>;
}

const FUTURE_OFF_DT = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour from now
const PAST_OFF_DT = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1 hour ago (well past grace)

function makeOrder(overrides: Partial<BetOrderDocument> = {}): BetOrderDocument {
  return {
    _id: new ObjectId(),
    userId: "user1",
    runnerId: "hrs_1",
    horse: "Artagnan",
    course: "Redcar",
    offTime: "2:05",
    offDt: FUTURE_OFF_DT,
    raceId: "rac_1",
    eventId: "redcar-2026-07-29",
    targetProfit: 20,
    maxStake: 10,
    minQualifyingPrice: 3,
    status: "pending",
    orderType: "scheduled",
    createdAt: "2026-07-29T08:00:00.000Z",
    updatedAt: "2026-07-29T08:00:00.000Z",
    ...overrides,
  };
}

describe("BetOrderService.createForUser", () => {
  it("computes minQualifyingPrice and persists a pending scheduled order", async () => {
    const dao = fakeDAO({ create: jest.fn().mockImplementation(doc => Promise.resolve({ ...doc, _id: new ObjectId() })) });
    const service = new BetOrderService(dao, fakeClient());

    const result = await service.createForUser("user1", {
      runnerId: "hrs_1", horse: "Artagnan", course: "Redcar", offTime: "2:05", offDt: FUTURE_OFF_DT,
      raceId: "rac_1", eventId: "redcar-2026-07-29", targetProfit: 20, maxStake: 10, orderType: "scheduled",
    });

    expect(result.minQualifyingPrice).toBe(3);
    expect(result.status).toBe("pending");
    expect(result.orderType).toBe("scheduled");
    expect(dao.create).toHaveBeenCalledWith(expect.objectContaining({ minQualifyingPrice: 3, status: "pending", orderType: "scheduled" }));
  });

  it("rejects a non-positive targetProfit", async () => {
    const service = new BetOrderService(fakeDAO(), fakeClient());
    await expect(
      service.createForUser("user1", {
        runnerId: "hrs_1", horse: "Artagnan", course: "Redcar", offTime: "2:05", offDt: FUTURE_OFF_DT,
        raceId: "rac_1", eventId: "redcar-2026-07-29", targetProfit: 0, maxStake: 10, orderType: "scheduled",
      })
    ).rejects.toThrow("targetProfit must be a positive number");
  });

  it("rejects a non-positive maxStake", async () => {
    const service = new BetOrderService(fakeDAO(), fakeClient());
    await expect(
      service.createForUser("user1", {
        runnerId: "hrs_1", horse: "Artagnan", course: "Redcar", offTime: "2:05", offDt: FUTURE_OFF_DT,
        raceId: "rac_1", eventId: "redcar-2026-07-29", targetProfit: 20, maxStake: -5, orderType: "scheduled",
      })
    ).rejects.toThrow("maxStake must be a positive number");
  });
});

describe("BetOrderService.createForUser — instant orders", () => {
  beforeEach(() => {
    mockResolveMarketForRace.mockReset();
  });

  const INSTANT_INPUT = {
    runnerId: "hrs_1", horse: "Artagnan", course: "Redcar", offTime: "2:05", offDt: FUTURE_OFF_DT,
    raceId: "rac_1", eventId: "redcar-2026-07-29", targetProfit: 20, maxStake: 10, orderType: "instant" as const,
  }; // minQualifyingPrice = 1 + 20/10 = 3

  it("places (dry-run) immediately when the current price already qualifies", async () => {
    mockResolveMarketForRace.mockResolvedValue({ ok: true, resolved: { marketId: "1.123", marketStartTime: FUTURE_OFF_DT, selectionId: 555 } });
    const client = fakeClient({
      listMarketBook: jest.fn().mockResolvedValue([
        { marketId: "1.123", status: "OPEN", inplay: false, runners: [{ selectionId: 555, status: "ACTIVE", ex: { availableToBack: [{ price: 4, size: 100 }] } }] },
      ]),
      placeOrders: jest.fn().mockResolvedValue({ outcome: "DRY_RUN", simulatedPrice: 4, simulatedSize: 10 }),
    });
    const dao = fakeDAO({ create: jest.fn().mockImplementation(doc => Promise.resolve({ ...doc, _id: new ObjectId() })) });
    const service = new BetOrderService(dao, client);

    const result = await service.createForUser("user1", INSTANT_INPUT);

    expect(client.placeOrders).toHaveBeenCalledWith("1.123", 555, 4, 10);
    expect(result.status).toBe("triggered");
    expect(result.orderType).toBe("instant");
    expect(result.dryRun).toBe(true);
    expect(result.matchedPrice).toBe(4);
    expect(dao.create).toHaveBeenCalledWith(
      expect.objectContaining({ orderType: "instant", status: "triggered", dryRun: true, matchedPrice: 4 })
    );
    // No CAS — nothing else can race a single request's own not-yet-persisted
    // instant placement, unlike evaluateOne's cross-invocation concern.
    expect(dao.tryTransition).not.toHaveBeenCalled();
  });

  it("rejects without placing when the current price doesn't meet the target", async () => {
    mockResolveMarketForRace.mockResolvedValue({ ok: true, resolved: { marketId: "1.123", marketStartTime: FUTURE_OFF_DT, selectionId: 555 } });
    const client = fakeClient({
      listMarketBook: jest.fn().mockResolvedValue([
        { marketId: "1.123", status: "OPEN", inplay: false, runners: [{ selectionId: 555, status: "ACTIVE", ex: { availableToBack: [{ price: 2.5, size: 100 }] } }] },
      ]),
    });
    const dao = fakeDAO();
    const service = new BetOrderService(dao, client);

    await expect(service.createForUser("user1", INSTANT_INPUT)).rejects.toThrow(/INSTANT_BET_REJECTED.*below your minimum qualifying price/);

    expect(client.placeOrders).not.toHaveBeenCalled();
    expect(dao.create).not.toHaveBeenCalled();
  });

  it("rejects without placing when the market can't be safely resolved", async () => {
    mockResolveMarketForRace.mockResolvedValue({ ok: false, failure: { reason: "ambiguous_market", detail: "2 candidate markets matched" } });
    const client = fakeClient();
    const dao = fakeDAO();
    const service = new BetOrderService(dao, client);

    await expect(service.createForUser("user1", INSTANT_INPUT)).rejects.toThrow(/INSTANT_BET_REJECTED.*2 candidate markets matched/);

    expect(client.listMarketBook).not.toHaveBeenCalled();
    expect(client.placeOrders).not.toHaveBeenCalled();
    expect(dao.create).not.toHaveBeenCalled();
  });

  it("persists status 'error' (does not throw) when the real placeOrders call fails", async () => {
    mockResolveMarketForRace.mockResolvedValue({ ok: true, resolved: { marketId: "1.123", marketStartTime: FUTURE_OFF_DT, selectionId: 555 } });
    const client = fakeClient({
      listMarketBook: jest.fn().mockResolvedValue([
        { marketId: "1.123", status: "OPEN", inplay: false, runners: [{ selectionId: 555, status: "ACTIVE", ex: { availableToBack: [{ price: 4, size: 100 }] } }] },
      ]),
      placeOrders: jest.fn().mockResolvedValue({ outcome: "FAILURE", error: "INSUFFICIENT_FUNDS" }),
    });
    const dao = fakeDAO({ create: jest.fn().mockImplementation(doc => Promise.resolve({ ...doc, _id: new ObjectId() })) });
    const service = new BetOrderService(dao, client);

    const result = await service.createForUser("user1", INSTANT_INPUT);

    expect(result.status).toBe("error");
    expect(result.note).toBe("INSUFFICIENT_FUNDS");
    expect(dao.create).toHaveBeenCalledWith(expect.objectContaining({ status: "error", orderType: "instant", note: "INSUFFICIENT_FUNDS" }));
  });
});

describe("BetOrderService.evaluatePendingOrders", () => {
  beforeEach(() => {
    mockResolveMarketForRace.mockReset();
  });

  it("marks an order unmatched (not expired) when resolution fails before the race's off time", async () => {
    const order = makeOrder();
    mockResolveMarketForRace.mockResolvedValue({ ok: false, failure: { reason: "no_market_candidates", detail: "no market" } });
    const dao = fakeDAO({ listAllOpen: jest.fn().mockResolvedValue([order]) });
    const service = new BetOrderService(dao, fakeClient());

    const summary = await service.evaluatePendingOrders();

    expect(summary).toMatchObject({ evaluated: 1, unmatched: 1, expired: 0, triggered: 0 });
    expect(dao.updateFields).toHaveBeenCalledWith(order._id, expect.objectContaining({ status: "unmatched" }));
  });

  it("marks an order expired (not unmatched) when resolution fails after the off time + grace window", async () => {
    const order = makeOrder({ offDt: PAST_OFF_DT });
    mockResolveMarketForRace.mockResolvedValue({ ok: false, failure: { reason: "no_market_candidates", detail: "no market" } });
    const dao = fakeDAO({ listAllOpen: jest.fn().mockResolvedValue([order]) });
    const service = new BetOrderService(dao, fakeClient());

    const summary = await service.evaluatePendingOrders();

    expect(summary).toMatchObject({ evaluated: 1, unmatched: 0, expired: 1 });
    expect(dao.updateFields).toHaveBeenCalledWith(order._id, expect.objectContaining({ status: "expired" }));
  });

  it("does not call placeOrders when the price hasn't met the threshold yet", async () => {
    const order = makeOrder();
    mockResolveMarketForRace.mockResolvedValue({ ok: true, resolved: { marketId: "1.123", marketStartTime: FUTURE_OFF_DT, selectionId: 555 } });
    const client = fakeClient({
      listMarketBook: jest.fn().mockResolvedValue([
        { marketId: "1.123", status: "OPEN", inplay: false, runners: [{ selectionId: 555, status: "ACTIVE", ex: { availableToBack: [{ price: 2.5, size: 100 }] } }] },
      ]),
    });
    const dao = fakeDAO({ listAllOpen: jest.fn().mockResolvedValue([order]) });
    const service = new BetOrderService(dao, client);

    const summary = await service.evaluatePendingOrders();

    expect(client.placeOrders).not.toHaveBeenCalled();
    expect(summary.triggered).toBe(0);
    expect(summary.expired).toBe(0);
  });

  it("triggers a dry-run bet when the price meets the threshold", async () => {
    const order = makeOrder();
    mockResolveMarketForRace.mockResolvedValue({ ok: true, resolved: { marketId: "1.123", marketStartTime: FUTURE_OFF_DT, selectionId: 555 } });
    const client = fakeClient({
      listMarketBook: jest.fn().mockResolvedValue([
        { marketId: "1.123", status: "OPEN", inplay: false, runners: [{ selectionId: 555, status: "ACTIVE", ex: { availableToBack: [{ price: 3.5, size: 100 }] } }] },
      ]),
      placeOrders: jest.fn().mockResolvedValue({ outcome: "DRY_RUN", simulatedPrice: 3.5, simulatedSize: 10 }),
    });
    const dao = fakeDAO({ listAllOpen: jest.fn().mockResolvedValue([order]) });
    const service = new BetOrderService(dao, client);

    const summary = await service.evaluatePendingOrders();

    expect(dao.tryTransition).toHaveBeenCalledWith(order._id, "pending", "placing");
    expect(client.placeOrders).toHaveBeenCalledWith("1.123", 555, 3.5, order.maxStake);
    expect(summary.triggered).toBe(1);
    expect(dao.updateFields).toHaveBeenCalledWith(
      order._id,
      expect.objectContaining({ status: "triggered", dryRun: true, matchedPrice: 3.5 })
    );
  });

  // The core double-bet safeguard: if the compare-and-swap into "placing"
  // loses (another invocation already won it), placeOrders must never be
  // called by this one.
  it("never calls placeOrders when the compare-and-swap into placing is lost", async () => {
    const order = makeOrder();
    mockResolveMarketForRace.mockResolvedValue({ ok: true, resolved: { marketId: "1.123", marketStartTime: FUTURE_OFF_DT, selectionId: 555 } });
    const client = fakeClient({
      listMarketBook: jest.fn().mockResolvedValue([
        { marketId: "1.123", status: "OPEN", inplay: false, runners: [{ selectionId: 555, status: "ACTIVE", ex: { availableToBack: [{ price: 3.5, size: 100 }] } }] },
      ]),
    });
    const dao = fakeDAO({ listAllOpen: jest.fn().mockResolvedValue([order]), tryTransition: jest.fn().mockResolvedValue(false) });
    const service = new BetOrderService(dao, client);

    await service.evaluatePendingOrders();

    expect(client.placeOrders).not.toHaveBeenCalled();
  });

  it("marks an order error (not retried) when placeOrders fails, and does not throw", async () => {
    const order = makeOrder();
    mockResolveMarketForRace.mockResolvedValue({ ok: true, resolved: { marketId: "1.123", marketStartTime: FUTURE_OFF_DT, selectionId: 555 } });
    const client = fakeClient({
      listMarketBook: jest.fn().mockResolvedValue([
        { marketId: "1.123", status: "OPEN", inplay: false, runners: [{ selectionId: 555, status: "ACTIVE", ex: { availableToBack: [{ price: 3.5, size: 100 }] } }] },
      ]),
      placeOrders: jest.fn().mockResolvedValue({ outcome: "FAILURE", error: "INSUFFICIENT_FUNDS" }),
    });
    const dao = fakeDAO({ listAllOpen: jest.fn().mockResolvedValue([order]) });
    const service = new BetOrderService(dao, client);

    const summary = await service.evaluatePendingOrders();

    expect(summary.errors).toBe(1);
    expect(summary.triggered).toBe(0);
    expect(dao.updateFields).toHaveBeenCalledWith(order._id, expect.objectContaining({ status: "error", note: "INSUFFICIENT_FUNDS" }));
  });

  it("marks an order expired once in-play/closed and past the grace window, without calling placeOrders", async () => {
    const order = makeOrder({ offDt: PAST_OFF_DT, betfairMarketId: "1.123", betfairSelectionId: 555 });
    const client = fakeClient({
      listMarketBook: jest.fn().mockResolvedValue([
        { marketId: "1.123", status: "OPEN", inplay: true, runners: [{ selectionId: 555, status: "ACTIVE" }] },
      ]),
    });
    const dao = fakeDAO({ listAllOpen: jest.fn().mockResolvedValue([order]) });
    const service = new BetOrderService(dao, client);

    const summary = await service.evaluatePendingOrders();

    expect(mockResolveMarketForRace).not.toHaveBeenCalled();
    expect(client.placeOrders).not.toHaveBeenCalled();
    expect(summary.expired).toBe(1);
  });

  it("isolates one order's thrown error from the rest of the batch", async () => {
    const badOrder = makeOrder({ _id: new ObjectId() });
    const goodOrder = makeOrder({ _id: new ObjectId(), offDt: PAST_OFF_DT });
    mockResolveMarketForRace
      .mockRejectedValueOnce(new Error("network blew up"))
      .mockResolvedValueOnce({ ok: false, failure: { reason: "no_market_candidates", detail: "no market" } });
    const dao = fakeDAO({ listAllOpen: jest.fn().mockResolvedValue([badOrder, goodOrder]) });
    const service = new BetOrderService(dao, fakeClient());

    const summary = await service.evaluatePendingOrders();

    expect(summary.evaluated).toBe(2);
    expect(summary.errors).toBe(1);
    expect(summary.expired).toBe(1);
    expect(dao.updateFields).toHaveBeenCalledWith(badOrder._id, expect.objectContaining({ status: "error", note: "network blew up" }));
    expect(dao.updateFields).toHaveBeenCalledWith(goodOrder._id, expect.objectContaining({ status: "expired" }));
  });
});
