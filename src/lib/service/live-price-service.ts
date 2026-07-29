import { BetfairApiClient, BetfairMarketBook } from "./betfair-api-client";
import { resolveMarketsForPicks, PickToResolve, ResolvedMarket, MarketResolutionResult } from "./betfair-market-resolver";

export interface LivePriceResult {
  // Best currently-available-to-back decimal price, or null whenever a
  // real live price genuinely can't be shown right now — never a
  // fabricated/estimated number. `note` explains why in that case (no
  // credentials configured, couldn't identify the market, race in-play,
  // etc.) so the UI can show something more useful than a bare dash.
  price: number | null;
  note?: string;
}

// Read-only display lookup — distinct from bet-order-service.ts's
// evaluatePendingOrders (which watches persisted PENDING orders on a
// schedule and can place real orders). This only ever reads
// listMarketCatalogue/listMarketBook for whatever picks the caller is
// currently showing on screen; it never calls placeOrders and has no
// persistence of its own.
export class LivePriceService {
  private client: BetfairApiClient;

  constructor(client?: BetfairApiClient) {
    this.client = client ?? new BetfairApiClient();
  }

  public async getLivePricesForPicks(picks: PickToResolve[]): Promise<Record<string, LivePriceResult>> {
    const result: Record<string, LivePriceResult> = {};
    if (picks.length === 0) return result;

    // Fails safe into "no live price" rather than an error — the same
    // "not configured yet" state the mocked/dry-run phases of this feature
    // have always shown, not a broken page.
    if (!this.client.hasCredentials()) {
      for (const pick of picks) {
        result[pick.runnerId] = { price: null, note: "Live prices aren't configured yet." };
      }
      return result;
    }

    let resolutions: Map<string, MarketResolutionResult>;
    try {
      resolutions = await resolveMarketsForPicks(this.client, picks);
    } catch (error) {
      const note = `Betfair lookup failed: ${error instanceof Error ? error.message : String(error)}`;
      for (const pick of picks) result[pick.runnerId] = { price: null, note };
      return result;
    }

    const resolvedMarketIds = new Set<string>();
    for (const resolution of resolutions.values()) {
      if (resolution.ok) resolvedMarketIds.add(resolution.resolved.marketId);
    }

    let books: BetfairMarketBook[] = [];
    if (resolvedMarketIds.size > 0) {
      try {
        books = await this.client.listMarketBook(Array.from(resolvedMarketIds));
      } catch (error) {
        const note = `Betfair price lookup failed: ${error instanceof Error ? error.message : String(error)}`;
        for (const pick of picks) result[pick.runnerId] = { price: null, note };
        return result;
      }
    }
    const bookByMarketId = new Map(books.map(b => [b.marketId, b]));

    for (const pick of picks) {
      const resolution = resolutions.get(pick.runnerId);
      if (!resolution || !resolution.ok) {
        result[pick.runnerId] = {
          price: null,
          note: resolution && !resolution.ok ? resolution.failure.detail : "Could not identify a live Betfair market.",
        };
        continue;
      }
      result[pick.runnerId] = this.priceFromBook(bookByMarketId.get(resolution.resolved.marketId), resolution.resolved);
    }
    return result;
  }

  private priceFromBook(book: BetfairMarketBook | undefined, resolved: ResolvedMarket): LivePriceResult {
    if (!book) return { price: null, note: "Market no longer available." };
    const runner = book.runners.find(r => r.selectionId === resolved.selectionId);
    if (book.inplay) return { price: null, note: "Race is in-play — no more pre-off back price." };
    if (!runner || runner.status !== "ACTIVE") return { price: null, note: "Runner is no longer active in this market." };
    const bestBackPrice = runner.ex?.availableToBack?.[0]?.price;
    if (bestBackPrice == null) return { price: null, note: "No live back price currently available." };
    return { price: bestBackPrice };
  }
}
