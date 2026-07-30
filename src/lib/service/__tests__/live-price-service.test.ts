import { LivePriceService } from "../live-price-service";
import { BetfairApiClient, BetfairMarketBook } from "../betfair-api-client";
import { resolveMarketsForPicks, MarketResolutionResult } from "../betfair-market-resolver";

jest.mock("../betfair-market-resolver");
const mockResolveMarketsForPicks = resolveMarketsForPicks as jest.MockedFunction<typeof resolveMarketsForPicks>;

function fakeClient(overrides: Partial<jest.Mocked<BetfairApiClient>> = {}): jest.Mocked<BetfairApiClient> {
  return {
    hasCredentials: jest.fn().mockReturnValue(true),
    isDryRun: jest.fn().mockReturnValue(true),
    listEventTypes: jest.fn(),
    listMarketCatalogue: jest.fn(),
    listMarketBook: jest.fn().mockResolvedValue([]),
    placeOrders: jest.fn(),
    ...overrides,
  } as unknown as jest.Mocked<BetfairApiClient>;
}

const PICK_1 = { runnerId: "hrs_1", horse: "Artagnan", course: "Redcar", offDt: "2026-07-29T14:05:00.000Z" };
const PICK_2 = { runnerId: "hrs_2", horse: "Vanilla Skies", course: "Redcar", offDt: "2026-07-29T14:40:00.000Z" };

function okResolution(marketId: string, selectionId: number): MarketResolutionResult {
  return { ok: true, resolved: { marketId, marketStartTime: "2026-07-29T14:05:00.000Z", selectionId } };
}

