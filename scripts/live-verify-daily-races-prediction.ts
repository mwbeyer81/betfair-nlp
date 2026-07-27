#!/usr/bin/env ts-node

// MANUAL VERIFICATION SCRIPT — not run by any automated suite. Runs the
// REAL ml/predict_daily_races.py against the REAL trained model
// (ml/models/win_probability_model.json — NOT the committed CI-fixture
// artifact) and real dev Mongo, then reads the results back and checks
// they're actually sane, not just "didn't crash": range, per-race sums,
// and a favorite-vs-outsider plausibility check (the runner with the
// highest official rating in a field of 4+ should usually score above the
// field average — not a hard guarantee, just a sanity signal worth a
// human's eyes if it's ever wildly wrong).
//
// Refuses to run against a database whose name looks like the local-ci
// throwaway DB.
//
// Usage:
//   MONGODB_URI=mongodb://localhost:27019 MONGODB_DB_NAME=betfair_nlp_dev \
//     [DAILY_RACE_DATE=YYYY-MM-DD] npx ts-node scripts/live-verify-daily-races-prediction.ts
//
// Precondition: daily_racecards populated (fetch-daily-races.ts) and
// features already computed (compute-daily-race-features.ts or
// live-verify-daily-race-features.ts) for the target date.

import { spawnSync } from "child_process";
import { join } from "path";
import { DatabaseConnection } from "../src/config/database";

async function run(): Promise<void> {
  const dbName = process.env.MONGODB_DB_NAME || "";
  if (/ci[-_]test/i.test(dbName)) {
    console.error(`Refusing to run against "${dbName}" — this script is for real dev Mongo, not a CI throwaway DB.`);
    process.exit(1);
  }

  const date = process.env.DAILY_RACE_DATE || new Date().toISOString().slice(0, 10);
  const mlDir = join(__dirname, "..", "ml");
  const pythonBin = join(mlDir, "venv", "bin", "python");

  console.log(`Running ml/predict_daily_races.py for ${date} (real trained model, real dev Mongo)...`);
  const result = spawnSync(pythonBin, ["predict_daily_races.py"], {
    cwd: mlDir,
    env: { ...process.env, DAILY_RACE_DATE: date },
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.status !== 0) {
    console.error(`\npredict_daily_races.py exited with code ${result.status}`);
    process.exit(result.status ?? 1);
  }

  const dbConnection = DatabaseConnection.getInstance();
  await dbConnection.connect();
  const db = dbConnection.getDb();
  const races = await db.collection("daily_racecards").find({ date }).toArray();

  let outOfRange = 0;
  let badSums = 0;
  let favouriteChecks = 0;
  let favouriteAboveAverage = 0;

  console.log("\nPer-race results:");
  for (const race of races as any[]) {
    const runners = race.runners.filter((r: any) => r.modelWinProbability != null);
    if (runners.length === 0) continue;
    const sum = runners.reduce((s: number, r: any) => s + r.modelWinProbability, 0);
    const avg = sum / runners.length;
    for (const r of runners) {
      if (r.modelWinProbability < 0 || r.modelWinProbability > 100) outOfRange++;
    }
    if (Math.abs(sum - 100) > 0.5) badSums++;

    if (runners.length >= 4) {
      const withRating = runners.filter((r: any) => r.officialRating != null);
      if (withRating.length >= 4) {
        const favourite = withRating.reduce((best: any, r: any) => (r.officialRating > best.officialRating ? r : best));
        favouriteChecks++;
        if (favourite.modelWinProbability >= avg) favouriteAboveAverage++;
      }
    }

    console.log(`  ${race.raceName} (${race.course}): sum=${sum.toFixed(1)}, runners=${runners.length}`);
  }

  console.log(`\nOut-of-range predictions: ${outOfRange}`);
  console.log(`Races not summing to ~100: ${badSums}`);
  if (favouriteChecks > 0) {
    console.log(
      `Highest-official-rating runner scored above the race average in ${favouriteAboveAverage}/${favouriteChecks} races ` +
        `(${((favouriteAboveAverage / favouriteChecks) * 100).toFixed(0)}%) — not a hard pass/fail, just a plausibility signal.`
    );
  }
  if (outOfRange === 0 && badSums === 0) {
    console.log("\n✓ Predictions look structurally sane.");
  } else {
    console.error("\n✗ Structural sanity checks failed — investigate before trusting this run's output.");
  }

  await dbConnection.disconnect();
}

run().catch(error => {
  console.error("live-verify-daily-races-prediction failed:", error);
  process.exit(1);
});
