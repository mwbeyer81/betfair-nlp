#!/usr/bin/env ts-node

// Seeds a small, hand-crafted set of industry_starting_prices-shaped
// historical races into that collection — deliberately overlapping (same
// trainer/jockey/horse names) with the daily-races fixture
// (daily-racecards-free-response.json) so
// compute-daily-race-features.ts's targeted trainer/jockey/horse queries
// have real, deterministic prior history to join against in local-ci.
//
// A separate command from import-industry-sp.ts on purpose — the real CSV
// import path stays untouched. Idempotent (upsert-by-_id), safe to re-run.
//
// Usage:
//   MONGODB_URI=... MONGODB_DB_NAME=... npx ts-node src/commands/seed-industry-sp-overlap-fixture.ts

import { readFileSync } from "fs";
import { join } from "path";
import { DatabaseConnection } from "../config/database";

const COLLECTION_NAME = "industry_starting_prices";
const FIXTURE_PATH = join(__dirname, "../lib/dao/__fixtures__/industry-sp-daily-races-overlap-fixture.json");

interface OverlapFixtureRace {
  _id: number;
  [key: string]: unknown;
}

async function run(): Promise<void> {
  const races = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as OverlapFixtureRace[];

  const dbConnection = DatabaseConnection.getInstance();
  await dbConnection.connect();
  const db = dbConnection.getDb();
  const collection = db.collection<OverlapFixtureRace>(COLLECTION_NAME);

  const ops = races.map(race => ({
    replaceOne: { filter: { _id: race._id }, replacement: race, upsert: true },
  }));
  if (ops.length > 0) {
    await collection.bulkWrite(ops, { ordered: false });
  }
  console.log(`Seeded ${races.length} overlap-fixture historical races into ${COLLECTION_NAME}.`);

  await dbConnection.disconnect();
}

run().catch(error => {
  console.error("seed-industry-sp-overlap-fixture failed:", error);
  process.exit(1);
});
