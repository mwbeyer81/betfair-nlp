#!/usr/bin/env ts-node

// Precomputes jockey recent-form stats and must be run AFTER every
// import-industry-sp.ts (re)seed: that script's replaceOne-per-race upsert
// replaces each race document wholesale, which would silently wipe the
// jockeyForm* fields this script writes onto `runners`. Re-run this script
// any time industry_starting_prices is reseeded (same gotcha as
// precompute-trainer-form.ts, mirrored here keyed by jockey instead of
// trainer).
//
// Produces two things in one pass:
//  1. Writes jockeyFormRuns/Wins/WinRate/Staked/Returns onto every runner
//     subdocument in industry_starting_prices, computed as of that runner's
//     own race date from ONLY strictly earlier same-category (Flat/Jumps)
//     runs by that jockey.
//  2. Builds the jockey_form collection: one doc per (jockey, formCategory)
//     holding that jockey's full chronological run history — same shape as
//     trainer_form.

import { DatabaseConnection } from "../config/database";

const COLLECTION_NAME = "industry_starting_prices";
const JOCKEY_FORM_COLLECTION_NAME = "jockey_form";
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
  jockeyFormRuns?: number;
  jockeyFormWins?: number;
  jockeyFormWinRate?: number | null;
  jockeyFormStaked?: number;
  jockeyFormReturns?: number;
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

interface JockeyFormRunDoc {
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

function historyKey(jockey: string, category: FormCategory): string {
  return `${jockey}|${category}`;
}

async function run() {
  console.log(`Precomputing jockey form (trailing ${FORM_WINDOW_DAYS} days, split Flat/Jumps)`);

  const dbConnection = DatabaseConnection.getInstance();
  await dbConnection.connect();
  const db = dbConnection.getDb();
  const racesCollection = db.collection<RaceDoc>(COLLECTION_NAME);
  const jockeyFormCollection = db.collection(JOCKEY_FORM_COLLECTION_NAME);

  if (DROP_FIRST) {
    console.log(`DROP_FIRST=true — dropping ${JOCKEY_FORM_COLLECTION_NAME}`);
    await jockeyFormCollection.drop().catch(() => {});
  }

  // Per-jockey-per-category rolling history, used only to compute each
  // runner's trailing-window form.
  const historyMap = new Map<string, HistoryEntry[]>();
  // Per-jockey-per-category full run list, accumulated into jockey_form
  // documents at the end.
  const jockeyFormMap = new Map<string, { jockey: string; formCategory: FormCategory; runs: JockeyFormRunDoc[] }>();

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
    // runner in this race is appended to history — same leakage guard as
    // precompute-trainer-form.ts (strict raceDate comparison excludes this
    // race's entire calendar date, not just "not yet appended" entries).
    const windowStart = addDays(race.raceDate, -FORM_WINDOW_DAYS);
    for (const runner of race.runners) {
      if (!runner.jockey) continue;
      const key = historyKey(runner.jockey, category);
      const history = historyMap.get(key) ?? [];
      const priorRuns = history.filter(h => h.raceDate >= windowStart && h.raceDate < race.raceDate);
      const validPrior = priorRuns.filter(h => h.isp !== null && h.isp > 1);

      const wins = priorRuns.filter(h => h.status === "WINNER").length;
      runner.jockeyFormRuns = priorRuns.length;
      runner.jockeyFormWins = wins;
      runner.jockeyFormWinRate = priorRuns.length > 0 ? (wins / priorRuns.length) * 100 : null;
      runner.jockeyFormStaked = validPrior.reduce((sum, h) => sum + 1 / (h.isp! - 1), 0);
      runner.jockeyFormReturns = validPrior.reduce(
        (sum, h) => sum + (h.status === "WINNER" ? 1 / (h.isp! - 1) + 1 : 0),
        0
      );
      if (priorRuns.length > 0) runnersWithForm++;
    }

    // Phase B (write): only now append this race's runs to history — after
    // every runner in the race has already read the pre-this-race state.
    for (const runner of race.runners) {
      if (!runner.jockey) continue;
      const key = historyKey(runner.jockey, category);
      const history = historyMap.get(key) ?? [];
      history.push({ raceDate: race.raceDate, isp: runner.isp, status: runner.status });
      historyMap.set(key, history);

      const jf = jockeyFormMap.get(key) ?? { jockey: runner.jockey, formCategory: category, runs: [] };
      jf.runs.push({
        raceId: race.raceId,
        runnerId: runner.id,
        horseName: runner.name,
        raceDate: race.raceDate,
        course: race.course,
        status: runner.status,
        pos: runner.pos,
        isp: runner.isp,
      });
      jockeyFormMap.set(key, jf);
    }

    updateBatch.push({ updateOne: { filter: { _id: race._id }, update: { $set: { runners: race.runners } } } });
    if (updateBatch.length >= BATCH_SIZE) await flushUpdateBatch();

    racesProcessed++;
    if (racesProcessed % 20000 === 0) console.log(`  processed ${racesProcessed}/${totalRaces} races...`);
  }
  await flushUpdateBatch();

  console.log(`Done writing per-runner form onto ${racesProcessed} races (${runnersWithForm} runner-runs had a sample).`);

  console.log(`Building ${JOCKEY_FORM_COLLECTION_NAME} (${jockeyFormMap.size} jockey/category pairs)...`);
  const now = new Date().toISOString();
  const jockeyFormEntries = [...jockeyFormMap.values()];
  for (let i = 0; i < jockeyFormEntries.length; i += BATCH_SIZE) {
    const batch = jockeyFormEntries.slice(i, i + BATCH_SIZE);
    await jockeyFormCollection.bulkWrite(
      batch.map(jf => ({
        updateOne: {
          filter: { jockey: jf.jockey, formCategory: jf.formCategory },
          update: {
            $set: {
              jockey: jf.jockey,
              formCategory: jf.formCategory,
              runs: jf.runs,
              totalRuns: jf.runs.length,
              totalWins: jf.runs.filter(r => r.status === "WINNER").length,
              lastUpdated: now,
            },
          },
          upsert: true,
        },
      })),
      { ordered: false }
    );
    console.log(`  upserted ${Math.min(i + BATCH_SIZE, jockeyFormEntries.length)}/${jockeyFormEntries.length}`);
  }

  try {
    await jockeyFormCollection.createIndex({ jockey: 1, formCategory: 1 }, { unique: true });
  } catch (err) {
    console.warn("createIndex failed for jockey_form {jockey:1,formCategory:1} (non-fatal):", err);
  }

  console.log("Done.");
  await dbConnection.disconnect();
}

run().catch(error => {
  console.error("Jockey form precompute failed:", error);
  process.exit(1);
});
