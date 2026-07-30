#!/usr/bin/env ts-node

// MANUAL VERIFICATION SCRIPT — not run by any automated suite (Jest,
// local-ci-e2e.sh, or otherwise). Run by hand to confirm this codebase can
// actually reach the real Betfair Exchange API with whatever credentials
// are currently sitting in config/local.json (gitignored, per-checkout —
// see AGENTS.md's "primary checkout, directly on develop, docs-only"
// dated entry for how those got there and what they mean).
//
// READ-ONLY, SAFE TO RUN AT ANY TIME: this only calls listEventTypes(),
// the same call independently confirmed live in that AGENTS.md entry
// (`{"filter":{}}` -> the real sport/market-count list). It never calls
// placeOrders — there is no order-placing code path in this script at
// all, not even a dry-run one, so running this can never place a bet
// regardless of the betfair.dryRun config value.
//
// Usage:
//   NODE_CONFIG_DIR=./config npx ts-node scripts/live-verify-betfair-api-connection.ts

import { BetfairApiClient } from "../src/lib/service/betfair-api-client";

async function run(): Promise<void> {
  const client = new BetfairApiClient();

  if (!client.hasCredentials()) {
    console.error(
      "Betfair credentials not configured — need betfair.appKey (or " +
        "betfair.delayAppKey) plus either betfair.sessionId, or both " +
        "betfair.username/password, in config/local.json."
    );
    process.exit(1);
  }

  console.log("Calling Betfair listEventTypes (read-only, no order placement)...");
  try {
    const eventTypes = await client.listEventTypes();
    if (eventTypes.length === 0) {
      console.log("Connected, but the response was an empty list — unexpected but not a connectivity failure.");
      return;
    }
    console.log(`\n✓ Connected — received ${eventTypes.length} event types from the real Betfair API:`);
    for (const et of eventTypes) {
      console.log(`  ${et.eventType.name} (id=${et.eventType.id}): ${et.marketCount} markets`);
    }
    const horseRacing = eventTypes.find(et => et.eventType.id === "7");
    if (horseRacing) {
      console.log(`\nHorse Racing market count: ${horseRacing.marketCount} — this is the event type bet-order-service.ts watches.`);
    } else {
      console.log("\nNo Horse Racing (eventTypeId 7) entry in the response — unusual, worth a second look.");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\n✗ FAILED: ${message}`);
    if (message.includes("INVALID_SESSION_INFORMATION")) {
      console.error(
        "\nThe configured sessionId has expired (Betfair session tokens last " +
          "~4h idle / ~24h max, see the AGENTS.md entry referenced above) — " +
          "get a fresh one from https://apps.betfair.com/visualisers/api-ng-" +
          "account-operations/ and update betfair.sessionId in config/local.json. " +
          "Don't assume any sessionId referenced in past chat/session logs is " +
          "still valid."
      );
    } else if (message.includes("INVALID_APP_KEY")) {
      console.error(
        "\nThe configured appKey/delayAppKey is wrong or missing — confirm it " +
          "against Betfair's account application key (getDeveloperAppKeys), not " +
          "a guessed value."
      );
    }
    process.exit(1);
  }
}

run().catch(error => {
  console.error("live-verify-betfair-api-connection failed:", error);
  process.exit(1);
});
