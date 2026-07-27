#!/usr/bin/env ts-node

// Computes trailing trainer/jockey/horse form for today's daily_racecards
// runners by querying the real historical industry_starting_prices
// collection (read-only) — see src/lib/service/daily-race-feature-service.ts
// for the full explanation and the hard "never write to
// industry_starting_prices" boundary. Must run AFTER fetch-daily-races.ts
// (or seed-daily-races-fixture.ts) has populated daily_racecards for the
// target date, and BEFORE ml/predict_daily_races.py.
//
// Usage:
//   MONGODB_URI=... MONGODB_DB_NAME=... [DAILY_RACE_DATE=YYYY-MM-DD] \
//     npx ts-node src/commands/compute-daily-race-features.ts
// DAILY_RACE_DATE defaults to today's UTC date.

import { DatabaseConnection } from "../config/database";
import { computeDailyRaceFeatures } from "../lib/service/daily-race-feature-service";

async function run(): Promise<void> {
  const date = process.env.DAILY_RACE_DATE || new Date().toISOString().slice(0, 10);

  const dbConnection = DatabaseConnection.getInstance();
  await dbConnection.connect();
  const db = dbConnection.getDb();

  const result = await computeDailyRaceFeatures(db, date);
  console.log(
    `Computed features for ${date}: ${result.racesUpdated} races, ${result.runnersUpdated} runners ` +
      `(${result.horsesMatched}/${result.horsesTotal} horses matched prior history).`
  );

  await dbConnection.disconnect();
}

run().catch(error => {
  console.error("compute-daily-race-features failed:", error);
  process.exit(1);
});
