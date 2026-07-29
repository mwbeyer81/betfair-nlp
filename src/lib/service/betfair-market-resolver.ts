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
    marketTypeCodes: ["WIN"],
    marketStartTime: { from, to },
  });

  return matchMarketAndRunner(catalogue, race, horseName);
}

export interface PickToResolve {
  runnerId: string;
  horse: string;
  course: string;
  offDt: string;
}

// Highest maxResults this session confirmed live against the real API —
// see AGENTS.md's daily-races-live-price entry. A single UK racing day's
// GB WIN markets comfortably fits well under this.
const BATCH_MAX_RESULTS = "200";

// Batch counterpart to resolveMarketForRace — ONE listMarketCatalogue call
// covering every pick's race, instead of one call per pick, then the exact
// same conservative per-pick venue+time-window+runner-name matching
// applied against that single shared catalogue. Exists so showing a live
// price next to every Today's Picks row doesn't turn one page load into N
// separate Betfair API calls. Returns a result for every pick passed in
// (never a partial map), keyed by runnerId.
export async function resolveMarketsForPicks(
  client: BetfairApiClient,
  picks: PickToResolve[]
): Promise<Map<string, MarketResolutionResult>> {
  const results = new Map<string, MarketResolutionResult>();
  if (picks.length === 0) return results;

  const validTimes = picks.map(p => new Date(p.offDt).getTime()).filter(t => !Number.isNaN(t));
  if (validTimes.length === 0) {
    for (const pick of picks) {
      results.set(pick.runnerId, { ok: false, failure: { reason: "no_market_candidates", detail: `Invalid offDt: ${pick.offDt}` } });
    }
    return results;
  }

  const from = new Date(Math.min(...validTimes) - START_TIME_WINDOW_MINUTES * 60_000).toISOString();
  const to = new Date(Math.max(...validTimes) + START_TIME_WINDOW_MINUTES * 60_000).toISOString();
  const catalogue = await client.listMarketCatalogue(
    { eventTypeIds: [HORSE_RACING_EVENT_TYPE_ID], marketCountries: ["GB"], marketTypeCodes: ["WIN"], marketStartTime: { from, to } },
    BATCH_MAX_RESULTS
  );

  for (const pick of picks) {
    if (Number.isNaN(new Date(pick.offDt).getTime())) {
      results.set(pick.runnerId, { ok: false, failure: { reason: "no_market_candidates", detail: `Invalid offDt: ${pick.offDt}` } });
      continue;
    }
    results.set(pick.runnerId, matchMarketAndRunner(catalogue, pick, pick.horse));
  }
  return results;
}

// Shared by both single (resolveMarketForRace, whose own query already
// narrows by this race's time window server-side) and batch
// (resolveMarketsForPicks, whose query spans a whole day so every
// candidate must be re-narrowed to THIS race's own window here) — the
// time-window check below is a no-op for the single-race path (every
// candidate it receives is already inside that window) and the real
// disambiguator for the batch path (two races at the same course on
// different days' — or the same day's different times — races otherwise
// look identical by venue alone, e.g. "Redcar 2:05" vs "Redcar 4:50").
function matchMarketAndRunner(
  catalogue: BetfairMarketCatalogueEntry[],
  race: { course: string; offDt: string },
  horseName: string
): MarketResolutionResult {
  const offTime = new Date(race.offDt).getTime();
  const targetCourse = normalizeName(race.course);
  const candidates = catalogue.filter(entry => {
    if (!matchesVenue(entry, targetCourse)) return false;
    const entryTime = new Date(entry.marketStartTime).getTime();
    return !Number.isNaN(entryTime) && Math.abs(entryTime - offTime) <= START_TIME_WINDOW_MINUTES * 60_000;
  });

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
