#!/usr/bin/env ts-node

// MANUAL VERIFICATION SCRIPT — not run by any automated suite (Jest,
// local-ci-e2e.sh, or otherwise). Run by hand, against real dev Mongo and
// the real live RacingAPI, to confirm the Basic-plan upgrade has actually
// taken effect (as of this feature's implementation, /v1/racecards/basic
// still 401'd "Basic Plan required" despite the reported upgrade — see
// .claude/plans/go-to-racingapi-website-zesty-stearns.md).
//
// Deliberately targets /racecards/basic directly (not whatever
// racingApi.racecardsPath currently resolves to) — this script's whole
// point is to check Basic specifically.
//
// Refuses to run against a database whose name looks like the local-ci
// throwaway DB (betfair_nlp_ci_test) — this must run against real dev
// Mongo, not a throwaway one.
//
// Usage:
//   MONGODB_URI=mongodb://localhost:27019 MONGODB_DB_NAME=betfair_nlp_dev \
//     npx ts-node scripts/live-verify-daily-races-basic.ts

import { DatabaseConnection } from "../src/config/database";
import { DailyRaceService } from "../src/lib/service/daily-race-service";
import { RacingApiClient } from "../src/lib/service/racing-api-client";

const BASIC_TIER_ONLY_FIELDS = ["rpr", "ts", "spotlight", "trainer14Days", "trainerRtf"] as const;

async function run(): Promise<void> {
  const dbName = process.env.MONGODB_DB_NAME || "";
  if (/ci[-_]test/i.test(dbName)) {
    console.error(`Refusing to run against "${dbName}" — this script is for real dev Mongo, not a CI throwaway DB.`);
    process.exit(1);
  }

  const client = new RacingApiClient();
  if (!client.hasCredentials()) {
    console.error("RacingAPI credentials not configured (racingApi.username/password).");
    process.exit(1);
  }

  const dbConnection = DatabaseConnection.getInstance();
  await dbConnection.connect();

  console.log("Fetching /racecards/basic directly...");
  let count: number;
  try {
    count = await new DailyRaceService().ingestFromRacingApi(client, "/racecards/basic");
  } catch (error) {
    console.error("\nFAILED — Basic plan is not live yet (or another error occurred):");
    console.error((error as Error).message);
    await dbConnection.disconnect();
    process.exit(1);
  }
  console.log(`Upserted ${count} racecards from /racecards/basic.`);

  if (count === 0) {
    console.log("No racecards returned (could be a quiet day, or nothing wrong) — can't check field presence.");
    await dbConnection.disconnect();
    return;
  }

  const db = dbConnection.getDb();
  const today = new Date().toISOString().slice(0, 10);
  const sample = await db.collection("daily_racecards").findOne({ date: today });
  const runner = sample?.runners?.[0];
  if (!runner) {
    console.log("No runners found in the freshly-ingested data to check.");
  } else {
    console.log(`\nBasic-tier field presence on a sample runner (${runner.horse}):`);
    for (const field of BASIC_TIER_ONLY_FIELDS) {
      console.log(`  ${field}: ${runner[field] === null ? "null" : JSON.stringify(runner[field])}`);
    }
    const anyPresent = BASIC_TIER_ONLY_FIELDS.some(f => runner[f] !== null);
    console.log(
      anyPresent
        ? "\n✓ Basic-tier fields are populated — the plan upgrade is live."
        : "\n⚠ All Basic-tier fields are null — either this account still isn't on Basic, or this runner genuinely has no data for these fields."
    );
  }

  await dbConnection.disconnect();
}

run().catch(error => {
  console.error("live-verify-daily-races-basic failed:", error);
  process.exit(1);
});
