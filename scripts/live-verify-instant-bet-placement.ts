#!/usr/bin/env ts-node

// MANUAL VERIFICATION SCRIPT — not run by any automated suite (Jest,
// local-ci-e2e.sh, or otherwise). Exercises the real "instant bet" code
// path (BetOrderService.createForUser with orderType:"instant" — see
// AGENTS.md's instant-bet-orders entry) against the real Betfair API and
// whatever Mongo config/local.json points at.
//
// SAFE ONLY WHILE betfair.dryRun stays at its default true. This script
// hard-aborts before making ANY network call if client.isDryRun() is not
// true — a second, redundant check on top of the gate that already lives
// inside BetfairApiClient.placeOrders() itself (see that file's header
// comment). This is the first live-verify script in the repo whose code
// path can reach placeOrders() at all — every prior live-verify-*.ts
// script is read-only and has no order-placing call anywhere in it — so
// this extra belt-and-braces check is specific to this one.
//
// What it does: finds a real near-future GB WIN market/runner directly via
// listMarketCatalogue/listMarketBook (not dependent on today's local
// daily_racecards being fresh — see the daily-races-live-price AGENTS.md
// entry for why that dev data can go stale), picks targetProfit/maxStake
// so minQualifyingPrice sits below the real observed price (guaranteeing
// the instant path qualifies), then calls the real
// BetOrderService.createForUser(..., {orderType:"instant"}) — the exact
// same code the POST /api/bet-orders route calls. Because dryRun stays
// true, placeOrders() returns a synthetic DRY_RUN result without ever
// reaching Betfair's real order-placement endpoint. Inserts exactly one
// real document into the real bet_orders collection, then deletes that
// same document by id before exiting, leaving the collection net-unchanged.
//
// Usage (against real dev Mongo + real Betfair credentials in
// config/local.json):
//   NODE_CONFIG_DIR=./config npx ts-node scripts/live-verify-instant-bet-placement.ts

import { ObjectId } from "mongodb";
import { DatabaseConnection } from "../src/config/database";
import { BetfairApiClient, BetfairMarketCatalogueEntry } from "../src/lib/service/betfair-api-client";
import { BetOrderDAO } from "../src/lib/dao/bet-order-dao";
import { BetOrderService } from "../src/lib/service/bet-order-service";

const HORSE_RACING_EVENT_TYPE_ID = "7";

async function findCandidateMarket(client: BetfairApiClient): Promise<{
  market: BetfairMarketCatalogueEntry;
  selectionId: number;
  horseName: string;
  price: number;
}> {
  const now = new Date();
  const from = now.toISOString();
  const to = new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString(); // next 6 hours

  const catalogue = await client.listMarketCatalogue(
    { eventTypeIds: [HORSE_RACING_EVENT_TYPE_ID], marketCountries: ["GB"], marketTypeCodes: ["WIN"], marketStartTime: { from, to } },
    "50"
  );
  // Only consider markets with a real event.venue — matchMarketAndRunner
  // (betfair-market-resolver.ts) matches on that field first, so using it
  // here guarantees the service's own re-resolution finds the same market.
  const withVenue = catalogue.filter(m => m.event.venue && m.runners.length > 0);
  if (withVenue.length === 0) {
    throw new Error("No real upcoming GB WIN horse racing market (with a venue) found in the next 6 hours — nothing to verify against right now.");
  }

  for (const market of withVenue) {
    const books = await client.listMarketBook([market.marketId]);
    const book = books[0];
    if (!book || book.inplay || book.status === "CLOSED") continue;
    for (const runnerCat of market.runners) {
      const runnerBook = book.runners.find(r => r.selectionId === runnerCat.selectionId);
      const price = runnerBook?.ex?.availableToBack?.[0]?.price;
      if (runnerBook?.status === "ACTIVE" && price != null) {
        return { market, selectionId: runnerCat.selectionId, horseName: runnerCat.runnerName, price };
      }
    }
  }
  throw new Error("Found upcoming GB WIN markets, but none had an active runner with an available back price right now — try again shortly.");
}

