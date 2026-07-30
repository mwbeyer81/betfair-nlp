#!/usr/bin/env ts-node

// Seeds a committed fixture (a realistic /v1/racecards/free shape, never
// the live RacingAPI) into daily_racecards — used by scripts/local-ci-e2e.sh
// and any test that needs deterministic Daily Races data without a real
// network call. Shares mapRacecardToDoc with fetch-daily-races.ts so the
// field mapping can't drift between the live and test paths.
//
// Usage:
//   MONGODB_URI=... MONGODB_DB_NAME=... npx ts-node src/commands/seed-daily-races-fixture.ts

import { readFileSync } from "fs";
import { join } from "path";
import { DatabaseConnection } from "../config/database";
import { mapRacecardToDoc, DailyRaceDoc } from "../lib/dao/daily-race-dao";

const COLLECTION_NAME = "daily_racecards";
const FIXTURE_PATH = join(__dirname, "../lib/dao/__fixtures__/daily-racecards-free-response.json");

async function run(): Promise<void> {
  const raw = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as { racecards: Record<string, unknown>[] };
  const docs = raw.racecards.map(mapRacecardToDoc);

  const dbConnection = DatabaseConnection.getInstance();
  await dbConnection.connect();
  const db = dbConnection.getDb();
  const collection = db.collection<DailyRaceDoc>(COLLECTION_NAME);

  const ops = docs.map(doc => ({
    replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true },
  }));
  if (ops.length > 0) {
    await collection.bulkWrite(ops, { ordered: false });
  }
  console.log(`Seeded ${docs.length} daily racecards (fixture) into ${COLLECTION_NAME}.`);

  await dbConnection.disconnect();
}

run().catch(error => {
  console.error("seed-daily-races-fixture failed:", error);
  process.exit(1);
});
