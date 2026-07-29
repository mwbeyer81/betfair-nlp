import {
  BetfairApiClient,
  BetfairMarketCatalogueEntry,
} from "./betfair-api-client";

// Matches a Daily Races (RacingAPI) race/runner to a live Betfair WIN
// market/selection. This is the one place a wrong match would cause a real
// bet on the wrong horse, so every step here is deliberately conservative:
// an ambiguous or missing match returns null (never a best-guess), and the
// caller (bet-order-service.ts) must treat null as "can't safely proceed",
// not as "try again with a looser rule".

const HORSE_RACING_EVENT_TYPE_ID = "7"; // Betfair's fixed eventTypeId for horse racing.

// Loose enough to survive minor punctuation/whitespace differences between
// RacingAPI and Betfair's own naming (e.g. "King's Stand" vs "Kings Stand",
// trailing country codes like "(IRE)"), strict enough that two genuinely
// different names never collapse to the same key.
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([a-z]{2,4}\)\s*$/i, "") // trailing country code, e.g. "(IRE)"
    .replace(/[^a-z0-9]/g, "");
}

export interface ResolvedMarket {
  marketId: string;
  marketStartTime: string;
  selectionId: number;
}

export interface MarketResolutionFailure {
  reason: "no_market_candidates" | "ambiguous_market" | "no_runner_match" | "ambiguous_runner";
  detail: string;
}

export type MarketResolutionResult =
  | { ok: true; resolved: ResolvedMarket }
  | { ok: false; failure: MarketResolutionFailure };

// +/- this many minutes around the race's own advertised off time — wide
// enough to absorb small clock/schedule drift between RacingAPI and
// Betfair, narrow enough that a same-course race an hour either side can
// never be mistaken for the one being watched.
const START_TIME_WINDOW_MINUTES = 20;

export async function resolveMarketForRace(
  client: BetfairApiClient,
  race: { course: string; offDt: string },
  horseName: string
): Promise<MarketResolutionResult> {
  const offTime = new Date(race.offDt);
  if (Number.isNaN(offTime.getTime())) {
    return { ok: false, failure: { reason: "no_market_candidates", detail: `Invalid offDt: ${race.offDt}` } };
  }
  const from = new Date(offTime.getTime() - START_TIME_WINDOW_MINUTES * 60_000).toISOString();
  const to = new Date(offTime.getTime() + START_TIME_WINDOW_MINUTES * 60_000).toISOString();

  const catalogue = await client.listMarketCatalogue({
    eventTypeIds: [HORSE_RACING_EVENT_TYPE_ID],
    marketCountries: ["GB"],
    marketStartTime: { from, to },
  });

  const targetCourse = normalizeName(race.course);
  const candidates = catalogue.filter(entry => matchesVenue(entry, targetCourse));

  if (candidates.length === 0) {
    return {
      ok: false,
      failure: {
        reason: "no_market_candidates",
        detail: `No Betfair GB horse racing market found for "${race.course}" within ${START_TIME_WINDOW_MINUTES}min of ${race.offDt}`,
      },
    };
  }
  if (candidates.length > 1) {
    return {
      ok: false,
      failure: {
        reason: "ambiguous_market",
        detail: `${candidates.length} candidate markets matched "${race.course}" near ${race.offDt} — refusing to guess`,
      },
    };
  }

  const market = candidates[0];
  const targetHorse = normalizeName(horseName);
  const runnerMatches = market.runners.filter(r => normalizeName(r.runnerName) === targetHorse);

  if (runnerMatches.length === 0) {
    return {
      ok: false,
      failure: { reason: "no_runner_match", detail: `No runner named "${horseName}" found in market ${market.marketId}` },
    };
  }
  if (runnerMatches.length > 1) {
    return {
      ok: false,
      failure: { reason: "ambiguous_runner", detail: `${runnerMatches.length} runners matched "${horseName}" in market ${market.marketId}` },
    };
  }

  return {
    ok: true,
    resolved: {
      marketId: market.marketId,
      marketStartTime: market.marketStartTime,
      selectionId: runnerMatches[0].selectionId,
    },
  };
}

function matchesVenue(entry: BetfairMarketCatalogueEntry, targetCourse: string): boolean {
  const venue = entry.event.venue ? normalizeName(entry.event.venue) : "";
  if (venue) return venue === targetCourse;
  // Some event feeds omit `venue` — fall back to checking whether the
  // course name appears as a whole normalized token inside the event name
  // (e.g. "Redcar 3rd Jun" -> "redcar3rdjun" contains "redcar").
  return normalizeName(entry.event.name).startsWith(targetCourse);
}
