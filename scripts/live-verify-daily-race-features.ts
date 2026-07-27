#!/usr/bin/env ts-node

// MANUAL VERIFICATION SCRIPT — not run by any automated suite. Run by
// hand against real dev Mongo's real historical industry_starting_prices
// data, to see the actual horse/trainer/jockey match rate for whatever
// daily_racecards are currently seeded (run fetch-daily-races.ts first),
// and to mechanically prove this step is read-only against
// industry_starting_prices — the hard boundary
// daily-race-feature-service.ts depends on.
//
// Refuses to run against a database whose name looks like the local-ci
// throwaway DB.
//
// Usage:
//   MONGODB_URI=mongodb://localhost:27019 MONGODB_DB_NAME=betfair_nlp_dev \
//     [DAILY_RACE_DATE=YYYY-MM-DD] npx ts-node scripts/live-verify-daily-race-features.ts

import { createHash } from "crypto";
import { DatabaseConnection } from "../src/config/database";
import { computeDailyRaceFeatures } from "../src/lib/service/daily-race-feature-service";

const HISTORICAL_COLLECTION = "industry_starting_prices";

async function fingerprint(db: import("mongodb").Db): Promise<{ count: number; hash: string }> {
  const count = await db.collection(HISTORICAL_COLLECTION).estimatedDocumentCount();
  // A cheap, deterministic sample-based fingerprint — not a full-collection
  // hash (too slow on a multi-year real dataset) — good enough to catch
  // "something wrote to this collection", not a cryptographic guarantee.
  const sample = await db
    .collection(HISTORICAL_COLLECTION)
    .find({}, { projection: { _id: 1, raceDate: 1 } })
    .sort({ _id: 1 })
    .limit(500)
    .toArray();
  const hash = createHash("sha256").update(JSON.stringify(sample)).digest("hex");
  return { count, hash };
}

async function run(): Promise<void> {
  const dbName = process.env.MONGODB_DB_NAME || "";
  if (/ci[-_]test/i.test(dbName)) {
    console.error(`Refusing to run against "${dbName}" — this script is for real dev Mongo, not a CI throwaway DB.`);
    process.exit(1);
  }

  const date = process.env.DAILY_RACE_DATE || new Date().toISOString().slice(0, 10);

  const dbConnection = DatabaseConnection.getInstance();
  await dbConnection.connect();
  const db = dbConnection.getDb();

  const daily = await db.collection("daily_racecards").countDocuments({ date });
  if (daily === 0) {
    console.error(`No daily_racecards found for ${date} — run fetch-daily-races.ts first.`);
    await dbConnection.disconnect();
    process.exit(1);
  }

  console.log(`Fingerprinting ${HISTORICAL_COLLECTION} before...`);
  const before = await fingerprint(db);

  console.log(`Computing daily race features for ${date}...`);
  const result = await computeDailyRaceFeatures(db, date);

  console.log(`Fingerprinting ${HISTORICAL_COLLECTION} after...`);
  const after = await fingerprint(db);

  console.log(`\nRaces updated: ${result.racesUpdated}`);
  console.log(`Runners updated: ${result.runnersUpdated}`);
  console.log(
    `Horse match rate: ${result.horsesMatched}/${result.horsesTotal} ` +
      `(${result.horsesTotal > 0 ? ((result.horsesMatched / result.horsesTotal) * 100).toFixed(1) : "0"}%)`
  );

  if (before.count !== after.count || before.hash !== after.hash) {
    console.error(
      `\n✗ ${HISTORICAL_COLLECTION} CHANGED (count ${before.count} -> ${after.count}, hash mismatch: ${before.hash !== after.hash}) — this should be impossible, investigate immediately.`
    );
    await dbConnection.disconnect();
    process.exit(1);
  }
  console.log(`\n✓ ${HISTORICAL_COLLECTION} unchanged (count ${after.count}) — read-only boundary held.`);

  const sampleRaces = await db.collection("daily_racecards").find({ date }).limit(2).toArray();
  console.log("\nExample computed rows:");
  for (const race of sampleRaces) {
    for (const runner of (race as any).runners.slice(0, 2)) {
      console.log(
        `  ${runner.horse} (trainer=${runner.trainer}): trainerFormRuns=${runner.trainerFormRuns}, ` +
          `horseCareerRuns=${runner.horseCareerRuns}, horseAvgRPR=${runner.horseAvgRPR}`
      );
    }
  }

  await dbConnection.disconnect();
}

run().catch(error => {
  console.error("live-verify-daily-race-features failed:", error);
  process.exit(1);
});
