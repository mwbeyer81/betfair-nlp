#!/usr/bin/env ts-node

// ONE-OFF backfill for the four days that fell between two events that did not
// quite meet:
//
//   * ml/walk_forward_score.py's last run wrote modelWinProbabilityOos up to
//     and including 2026-07-30, and no further.
//   * commit 5ac6e26 (2026-08-04, "model filters were reading the in-sample
//     field, which already knew the winners") added the line in
//     industry-sp-results-capture-service.ts that writes the live pre-race
//     prediction to modelWinProbabilityOos as well as modelWinProbability.
//
// So 2026-07-31 .. 2026-08-03 — 911 runners over 114 races — were captured with
// a real pre-race prediction in `modelWinProbability` and nothing in
// `modelWinProbabilityOos`. Every model filter, the Model Accuracy screen and
// the saved-filter live results read the Oos field, so those four days are
// invisible to all of them.
//
// This is NOT an ongoing bug. Everything from 2026-08-04 onward is written
// correctly by the capture path. This closes the historical hole once, and
// should never need running again.
//
// ============================ THE DANGER ============================
// A blanket `modelWinProbability -> modelWinProbabilityOos` copy across history
// would be a disaster, and it is precisely the disaster 5ac6e26 fixed:
// ml/train_and_predict.py's final refit writes modelWinProbability from a model
// fitted on the very races it then scores, so on historical rows that field
// ALREADY KNOWS THE WINNERS. Copying it into the honest field took the "model
// beats SP" filter from a true -18.75% to a fictional +4.48%.
//
// What makes this safe is that it is NOT a copy. Every value is read from
// `daily_racecards` — the 06:00 UTC pre-race prediction, written hours before
// the race ran — and is then checked against the value already stored in
// `modelWinProbability`. A row whose stored value disagrees with the pre-race
// prediction, or that has no pre-race prediction at all, is SKIPPED and
// counted, never guessed at. (Verified before writing this: all 911 rows in the
// window match their pre-race prediction exactly.)
//
// The date window is a hardcoded constant, not an argument, so this cannot be
// pointed at history by a stray flag.
// ====================================================================
//
// Usage — dry run, reports what it would do and writes nothing:
//   MONGODB_URI=... MONGODB_DB_NAME=... npx ts-node src/commands/backfill-oos-capture-gap.ts
// To actually write:
//   ... npx ts-node src/commands/backfill-oos-capture-gap.ts --apply

import { DatabaseConnection } from "../config/database";

const ISP_COLLECTION = "industry_starting_prices";
const DAILY_COLLECTION = "daily_racecards";

// Hardcoded, deliberately. See THE DANGER above.
const GAP_FROM = "2026-07-31";
const GAP_TO = "2026-08-03";

// "Brash (IRE)" -> "brash". industry_starting_prices carries the country suffix
// the RacingAPI racecard does not, so the horse name needs normalising on both
// sides before it can be used as a join key.
function normaliseHorse(name: string | null | undefined): string {
  return (name ?? "").replace(/\s*\([A-Z]{2,3}\)\s*$/, "").trim().toLowerCase();
}

interface DailyRunnerLite {
  horse?: string;
  modelWinProbability?: number | null;
}
interface DailyRaceLite {
  date: string;
  course: string;
  runners: DailyRunnerLite[];
}
interface IspRunnerLite {
  name?: string;
  modelWinProbability?: number | null;
  modelWinProbabilityOos?: number | null;
}
interface IspRaceLite {
  _id: number;
  raceDate: string;
  course: string;
  runners: IspRunnerLite[];
}

async function run(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const dbConnection = DatabaseConnection.getInstance();
  await dbConnection.connect();
  const db = dbConnection.getDb();

  // The pre-race predictions, keyed by (date, course, horse). Keyed on the
  // horse rather than the RacingAPI race_id because industry_starting_prices
  // stores a synthesised NUMERIC raceId, not the raw string id the racecard is
  // keyed by — so there is no shared race key to join on.
  const predictions = new Map<string, number>();
  const dailyCursor = db.collection<DailyRaceLite>(DAILY_COLLECTION).find(
    { date: { $gte: GAP_FROM, $lte: GAP_TO } },
    { projection: { date: 1, course: 1, "runners.horse": 1, "runners.modelWinProbability": 1 } }
  );
  for await (const race of dailyCursor) {
    for (const runner of race.runners ?? []) {
      if (runner.modelWinProbability == null) continue;
      predictions.set(`${race.date}|${race.course}|${normaliseHorse(runner.horse)}`, runner.modelWinProbability);
    }
  }
  console.log(`Loaded ${predictions.size} pre-race predictions for ${GAP_FROM}..${GAP_TO}`);

  let racesTouched = 0;
  let toWrite = 0;
  let alreadySet = 0;
  let skippedNoPrediction = 0;
  let skippedDisagrees = 0;
  const ops: Array<Record<string, unknown>> = [];

  const ispCursor = db.collection<IspRaceLite>(ISP_COLLECTION).find(
    { raceDate: { $gte: GAP_FROM, $lte: GAP_TO } },
    {
      projection: {
        raceDate: 1, course: 1,
        "runners.name": 1,
        "runners.modelWinProbability": 1,
        "runners.modelWinProbabilityOos": 1,
      },
    }
  );

  for await (const race of ispCursor) {
    const set: Record<string, number> = {};
    const arrayFilters: Record<string, unknown>[] = [];
    let i = 0;

    for (const runner of race.runners ?? []) {
      if (runner.modelWinProbabilityOos != null) {
        alreadySet++;
        continue;
      }
      const prediction = predictions.get(
        `${race.raceDate}|${race.course}|${normaliseHorse(runner.name)}`
      );
      if (prediction == null) {
        skippedNoPrediction++;
        continue;
      }
      // The cross-check that makes this a recovery rather than a copy: the
      // value already captured must BE the pre-race prediction. If it is not,
      // this row's provenance is not what we believe and it is left alone.
      if (
        runner.modelWinProbability == null ||
        Math.abs(runner.modelWinProbability - prediction) > 1e-6
      ) {
        skippedDisagrees++;
        continue;
      }
      set[`runners.$[r${i}].modelWinProbabilityOos`] = prediction;
      arrayFilters.push({ [`r${i}.name`]: runner.name });
      i++;
      toWrite++;
    }

    if (i > 0) {
      racesTouched++;
      ops.push({ updateOne: { filter: { _id: race._id }, update: { $set: set }, arrayFilters } });
    }
  }

  console.log(`\n  races to update:            ${racesTouched}`);
  console.log(`  runners to backfill:        ${toWrite}`);
  console.log(`  already had an Oos value:   ${alreadySet}`);
  console.log(`  skipped, no pre-race pred:  ${skippedNoPrediction}`);
  console.log(`  skipped, value disagrees:   ${skippedDisagrees}`);

  if (!apply) {
    console.log(`\nDRY RUN — nothing written. Re-run with --apply to write.`);
    await dbConnection.disconnect();
    return;
  }

  const collection = db.collection<IspRaceLite>(ISP_COLLECTION);
  for (let i = 0; i < ops.length; i += 500) {
    await collection.bulkWrite(ops.slice(i, i + 500) as never, { ordered: false });
    console.log(`  wrote ${Math.min(i + 500, ops.length)}/${ops.length} races...`);
  }
  console.log(`\nDone. Backfilled ${toWrite} runners across ${racesTouched} races.`);
  await dbConnection.disconnect();
}

if (require.main === module) {
  run().catch(error => {
    console.error("backfill-oos-capture-gap failed:", error);
    process.exit(1);
  });
}
