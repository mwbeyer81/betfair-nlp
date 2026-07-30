import config from "config";
import { BetfairApiClient } from "../betfair-api-client";

// Real bug this file exists to catch: the `config` npm package does NOT
// auto-cast env-var-sourced values (via custom-environment-variables.json)
// to match the type already at that path in default.json — a
// custom-environment-variables.json substitution always produces a raw
// string. `readConfigBoolean` in betfair-api-client.ts must handle both a
// real boolean (a literal JSON value, no substitution involved) and the
// "true"/"false" strings a substituted env var always produces. See
// AGENTS.md's config-boolean-fix entry for how this was actually found —
// BETFAIR_DRY_RUN=false silently had no effect in production because of
// exactly this gap.
jest.mock("config");
const mockGet = config.get as jest.Mock;

describe("BetfairApiClient — config boolean coercion", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockGet.mockImplementation(() => {
      throw new Error("not configured");
    });
  });

  it("treats a real boolean false (a literal default.json value, no env override) as false", () => {
    mockGet.mockImplementation((key: string) => (key === "betfair.dryRun" ? false : ""));
    expect(new BetfairApiClient().isDryRun()).toBe(false);
  });

  it('treats the STRING "false" (what an env-var override actually produces) as false, not as truthy/fallback', () => {
    mockGet.mockImplementation((key: string) => (key === "betfair.dryRun" ? "false" : ""));
    expect(new BetfairApiClient().isDryRun()).toBe(false);
  });

  it('treats the STRING "true" as true', () => {
    mockGet.mockImplementation((key: string) => (key === "betfair.dryRun" ? "true" : ""));
    expect(new BetfairApiClient().isDryRun()).toBe(true);
  });

  it("falls back to true (the safe default) when the key is missing entirely", () => {
    mockGet.mockImplementation(() => {
      throw new Error("key not found");
    });
    expect(new BetfairApiClient().isDryRun()).toBe(true);
  });

  it("falls back to true (the safe default) for an unrecognized value shape, never silently going live", () => {
    mockGet.mockImplementation((key: string) => (key === "betfair.dryRun" ? 0 : ""));
    expect(new BetfairApiClient().isDryRun()).toBe(true);
  });

  it("getLiveBettingAllowedEmail lowercases whatever string config returns, and defaults to empty (nobody allowed) when unset", () => {
    mockGet.mockImplementation((key: string) => (key === "betfair.liveBettingAllowedEmail" ? "MatthewBeyer@Hotmail.com" : ""));
    expect(new BetfairApiClient().getLiveBettingAllowedEmail()).toBe("matthewbeyer@hotmail.com");

    mockGet.mockImplementation(() => {
      throw new Error("not configured");
    });
    expect(new BetfairApiClient().getLiveBettingAllowedEmail()).toBe("");
  });
});

describe("BetfairApiClient.placeOrders — real Betfair error code priority", () => {
  const fetchSpy = jest.spyOn(global, "fetch");

  beforeEach(() => {
    fetchSpy.mockReset();
    mockGet.mockReset();
    // dryRun: false, forceDryRun: false, and a fixed sessionId so
    // ensureSession() never tries a real login() network call — isolates
    // these tests to exactly placeOrders' own response-parsing logic.
    mockGet.mockImplementation((key: string) => {
      if (key === "betfair.dryRun") return false;
      if (key === "betfair.sessionId") return "fake-session-id";
      if (key === "betfair.appKey") return "fake-app-key";
      return "";
    });
  });

  afterAll(() => fetchSpy.mockRestore());

  // Real bug this locks in: Betfair's PlaceExecutionReport has its own
  // top-level errorCode (ExecutionReportErrorCode), separate from each
  // instructionReports[].errorCode (InstructionReportErrorCode). Betfair's
  // own developer forum documents ERROR_IN_ORDER at the instruction level
  // as a cascading placeholder ("the action failed because the parent
  // order failed") that commonly co-occurs with a more specific top-level
  // code — the top-level one must win. See AGENTS.md's
  // betfair-error-code-fix entry for how this was found (a prior fix
  // guessed ERROR_IN_ORDER meant an app-key permission issue; that guess
  // was wrong, and this is the actual fix).
  it("surfaces the top-level errorCode ahead of the per-instruction ERROR_IN_ORDER placeholder", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "FAILURE",
        errorCode: "INSUFFICIENT_FUNDS",
        instructionReports: [{ status: "FAILURE", errorCode: "ERROR_IN_ORDER" }],
      }),
    } as Response);

    const result = await new BetfairApiClient().placeOrders("1.123", 555, 3.5, 1);

    expect(result).toEqual({ outcome: "FAILURE", error: "INSUFFICIENT_FUNDS" });
  });

  it("falls back to the per-instruction errorCode when no top-level errorCode is present", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "FAILURE",
        instructionReports: [{ status: "FAILURE", errorCode: "MARKET_SUSPENDED" }],
      }),
    } as Response);

    const result = await new BetfairApiClient().placeOrders("1.123", 555, 3.5, 1);

    expect(result).toEqual({ outcome: "FAILURE", error: "MARKET_SUSPENDED" });
  });

  it("still reports SUCCESS correctly (top-level errorCode field simply absent on a real success)", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "SUCCESS",
        instructionReports: [{ status: "SUCCESS", betId: "12345", averagePriceMatched: 3.6 }],
      }),
    } as Response);

    const result = await new BetfairApiClient().placeOrders("1.123", 555, 3.5, 1);

    expect(result).toEqual({ outcome: "SUCCESS", betId: "12345", matchedPrice: 3.6 });
  });
});