describe("LivePriceService.getLivePricesForPicks", () => {
  beforeEach(() => {
    mockResolveMarketsForPicks.mockReset();
  });

  it("returns {} immediately for an empty picks array, without calling the client", async () => {
    const client = fakeClient();
    const service = new LivePriceService(client);
    const result = await service.getLivePricesForPicks([]);
    expect(result).toEqual({});
    expect(mockResolveMarketsForPicks).not.toHaveBeenCalled();
  });

  it("degrades to 'not configured' for every pick when credentials are missing, without calling resolveMarketsForPicks", async () => {
    const client = fakeClient({ hasCredentials: jest.fn().mockReturnValue(false) });
    const service = new LivePriceService(client);
    const result = await service.getLivePricesForPicks([PICK_1, PICK_2]);
    expect(result).toEqual({
      hrs_1: { price: null, note: "Live prices aren't configured yet." },
      hrs_2: { price: null, note: "Live prices aren't configured yet." },
    });
    expect(mockResolveMarketsForPicks).not.toHaveBeenCalled();
  });

  it("returns the best available-to-back price for a resolved, active, pre-off runner", async () => {
    mockResolveMarketsForPicks.mockResolvedValue(new Map([["hrs_1", okResolution("1.123", 555)]]));
    const client = fakeClient({
      listMarketBook: jest.fn().mockResolvedValue([
        { marketId: "1.123", status: "OPEN", inplay: false, runners: [{ selectionId: 555, status: "ACTIVE", ex: { availableToBack: [{ price: 3.5, size: 100 }] } }] },
      ] as BetfairMarketBook[]),
    });
    const service = new LivePriceService(client);
    const result = await service.getLivePricesForPicks([PICK_1]);
    expect(result).toEqual({ hrs_1: { price: 3.5 } });
  });

  it("dedupes marketIds across picks resolving to the same market before calling listMarketBook", async () => {
    mockResolveMarketsForPicks.mockResolvedValue(
      new Map([
        ["hrs_1", okResolution("1.123", 555)],
        ["hrs_2", okResolution("1.123", 556)],
      ])
    );
    const listMarketBook = jest.fn().mockResolvedValue([
      {
        marketId: "1.123",
        status: "OPEN",
        inplay: false,
        runners: [
          { selectionId: 555, status: "ACTIVE", ex: { availableToBack: [{ price: 3.5, size: 100 }] } },
          { selectionId: 556, status: "ACTIVE", ex: { availableToBack: [{ price: 5.0, size: 50 }] } },
        ],
      },
    ] as BetfairMarketBook[]);
    const client = fakeClient({ listMarketBook });
    const service = new LivePriceService(client);
    const result = await service.getLivePricesForPicks([PICK_1, PICK_2]);

    expect(listMarketBook).toHaveBeenCalledTimes(1);
    expect(listMarketBook).toHaveBeenCalledWith(["1.123"]);
    expect(result).toEqual({ hrs_1: { price: 3.5 }, hrs_2: { price: 5.0 } });
  });

  it("reports a plain reason (not a price) when the market couldn't be resolved", async () => {
    mockResolveMarketsForPicks.mockResolvedValue(
      new Map([["hrs_1", { ok: false, failure: { reason: "no_market_candidates", detail: "no market found" } }]])
    );
    const client = fakeClient();
    const service = new LivePriceService(client);
    const result = await service.getLivePricesForPicks([PICK_1]);
    expect(result).toEqual({ hrs_1: { price: null, note: "no market found" } });
    expect(client.listMarketBook).not.toHaveBeenCalled();
  });

  it("reports 'in-play' rather than a stale price once the market has gone in-play", async () => {
    mockResolveMarketsForPicks.mockResolvedValue(new Map([["hrs_1", okResolution("1.123", 555)]]));
    const client = fakeClient({
      listMarketBook: jest.fn().mockResolvedValue([
        { marketId: "1.123", status: "OPEN", inplay: true, runners: [{ selectionId: 555, status: "ACTIVE" }] },
      ] as BetfairMarketBook[]),
    });
    const service = new LivePriceService(client);
    const result = await service.getLivePricesForPicks([PICK_1]);
    expect(result.hrs_1.price).toBeNull();
    expect(result.hrs_1.note).toContain("in-play");
  });

  it("reports 'no longer active' when the runner itself has been withdrawn/removed", async () => {
    mockResolveMarketsForPicks.mockResolvedValue(new Map([["hrs_1", okResolution("1.123", 555)]]));
    const client = fakeClient({
      listMarketBook: jest.fn().mockResolvedValue([
        { marketId: "1.123", status: "OPEN", inplay: false, runners: [{ selectionId: 555, status: "REMOVED" }] },
      ] as BetfairMarketBook[]),
    });
    const service = new LivePriceService(client);
    const result = await service.getLivePricesForPicks([PICK_1]);
    expect(result.hrs_1.price).toBeNull();
    expect(result.hrs_1.note).toContain("no longer active");
  });

  it("reports 'no live back price' when the runner has no availableToBack quotes", async () => {
    mockResolveMarketsForPicks.mockResolvedValue(new Map([["hrs_1", okResolution("1.123", 555)]]));
    const client = fakeClient({
      listMarketBook: jest.fn().mockResolvedValue([
        { marketId: "1.123", status: "OPEN", inplay: false, runners: [{ selectionId: 555, status: "ACTIVE", ex: { availableToBack: [] } }] },
      ] as BetfairMarketBook[]),
    });
    const service = new LivePriceService(client);
    const result = await service.getLivePricesForPicks([PICK_1]);
    expect(result.hrs_1.price).toBeNull();
    expect(result.hrs_1.note).toContain("No live back price");
  });

  it("reports 'market no longer available' when listMarketBook doesn't return the resolved market at all", async () => {
    mockResolveMarketsForPicks.mockResolvedValue(new Map([["hrs_1", okResolution("1.123", 555)]]));
    const client = fakeClient({ listMarketBook: jest.fn().mockResolvedValue([]) });
    const service = new LivePriceService(client);
    const result = await service.getLivePricesForPicks([PICK_1]);
    expect(result.hrs_1.price).toBeNull();
    expect(result.hrs_1.note).toContain("no longer available");
  });

  it("catches a thrown resolveMarketsForPicks and reports a note for every pick, without throwing", async () => {
    mockResolveMarketsForPicks.mockRejectedValue(new Error("Betfair API error (listMarketCatalogue): TOO_MUCH_DATA"));
    const client = fakeClient();
    const service = new LivePriceService(client);
    const result = await service.getLivePricesForPicks([PICK_1, PICK_2]);
    expect(result.hrs_1.price).toBeNull();
    expect(result.hrs_1.note).toContain("TOO_MUCH_DATA");
    expect(result.hrs_2.price).toBeNull();
    expect(client.listMarketBook).not.toHaveBeenCalled();
  });

  it("catches a thrown listMarketBook and reports a note for every pick, without throwing", async () => {
    mockResolveMarketsForPicks.mockResolvedValue(new Map([["hrs_1", okResolution("1.123", 555)]]));
    const client = fakeClient({ listMarketBook: jest.fn().mockRejectedValue(new Error("network error")) });
    const service = new LivePriceService(client);
    const result = await service.getLivePricesForPicks([PICK_1]);
    expect(result.hrs_1.price).toBeNull();
    expect(result.hrs_1.note).toContain("network error");
  });
});
