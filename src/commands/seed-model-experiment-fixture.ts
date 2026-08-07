#!/usr/bin/env ts-node

// Seeds one model_experiments document so the Model Experiments screen has
// something to render in local CI and in the Playwright e2e suite, without
// needing a real ml/experiment.py run (which reads ~1M runner rows off Atlas
// and takes minutes).
//
// Same idea as seed-model-evaluation-fixture.ts, and the same reason for a
// STABLE experimentId rather than the timestamp-derived one experiment.py
// generates: this doc is re-seeded on every local-ci run, so the e2e spec has
// to be able to name it.
//
// The numbers are the real measured ones from the base-binary control run
// (2026-08-06), not invented: the model loses to industry SP on Brier and
// loses much more heavily on resolution, which is the finding the screen
// exists to communicate. A fixture that showed the model winning would make
// the screen look right while testing nothing real.
//
// Usage:
//   MONGODB_URI=... MONGODB_DB_NAME=... npx ts-node src/commands/seed-model-experiment-fixture.ts

import { DatabaseConnection } from "../config/database";

const COLLECTION_NAME = "model_experiments";
export const CI_FIXTURE_EXPERIMENT_ID = "ci-fixture-experiment-v1";

const modelMetrics = {
  n: 189640,
  aucRoc: 0.71554,
  logLoss: 0.326826,
  brierScore: 0.095289,
  resolution: 0.00721379,
  reliability: 0.000098,
  uncertainty: 0.100468,
  withinBin: -0.000059,
  top1Rate: 0.260771,
  mrr: 0.4207,
  races: 21012,
};

const marketMetrics = {
  ...modelMetrics,
  aucRoc: 0.785405,
  logLoss: 0.300242,
  brierScore: 0.088829,
  resolution: 0.01363617,
  reliability: 0.000085,
  top1Rate: 0.348483,
};

function segment(
  dimension: string,
  bucket: string,
  bucketOrder: number,
  bss: number,
  roiLevel: number,
  roiToWin1: number
) {
  return {
    dimension,
    bucket,
    bucketOrder,
    n: 44000,
    scoredN: 43980,
    wins: 5100,
    strikeRate: 11.59,
    model: modelMetrics,
    market: marketMetrics,
    bss,
    selections: {
      all: {
        n: 44000,
        wins: 5100,
        strikeRate: 11.59,
        bettableN: 43980,
        pnl: {
          toWin1: { staked: 8000, returns: 8000 * (1 + roiToWin1 / 100), pnl: 8000 * (roiToWin1 / 100), roiPct: roiToWin1 },
          level: { staked: 44000, returns: 44000 * (1 + roiLevel / 100), pnl: 44000 * (roiLevel / 100), roiPct: roiLevel },
        },
      },
    },
    yearsPositiveToWin1: 2,
    yearsPositiveLevel: 1,
  };
}

async function run(): Promise<void> {
  const dbConnection = DatabaseConnection.getInstance();
  await dbConnection.connect();
  const db = dbConnection.getDb();
  const collection = db.collection(COLLECTION_NAME);

  const doc = {
    _id: CI_FIXTURE_EXPERIMENT_ID,
    experimentId: CI_FIXTURE_EXPERIMENT_ID,
    name: "ci-fixture-control",
    notes: "Seeded fixture — the deployed feature set and objective.",
    runAt: new Date().toISOString(),
    gitCommit: "",
    mode: "fast",
    featureSetName: "baseline",
    objective: "binary",
    featureCols: ["course", "going", "raceType", "officialRating", "wgt"],
    newFeatureCols: [],
    featureCoverage: [
      { col: "course", populatedPct: 100 },
      { col: "officialRating", populatedPct: 78.1 },
    ],
    trainingParams: { maxDepth: 5, learningRate: 0.03, nEstimatorsCap: 300, seed: 42 },
    foldYears: ["2022", "2023", "2024", "2025", "2026"],
    foldCount: 5,
    scoredRows: 189640,
    unscoredRows: 296758,
    droppedTrainRaces: 0,
    coverageMinDate: "2022-01-01",
    coverageMaxDate: "2026-08-05",
    overall: {
      model: modelMetrics,
      calibrated: { ...modelMetrics, brierScore: 0.095243 },
      market: marketMetrics,
      bss: -0.072724,
    },
    folds: [
      { year: "2022", trainRows: 265382, scoredRows: 42863, seconds: 18.9, calibrationSource: "none", raw: { n: 42863, aucRoc: 0.716884, logLoss: 0.330476, brierScore: 0.096808 } },
      { year: "2023", trainRows: 304972, scoredRows: 42643, seconds: 18.5, calibrationSource: "prior-folds-oos", raw: { n: 42643, aucRoc: 0.71342, logLoss: 0.324543, brierScore: 0.094364 } },
    ],
    spBandTable: [segment("spBand", "5.0-10.0", 3, -0.026, -11.7, -9.4)],
    segments: [
      segment("spBand", "under 2.0", 0, -0.344, -4.1, -3.2),
      segment("spBand", "5.0-10.0", 3, -0.026, -11.7, -9.4),
      segment("raceType", "Chase", 0, -0.041, -9.4, -8.1),
      segment("raceType", "Flat", 1, -0.063, -12.2, -11.1),
    ],
    acceptanceRule: {
      minN: 20000,
      minBss: 0,
      requirePositiveUnderBothStakings: true,
      minYearsPositiveFraction: 8 / 11, minYearsPositive: 4, foldYearsScored: 5,
    },
    // Empty on purpose: the control model has no edge, so nothing passes the
    // acceptance rule. The screen has to read correctly in that state, which
    // is the state it will be in most of the time.
    discoveredSegments: [],
    filterBattery: [],
    totalSeconds: 338.6,
    wroteModelArtifacts: false,
  };

  await collection.replaceOne({ _id: CI_FIXTURE_EXPERIMENT_ID } as never, doc as never, { upsert: true });
  console.log(`Seeded ${COLLECTION_NAME} fixture ${CI_FIXTURE_EXPERIMENT_ID}`);
  await dbConnection.disconnect();
}

if (require.main === module) {
  run().catch(error => {
    console.error("seed-model-experiment-fixture failed:", error);
    process.exit(1);
  });
}
