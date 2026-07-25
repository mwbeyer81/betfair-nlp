#!/usr/bin/env ts-node

// Precomputes per-horse trailing form and must be run AFTER every
// import-industry-sp.ts (re)seed — same replaceOne-wipes-derived-fields
// gotcha as precompute-trainer-form.ts / precompute-jockey-form.ts.
//
// Keyed by horse `name` (there is no stable horse ID in the source CSV —
// the per-runner `id` is a SHA1 of raceId+horse, so it's DIFFERENT for the
// same horse across races and can't be used to track a horse over time).
// This accepts the same name-collision risk the trainer/jockey scripts
// already accept for their string keys.
//
// Unlike trainer/jockey form, this is NOT split by Flat/Jumps category —
// we want a horse's own continuous form line across code types, since a
// single horse's career (unlike a trainer/jockey's roster) is what we're
// summarizing.
//
// Writes onto every runner subdocument, computed as of that runner's own
// race date from ONLY strictly earlier runs by that horse (same Phase A
// read / Phase B write leakage guard as the trainer/jockey scripts —
// history is appended only after every runner in the current race has
// already read the pre-this-race state):
//   - daysSinceLastRun: gap in days since the horse's most recent prior run
//   - horseCareerRuns / horseCareerWinRate: all-time trailing count/rate
//   - horseAvgRPR / horseAvgTS: mean of the horse's own rpr/ts (Racing Post
//     Rating / Topspeed) from its last 3 prior runs — these are POST-RACE
//     performance ratings, so only ever used as trailing history here, never
//     as this race's own value (that would leak the outcome).
//   - horseAvgBeatenDistance: mean overall beaten distance from its last 3
//     prior runs (lower = more competitive recent finishes)
//   - horseAvgExcuseScore / horseTroubleInRunningRate / horseTravelledWellRate:
//     the free-text `comment` field (Racing Post-style in-running commentary)
//     tagged via src/lib/dao/comment-lexicon.ts and aggregated over the same
//     last-3-prior-runs window as horseAvgRPR/horseAvgTS — same leakage
//     guard: never the current race's own comment, only trailing history.
//     Computed only over the subset of recentRuns that actually had a
//     comment (not all of recentRuns), so horses with sparse commentary
//     aren't silently biased toward "no trouble".
//
// horseAvgRPR/horseAvgTS/horseAvgBeatenDistance require the rpr/ts/
// beatenDistance fields added to import-industry-sp.ts — a reseed must have
// run at least once with those fields present for this script to see them.
// Same applies to horseAvgExcuseScore/etc. and the `comment` field.

import { DatabaseConnection } from "../config/database";
import { tagComment, CommentTags } from "../lib/dao/comment-lexicon";

const COLLECTION_NAME = "industry_starting_prices";
const BATCH_SIZE = 1000;
const RECENT_FORM_RUNS = 3;

type RunnerStatus = "WINNER" | "PLACED" | "LOSER" | "NON_FINISHER";

interface RunnerDoc {
  id: number;
  name: string;
  status: RunnerStatus;
  rpr: number | null;
  ts: number | null;
  beatenDistance: number | null;
  comment: string | null;
  daysSinceLastRun?: number | null;
  horseCareerRuns?: number;
  horseCareerWinRate?: number | null;
  horseAvgRPR?: number | null;
  horseAvgTS?: number | null;
  horseAvgBeatenDistance?: number | null;
  horseAvgExcuseScore?: number | null;
  horseTroubleInRunningRate?: number | null;
  horseTravelledWellRate?: number | null;
}

interface RaceDoc {
  _id: number;
  raceId: number;
  raceDate: string; // "YYYY-MM-DD"
  raceTime: string; // ISO "YYYY-MM-DDTHH:mm:00"
  runners: RunnerDoc[];
}

interface HistoryEntry {
  raceDate: string;
  status: RunnerStatus;
  rpr: number | null;
  ts: number | null;
  beatenDistance: number | null;
  tags: CommentTags;
}

