import { resolveMarketForRace, resolveMarketsForPicks } from "../betfair-market-resolver";
import { BetfairApiClient, BetfairMarketCatalogueEntry } from "../betfair-api-client";

function fakeClient(catalogue: BetfairMarketCatalogueEntry[]): jest.Mocked<BetfairApiClient> {
  return {
    hasCredentials: jest.fn().mockReturnValue(true),
    isDryRun: jest.fn().mockReturnValue(true),
    listEventTypes: jest.fn(),
    listMarketCatalogue: jest.fn().mockResolvedValue(catalogue),
    listMarketBook: jest.fn(),
    placeOrders: jest.fn(),
  } as unknown as jest.Mocked<BetfairApiClient>;
}

function entry(overrides: Partial<BetfairMarketCatalogueEntry> = {}): BetfairMarketCatalogueEntry {
  return {
    marketId: "1.100",
    marketName: "2m Hcap Chs",
    marketStartTime: "2026-07-29T14:05:00.000Z",
    event: { id: "e1", name: "Redcar 29th Jul", venue: "Redcar" },
    runners: [{ selectionId: 555, runnerName: "Artagnan" }],
    ...overrides,
  };
}

describe("resolveMarketForRace", () => {
  const RACE = { course: "Redcar", offDt: "2026-07-29T14:05:00.000Z" };

  it("resolves cleanly when exactly one venue/time candidate has exactly one matching runner", async () => {
    const client = fakeClient([entry()]);
    const result = await resolveMarketForRace(client, RACE, "Artagnan");
    expect(result).toEqual({ ok: true, resolved: { marketId: "1.100", marketStartTime: "2026-07-29T14:05:00.000Z", selectionId: 555 } });
  });

  it("matches a runner name despite a trailing country code and punctuation differences", async () => {
    const client = fakeClient([entry({ runners: [{ selectionId: 555, runnerName: "Artagnan (IRE)" }] })]);
    const result = await resolveMarketForRace(client, RACE, "Artagnan");
    expect(result.ok).toBe(true);
  });

  it("returns no_market_candidates when no venue matches", async () => {
    const client = fakeClient([entry({ event: { id: "e2", name: "Ascot 29th Jul", venue: "Ascot" } })]);
    const result = await resolveMarketForRace(client, RACE, "Artagnan");
    expect(result).toEqual({ ok: false, failure: expect.objectContaining({ reason: "no_market_candidates" }) });
  });

  it("returns ambiguous_market rather than guessing when two candidates match the same venue/time window", async () => {
    const client = fakeClient([entry({ marketId: "1.100" }), entry({ marketId: "1.200" })]);
    const result = await resolveMarketForRace(client, RACE, "Artagnan");
    expect(result).toEqual({ ok: false, failure: expect.objectContaining({ reason: "ambiguous_market" }) });
  });

  it("returns no_runner_match when the named horse isn't in the resolved market", async () => {
    const client = fakeClient([entry({ runners: [{ selectionId: 999, runnerName: "Someone Else" }] })]);
    const result = await resolveMarketForRace(client, RACE, "Artagnan");
    expect(result).toEqual({ ok: false, failure: expect.objectContaining({ reason: "no_runner_match" }) });
  });

  it("returns ambiguous_runner rather than guessing when two runners share a normalized name", async () => {
    const client = fakeClient([
      entry({
        runners: [
          { selectionId: 555, runnerName: "Artagnan" },
          { selectionId: 556, runnerName: "Artagnan" },
        ],
      }),
    ]);
    const result = await resolveMarketForRace(client, RACE, "Artagnan");
    expect(result).toEqual({ ok: false, failure: expect.objectContaining({ reason: "ambiguous_runner" }) });
  });
});

describe("resolveMarketsForPicks", () => {
  it("returns an empty map for an empty picks array, without calling the client", async () => {
    const client = fakeClient([]);
    const result = await resolveMarketsForPicks(client, []);
    expect(result.size).toBe(0);
    expect(client.listMarketCatalogue).not.toHaveBeenCalled();
  });

  it("resolves multiple picks from a single shared listMarketCatalogue call", async () => {
    const client = fakeClient([
      entry({ marketId: "1.100", event: { id: "e1", name: "Redcar", venue: "Redcar" }, marketStartTime: "2026-07-29T14:05:00.000Z", runners: [{ selectionId: 555, runnerName: "Artagnan" }] }),
      entry({ marketId: "1.200", event: { id: "e2", name: "Ascot", venue: "Ascot" }, marketStartTime: "2026-07-29T15:05:00.000Z", runners: [{ selectionId: 777, runnerName: "Vanilla Skies" }] }),
    ]);

    const result = await resolveMarketsForPicks(client, [
      { runnerId: "hrs_1", horse: "Artagnan", course: "Redcar", offDt: "2026-07-29T14:05:00.000Z" },
      { runnerId: "hrs_2", horse: "Vanilla Skies", course: "Ascot", offDt: "2026-07-29T15:05:00.000Z" },
    ]);

    expect(client.listMarketCatalogue).toHaveBeenCalledTimes(1);
    expect(result.get("hrs_1")).toEqual({ ok: true, resolved: expect.objectContaining({ marketId: "1.100", selectionId: 555 }) });
    expect(result.get("hrs_2")).toEqual({ ok: true, resolved: expect.objectContaining({ marketId: "1.200", selectionId: 777 }) });
  });

  // The real reason this needs its own time-window re-check per pick (not
  // just venue matching): a wide, whole-day catalogue query can return two
  // markets at the SAME course but different times, which single-race
  // resolution never has to disambiguate (its own query is already time-
  // narrowed server-side).
  it("disambiguates two races at the same venue but different times", async () => {
    const client = fakeClient([
      entry({ marketId: "1.100", event: { id: "e1", name: "Redcar", venue: "Redcar" }, marketStartTime: "2026-07-29T14:05:00.000Z", runners: [{ selectionId: 555, runnerName: "Artagnan" }] }),
      entry({ marketId: "1.101", event: { id: "e1", name: "Redcar", venue: "Redcar" }, marketStartTime: "2026-07-29T16:50:00.000Z", runners: [{ selectionId: 999, runnerName: "Thats My Boy Luke" }] }),
    ]);

    const result = await resolveMarketsForPicks(client, [
      { runnerId: "hrs_1", horse: "Artagnan", course: "Redcar", offDt: "2026-07-29T14:05:00.000Z" },
      { runnerId: "hrs_4", horse: "Thats My Boy Luke", course: "Redcar", offDt: "2026-07-29T16:50:00.000Z" },
    ]);

    expect(result.get("hrs_1")).toEqual({ ok: true, resolved: expect.objectContaining({ marketId: "1.100" }) });
    expect(result.get("hrs_4")).toEqual({ ok: true, resolved: expect.objectContaining({ marketId: "1.101" }) });
  });

  it("returns a failure entry (not a thrown error) for a pick with an invalid offDt, alongside successful picks", async () => {
    const client = fakeClient([entry()]);
    const result = await resolveMarketsForPicks(client, [
      { runnerId: "hrs_1", horse: "Artagnan", course: "Redcar", offDt: "not-a-date" },
    ]);
    expect(result.get("hrs_1")).toEqual({ ok: false, failure: expect.objectContaining({ reason: "no_market_candidates" }) });
  });
});
