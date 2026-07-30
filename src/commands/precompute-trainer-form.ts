#!/usr/bin/env ts-node

// Precomputes trainer recent-form stats and must be run AFTER every
// import-industry-sp.ts (re)seed: that script's replaceOne-per-race upsert
// replaces each race document wholesale, which would silently wipe the
// trainerForm* fields this script writes onto `runners`. Re-run this script
// any time industry_starting_prices is reseeded.
//
// Produces two things in one pass:
//  1. Writes trainerFormRuns/Wins/WinRate/Staked/Returns onto every runner
//     subdocument in industry_starting_prices, computed as of that runner's
//     own race date from ONLY strictly earlier same-category (Flat/Jumps)
//     runs by that trainer — so the per-runner API response already carries
//     form with zero extra round trips.
//  2. Builds the trainer_form collection: one doc per (trainer, formCategory)
//     holding that trainer's full chronological run history — the source of
//     truth the per-runner fields above are derived from, and groundwork for
//     a future trainer drill-down view.

import { DatabaseConnection } from "../config/database";

const COLLECTION_NAME = "industry_starting_prices";
const TRAINER_FORM_COLLECTION_NAME = "trainer_form";
const BATCH_SIZE = 1000;
const FORM_WINDOW_DAYS = 14;
const DROP_FIRST = process.env.DROP_FIRST === "true";

type RunnerStatus = "WINNER" | "PLACED" | "LOSER" | "NON_FINISHER";
type FormCategory = "Flat" | "Jumps";

interface RunnerDoc {
  id: number;
  name: string;
  num: number | null;
  draw: number | null;
  pos: string;
  status: RunnerStatus;
  sortPriority: number;
  isp: number | null;
  ispFraction: string | null;
  isFavourite: boolean;
  jockey?: string;
  trainer?: string;
  trainerFormRuns?: number;
  trainerFormWins?: number;
  trainerFormWinRate?: number | null;
  trainerFormStaked?: number;
  trainerFormReturns?: number;
}

interface RaceDoc {
  _id: number;
  raceId: number;
  course: string;
  raceDate: string; // "YYYY-MM-DD"
  raceTime: string; // ISO "YYYY-MM-DDTHH:mm:00"
  raceType: string;
  runners: RunnerDoc[];
}

interface HistoryEntry {
  raceDate: string;
  isp: number | null;
  status: RunnerStatus;
}

interface TrainerFormRunDoc {
  raceId: number;
  runnerId: number;
  horseName: string;
  raceDate: string;
  course: string;
  status: RunnerStatus;
  pos: string;
  isp: number | null;
}