// REAL BUG FOUND AND FIXED 2026-07-30 (see AGENTS.md's matched-price-zero
// entry). Confirmed against the live account: bet 436598726286 (Silken Bay,
// 20:40 Leicester) was placed at 19:30:35 and only matched at 19:33:05 —
// nearly three minutes after placeOrders had already returned SUCCESS. The
// response therefore carried `averagePriceMatched: 0` ("nothing matched
// yet"), and because `?? price` only substitutes on null/undefined, a
// literal 0 was persisted as the bet's matched price while Betfair's own
// listClearedOrders reported priceMatched 8.4.
describe("BetfairApiClient.placeOrders — averagePriceMatched: 0 means 'not matched yet', not a price of zero", () => {
  // Re-acquired per test rather than once at describe scope: the block
  // above restores the real global.fetch in its own afterAll, which would
  // otherwise leave a describe-scoped spy here inert — and an un-stubbed
  // fetch means these tests quietly hit the real Betfair API.
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, "fetch");
    fetchSpy.mockReset();
    mockGet.mockReset();
    mockGet.mockImplementation((key: string) => {
      if (key === "betfair.dryRun") return false;
      if (key === "betfair.sessionId") return "fake-session-id";
      if (key === "betfair.appKey") return "fake-app-key";
      return "";
    });
  });

  afterAll(() => jest.restoreAllMocks());

  async function placeWithReport(report: Record<string, unknown>) {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ status: "SUCCESS", instructionReports: [report] }),
    } as Response);
    return await new BetfairApiClient().placeOrders("1.123", 555, 8.4, 2);
  }

  it("falls back to the requested price when the order hasn't filled yet (averagePriceMatched: 0)", async () => {
    const result = await placeWithReport({ status: "SUCCESS", betId: "436598726286", averagePriceMatched: 0 });

    expect(result).toEqual({ outcome: "SUCCESS", betId: "436598726286", matchedPrice: 8.4 });
  });

  it("falls back to the requested price when averagePriceMatched is absent entirely", async () => {
    const result = await placeWithReport({ status: "SUCCESS", betId: "12345" });

    expect(result).toEqual({ outcome: "SUCCESS", betId: "12345", matchedPrice: 8.4 });
  });

  it("never returns a non-positive matchedPrice, which downstream PnL maths would turn into a phantom loss", async () => {
    for (const averagePriceMatched of [0, -1, null, undefined]) {
      const result = await placeWithReport({ status: "SUCCESS", betId: "12345", averagePriceMatched });

      expect(result.outcome).toBe("SUCCESS");
      expect(result.outcome === "SUCCESS" && result.matchedPrice).toBeGreaterThan(0);
    }
  });

  it("still uses a real reported fill price when the order did match immediately", async () => {
    const result = await placeWithReport({ status: "SUCCESS", betId: "12345", averagePriceMatched: 9.2 });

    expect(result).toEqual({ outcome: "SUCCESS", betId: "12345", matchedPrice: 9.2 });
  });
});