function daysBetween(fromDateStr: string, toDateStr: string): number {
  const from = new Date(`${fromDateStr}T00:00:00Z`).getTime();
  const to = new Date(`${toDateStr}T00:00:00Z`).getTime();
  return Math.round((to - from) / (1000 * 60 * 60 * 24));
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

async function run() {
  console.log(`Precomputing horse form (career + trailing last ${RECENT_FORM_RUNS} runs)`);

  const dbConnection = DatabaseConnection.getInstance();
  await dbConnection.connect();
  const db = dbConnection.getDb();
  const racesCollection = db.collection<RaceDoc>(COLLECTION_NAME);

  // Per-horse rolling history (all-time — needed for horseCareerRuns/WinRate).
  const historyMap = new Map<string, HistoryEntry[]>();

  const totalRaces = await racesCollection.estimatedDocumentCount();
  console.log(`Processing ${totalRaces} races in chronological order...`);

  let racesProcessed = 0;
  let runnersWithForm = 0;
  let runnersWithCommentForm = 0;
  let updateBatch: { updateOne: { filter: { _id: number }; update: { $set: { runners: RunnerDoc[] } } } }[] = [];

  const flushUpdateBatch = async () => {
    if (updateBatch.length === 0) return;
    await racesCollection.bulkWrite(updateBatch, { ordered: false });
    updateBatch = [];
  };

  const cursor = racesCollection.find({}).sort({ raceTime: 1 });
  for await (const race of cursor) {
    // Phase A (read): compute every runner's form from history BEFORE any
    // runner in this race is appended to history. Strict raceDate
    // comparison (not just "not yet appended") means two runs of the same
    // horse can never leak into each other even if visited out of exact
    // time order within the same day.
    for (const runner of race.runners) {
      if (!runner.name) continue;
      const history = historyMap.get(runner.name) ?? [];
      const priorRuns = history.filter(h => h.raceDate < race.raceDate);

      if (priorRuns.length > 0) {
        runnersWithForm++;
        const lastRun = priorRuns[priorRuns.length - 1];
        runner.daysSinceLastRun = daysBetween(lastRun.raceDate, race.raceDate);
      } else {
        runner.daysSinceLastRun = null;
      }

      const wins = priorRuns.filter(h => h.status === "WINNER").length;
      runner.horseCareerRuns = priorRuns.length;
      runner.horseCareerWinRate = priorRuns.length > 0 ? (wins / priorRuns.length) * 100 : null;

      const recentRuns = priorRuns.slice(-RECENT_FORM_RUNS);
      runner.horseAvgRPR = mean(recentRuns.map(h => h.rpr).filter((v): v is number => v !== null));
      runner.horseAvgTS = mean(recentRuns.map(h => h.ts).filter((v): v is number => v !== null));
      runner.horseAvgBeatenDistance = mean(
        recentRuns.map(h => h.beatenDistance).filter((v): v is number => v !== null)
      );

      const runsWithComment = recentRuns.filter(h => h.tags.excuseScore !== null);
      if (runsWithComment.length > 0) runnersWithCommentForm++;
      runner.horseAvgExcuseScore = mean(runsWithComment.map(h => h.tags.excuseScore as number));
      runner.horseTroubleInRunningRate =
        runsWithComment.length > 0
          ? (runsWithComment.filter(h => h.tags.hasTroubleInRunning).length / runsWithComment.length) * 100
          : null;
      runner.horseTravelledWellRate =
        runsWithComment.length > 0
          ? (runsWithComment.filter(h => h.tags.hasTravelledWell).length / runsWithComment.length) * 100
          : null;
    }

    // Phase B (write): only now append this race's runs to history.
    for (const runner of race.runners) {
      if (!runner.name) continue;
      const history = historyMap.get(runner.name) ?? [];
      history.push({
        raceDate: race.raceDate,
        status: runner.status,
        rpr: runner.rpr,
        ts: runner.ts,
        beatenDistance: runner.beatenDistance,
        tags: tagComment(runner.comment),
      });
      historyMap.set(runner.name, history);
    }

    updateBatch.push({ updateOne: { filter: { _id: race._id }, update: { $set: { runners: race.runners } } } });
    if (updateBatch.length >= BATCH_SIZE) await flushUpdateBatch();

    racesProcessed++;
    if (racesProcessed % 20000 === 0) console.log(`  processed ${racesProcessed}/${totalRaces} races...`);
  }
  await flushUpdateBatch();

  console.log(`Done writing per-runner horse form onto ${racesProcessed} races (${runnersWithForm} runner-runs had a prior-run sample).`);
  console.log(`  ${runnersWithCommentForm} runner-runs had a commented prior run (comment-derived form).`);
  console.log(`Tracked ${historyMap.size} distinct horse names.`);

  await dbConnection.disconnect();
}

run().catch(error => {
  console.error("Horse form precompute failed:", error);
  process.exit(1);
});
