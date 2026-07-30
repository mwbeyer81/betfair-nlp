#!/usr/bin/env ts-node

// Seeds a model_evaluations document matching the committed CI-fixture
// model (ml/fixtures/win_probability_model.ci-fixture.json +
// win_probability_model_categories.ci-fixture.json) so
// ml/predict_daily_races.py's "latest model version" lookup has something
// to find without a real train_and_predict.py run in the local-ci hot
// path. Field shape/values are a real evaluation captured when the
// CI-fixture model was generated (trained on the local-ci CSV slice's
// full available date range + the overlap fixture) — modelVersionId is a
// stable id, not the ephemeral timestamp-derived one train_and_predict.py
// normally generates, since this doc is re-seeded on every local-ci run.
//
// Usage:
//   MONGODB_URI=... MONGODB_DB_NAME=... npx ts-node src/commands/seed-model-evaluation-fixture.ts

import { DatabaseConnection } from "../config/database";

const COLLECTION_NAME = "model_evaluations";
export const CI_FIXTURE_MODEL_VERSION_ID = "ci-fixture-model-v1";

async function run(): Promise<void> {
  const dbConnection = DatabaseConnection.getInstance();
  await dbConnection.connect();
  const db = dbConnection.getDb();
  const collection = db.collection(COLLECTION_NAME);

  const doc = {
    _id: CI_FIXTURE_MODEL_VERSION_ID,
    runAt: new Date().toISOString(),
    modelVersionId: CI_FIXTURE_MODEL_VERSION_ID,
    runLabel: "ci-fixture",
    trainingParams: {
      nEstimators: 2000,
      learningRate: 0.03,
      maxDepth: 5,
      subsample: 0.8,
      colsampleBytree: 0.8,
      minChildWeight: 8,
      randomState: 42,
      earlyStoppingRounds: 50,
    },
    featureCols: [
      "course", "going", "raceType", "raceClass", "trainer", "jockey", "sex", "hg",
      "distanceFurlongs", "ran", "num", "draw",
      "trainerFormRuns", "trainerFormWinRate", "trainerFormROI",
      "jockeyFormRuns", "jockeyFormWinRate", "jockeyFormROI",
      "officialRating", "wgt", "age",
      "daysSinceLastRun", "horseCareerRuns", "horseCareerWinRate",
      "horseAvgRPR", "horseAvgTS", "horseAvgBeatenDistance",
      "horseAvgExcuseScore", "horseTroubleInRunningRate", "horseTravelledWellRate",
    ],
    trainRows: 1218,
    testRows: 418,
    trainDateMax: "2026-06-01",
    testDateMin: "2026-06-02",
    bestIteration: 46,
    aucRoc: 0.619903,
    logLoss: 0.367722,
    brierScore: 0.107284,
    calibrationTable: [] as unknown[],
  };

  await collection.replaceOne({ _id: CI_FIXTURE_MODEL_VERSION_ID } as any, doc, { upsert: true });
  console.log(`Seeded model_evaluations fixture (modelVersionId=${CI_FIXTURE_MODEL_VERSION_ID}).`);

  await dbConnection.disconnect();
}

run().catch(error => {
  console.error("seed-model-evaluation-fixture failed:", error);
  process.exit(1);
});
