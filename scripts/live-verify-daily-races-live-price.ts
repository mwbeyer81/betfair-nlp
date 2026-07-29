#!/usr/bin/env ts-node

// MANUAL VERIFICATION SCRIPT — not run by any automated suite (Jest,
// local-ci-e2e.sh, or otherwise). e2e check for the "live Betfair price
// next to the Bet pill" feature (see DailyRacesScreen.tsx / live-price-
// service.ts / the /api/daily-races/live-prices route).
//
// READ-ONLY: only ever calls listMarketCatalogue/listMarketBook via
// LivePriceService, never placeOrders — running this can never place a
// bet, regardless of the betfair.dryRun config value.
//
// Pulls a real sample of today's real GB Daily Races runners straight out
// of Mongo (whatever's actually loaded — no synthetic/fixture data) and
// resolves each to a live Betfair market + price, proving the whole
// pipeline (real Mongo racecards -> market resolution -> live price) works
// end-to-end against the real Betfair API, not a mock of any layer.
//
// Usage (against real dev Mongo + real Betfair credentials in
// config/local.json):
//   NODE_CONFIG_DIR=./config npx ts-node scripts/live-verify-daily-races-live-price.ts
//
// Usage (against a different Mongo, e.g. the shared dev instance from a
// fresh worktree with no config/local.json of its own):
//   NODE_CONFIG_DIR=/path/to/checkout/config MONGODB_URI=mongodb://localhost:27019 \
//     MONGODB_DB_NAME=betfair_nlp_dev npx ts-node scripts/live-verify-daily-races-live-price.ts

import { DatabaseConnection } from "../src/config/database";
import { DailyRaceDAO } from "../src/lib/dao/daily-race-dao";
import { BetfairApiClient } from "../src/lib/service/betfair-api-client";
import { LivePriceService } from "../src/lib/service/live-price-service";

const SAMPLE_SIZE = 5;

function todayUtcDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const client = new BetfairApiClient();
  if (!client.hasCredentials()) {
    console.error(
      "Betfair credentials not configured (need betfair.appKey/delayAppKey plus " +
        "either betfair.sessionId or username+password) — nothing real to verify."
    );
    process.exit(1);
  }

  const dbConnection = DatabaseConnection.getInstance();
  await dbConnection.connect();
  const dao = new DailyRaceDAO(dbConnection.getDb());

  const today = todayUtcDateString();
  const races = await dao.getRacesByDate(today);
  if (races.length === 0) {
    console.error(`No real daily_racecards found for ${today} — run the daily-races ingest first, or check the date.`);
    await dbConnection.disconnect();
    process.exit(1);
  }

  const picks: { runnerId: string; horse: string; course: string; offDt: string }[] = [];
  outer: for (const race of races) {
    for (const runner of race.runners) {
      picks.push({ runnerId: runner.runnerId, horse: runner.horse, course: race.course, offDt: race.offDt });
      if (picks.length >= SAMPLE_SIZE) break outer;
    }
  }

  console.log(`Fetching live Betfair prices for ${picks.length} real runners from today's (${today}) real daily_racecards:`);
  for (const p of picks) console.log(`  - ${p.horse} (${p.course}, off ${p.offDt})`);

  const service = new LivePriceService(client);
  const prices = await service.getLivePricesForPicks(picks);

  console.log("\nResults:");
  let resolvedCount = 0;
  for (const p of picks) {
    const result = prices[p.runnerId];
    if (result?.price != null) {
      resolvedCount++;
      console.log(`  ✓ ${p.horse}: ${result.price.toFixed(2)}`);
    } else {
      console.log(`  · ${p.horse}: no live price (${result?.note ?? "no result returned"})`);
    }
  }
  console.log(`\n${resolvedCount}/${picks.length} runners resolved to a real live Betfair price.`);
  console.log(
    "\nNote: 0 resolved is expected outside UK racing hours or for a runner whose race\n" +
      "has already gone off — this script proves the pipeline works, not that every\n" +
      "runner has a live quote at the moment you happen to run it."
  );

  await dbConnection.disconnect();
}

main().catch(error => {
  console.error("live-verify-daily-races-live-price failed:", error);
  process.exit(1);
});