function toFormCategory(raceType: string): FormCategory {
  return (raceType || "").trim().toLowerCase() === "flat" ? "Flat" : "Jumps";
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function historyKey(trainer: string, category: FormCategory): string {
  return `${trainer}|${category}`;
}

async function run() {
  console.log(`Precomputing trainer form (trailing ${FORM_WINDOW_DAYS} days, split Flat/Jumps)`);

  const dbConnection = DatabaseConnection.getInstance();
  await dbConnection.connect();
  const db = dbConnection.getDb();
  const racesCollection = db.collection<RaceDoc>(COLLECTION_NAME);
  const trainerFormCollection = db.collection(TRAINER_FORM_COLLECTION_NAME);

  if (DROP_FIRST) {
    console.log(`DROP_FIRST=true — dropping ${TRAINER_FORM_COLLECTION_NAME}`);
    await trainerFormCollection.drop().catch(() => {});
  }

  // Per-trainer-per-category rolling history, used only to compute each
  // runner's trailing-window form (small — a few thousand trainers).
  const historyMap = new Map<string, HistoryEntry[]>();
  // Per-trainer-per-category full run list, accumulated into trainer_form
  // documents at the end.
  const trainerFormMap = new Map<string, { trainer: string; formCategory: FormCategory; runs: TrainerFormRunDoc[] }>();

  const totalRaces = await racesCollection.estimatedDocumentCount();
  console.log(`Processing ${totalRaces} races in chronological order...`);

  let racesProcessed = 0;
  let runnersWithForm = 0;
  let updateBatch: { updateOne: { filter: { _id: number }; update: { $set: { runners: RunnerDoc[] } } } }[] = [];

  const flushUpdateBatch = async () => {
    if (updateBatch.length === 0) return;
    await racesCollection.bulkWrite(updateBatch, { ordered: false });
    updateBatch = [];
  };

  const cursor = racesCollection.find({}).sort({ raceTime: 1 });
  for await (const race of cursor) {
    const category = toFormCategory(race.raceType);

    // Phase A (read): compute every runner's form from history BEFORE any
    // runner in this race is appended to history. This is the leakage
    // guard — the strict raceDate comparison below excludes this race's
    // ENTIRE calendar date, not just "not yet appended" entries, so it
    // holds regardless of what order same-day races are visited in, and
    // two runners trained by the same trainer in this same race can never
    // see each other's result.
    const windowStart = addDays(race.raceDate, -FORM_WINDOW_DAYS);
    for (const runner of race.runners) {
      if (!runner.trainer) continue;
      const key = historyKey(runner.trainer, category);
      const history = historyMap.get(key) ?? [];
      const priorRuns = history.filter(h => h.raceDate >= windowStart && h.raceDate < race.raceDate);
      const validPrior = priorRuns.filter(h => h.isp !== null && h.isp > 1);

      const wins = priorRuns.filter(h => h.status === "WINNER").length;
      runner.trainerFormRuns = priorRuns.length;
      runner.trainerFormWins = wins;
      runner.trainerFormWinRate = priorRuns.length > 0 ? (wins / priorRuns.length) * 100 : null;
      runner.trainerFormStaked = validPrior.reduce((sum, h) => sum + 1 / (h.isp! - 1), 0);
      runner.trainerFormReturns = validPrior.reduce(
        (sum, h) => sum + (h.status === "WINNER" ? 1 / (h.isp! - 1) + 1 : 0),
        0
      );
      if (priorRuns.length > 0) runnersWithForm++;
    }

    // Phase B (write): only now append this race's runs to history — after
    // every runner in the race has already read the pre-this-race state.
    for (const runner of race.runners) {
      if (!runner.trainer) continue;
      const key = historyKey(runner.trainer, category);
      const history = historyMap.get(key) ?? [];
      history.push({ raceDate: race.raceDate, isp: runner.isp, status: runner.status });
      historyMap.set(key, history);

      const tf = trainerFormMap.get(key) ?? { trainer: runner.trainer, formCategory: category, runs: [] };
      tf.runs.push({
        raceId: race.raceId,
        runnerId: runner.id,
        horseName: runner.name,
        raceDate: race.raceDate,
        course: race.course,
        status: runner.status,
        pos: runner.pos,
        isp: runner.isp,
      });
      trainerFormMap.set(key, tf);
    }

    updateBatch.push({ updateOne: { filter: { _id: race._id }, update: { $set: { runners: race.runners } } } });
    if (updateBatch.length >= BATCH_SIZE) await flushUpdateBatch();

    racesProcessed++;
    if (racesProcessed % 20000 === 0) console.log(`  processed ${racesProcessed}/${totalRaces} races...`);
  }
  await flushUpdateBatch();

  console.log(`Done writing per-runner form onto ${racesProcessed} races (${runnersWithForm} runner-runs had a sample).`);

  console.log(`Building ${TRAINER_FORM_COLLECTION_NAME} (${trainerFormMap.size} trainer/category pairs)...`);
  const now = new Date().toISOString();
  const trainerFormEntries = [...trainerFormMap.values()];
  for (let i = 0; i < trainerFormEntries.length; i += BATCH_SIZE) {
    const batch = trainerFormEntries.slice(i, i + BATCH_SIZE);
    await trainerFormCollection.bulkWrite(
      batch.map(tf => ({
        updateOne: {
          filter: { trainer: tf.trainer, formCategory: tf.formCategory },
          update: {
            $set: {
              trainer: tf.trainer,
              formCategory: tf.formCategory,
              runs: tf.runs,
              totalRuns: tf.runs.length,
              totalWins: tf.runs.filter(r => r.status === "WINNER").length,
              lastUpdated: now,
            },
          },
          upsert: true,
        },
      })),
      { ordered: false }
    );
    console.log(`  upserted ${Math.min(i + BATCH_SIZE, trainerFormEntries.length)}/${trainerFormEntries.length}`);
  }

  try {
    await trainerFormCollection.createIndex({ trainer: 1, formCategory: 1 }, { unique: true });
  } catch (err) {
    console.warn("createIndex failed for trainer_form {trainer:1,formCategory:1} (non-fatal):", err);
  }

  console.log("Done.");
  await dbConnection.disconnect();
}

run().catch(error => {
  console.error("Trainer form precompute failed:", error);
  process.exit(1);
});