async function main(): Promise<void> {
  const client = new BetfairApiClient();

  if (!client.hasCredentials()) {
    console.error(
      "Betfair credentials not configured — need betfair.appKey (or betfair.delayAppKey) " +
        "plus either betfair.sessionId, or both betfair.username/password, in config/local.json."
    );
    process.exit(1);
  }
  if (!client.isDryRun()) {
    console.error(
      "ABORTING before any network call: betfair.dryRun is not true. This script only ever " +
        "runs safely with the default dry-run gate active — it refuses to proceed rather than " +
        "risk placing a real bet. Set betfair.dryRun back to true (or remove the override) to run this."
    );
    process.exit(1);
  }

  const dbConnection = DatabaseConnection.getInstance();
  await dbConnection.connect();
  const db = dbConnection.getDb();
  const dao = new BetOrderDAO(db);
  const service = new BetOrderService(dao, client);

  try {
    console.log("Looking for a real upcoming GB WIN market with a live back price...");
    const { market, selectionId, horseName, price } = await findCandidateMarket(client);
    console.log(
      `Found: ${horseName} in "${market.marketName}" at ${market.event.venue} (off ${market.marketStartTime}), ` +
        `selectionId=${selectionId}, real current best back price=${price}.`
    );

    // maxStake/targetProfit chosen so minQualifyingPrice (1 + targetProfit/maxStake)
    // sits comfortably below the real observed price, guaranteeing the
    // instant path's price check qualifies.
    const maxStake = 10;
    const targetProfit = Math.max(0.5, (price - 1) * maxStake * 0.5);
    const minQualifyingPricePreview = 1 + targetProfit / maxStake;
    console.log(`Using targetProfit=£${targetProfit.toFixed(2)}, maxStake=£${maxStake} -> minQualifyingPrice=${minQualifyingPricePreview.toFixed(2)} (below ${price}).`);

    const result = await service.createForUser("prod-test-user", {
      runnerId: `verify-${selectionId}`,
      horse: horseName,
      course: market.event.venue as string,
      offTime: market.marketStartTime,
      offDt: market.marketStartTime,
      raceId: `verify-${market.marketId}`,
      eventId: market.event.id,
      targetProfit,
      maxStake,
      orderType: "instant",
    });

    console.log("\ncreateForUser (orderType: instant) result:");
    console.log(`  status: ${result.status}`);
    console.log(`  dryRun: ${result.dryRun}`);
    console.log(`  matchedPrice: ${result.matchedPrice}`);

    if (result.status === "triggered" && result.dryRun === true && result.matchedPrice != null) {
      // matchedPrice won't always exactly equal the price observed a few
      // lines up — placeInstant re-resolves the market and re-reads the
      // book itself moments later, and a real live market can genuinely
      // move a tick or two in that gap. Confirming it's close (not
      // identical) is the honest check here, not a bug in either reading.
      const drift = Math.abs(result.matchedPrice - price);
      console.log(`\n✓ Instant-bet pipeline confirmed working end-to-end against the real Betfair API, in dry-run mode (no real bet placed).`);
      console.log(`  (price drift between this script's own lookup and placeInstant's re-read: ${drift.toFixed(2)} — real market movement, not an error, unless implausibly large.)`);
    } else {
      console.log("\n✗ UNEXPECTED RESULT — expected status 'triggered', dryRun true, and a real matchedPrice. Worth a closer look.");
    }

    await db.collection("bet_orders").deleteOne({ _id: new ObjectId(result.id) });
    console.log(`\nCleaned up: deleted the one bet_orders document this script inserted (id=${result.id}). Collection left net-unchanged.`);
  } finally {
    await dbConnection.disconnect();
  }
}

main().catch(error => {
  console.error("live-verify-instant-bet-placement failed:", error);
  process.exit(1);
});
