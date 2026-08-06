/**
 * Seeds SYNTHETIC modelWinProbability/modelVersionId AND
 * modelWinProbabilityOos onto runners in industry_starting_prices, so both the
 * in-sample consumers (Model vs SP, Filters) and the Model Accuracy screen —
 * which reads the out-of-sample field only — have something to aggregate in
 * the local-CI e2e stack.
 *
 * Why synthetic: the real values are written by ml/train_and_predict.py, which
 * retrains from scratch — far too slow and non-deterministic for the local-CI
 * hot path (see local-ci-e2e.sh's Step 3d, which installs a committed fixture
 * model for exactly the same reason). These numbers are NOT a model output and
 * must never be treated as one; they exist purely so the endpoint's
 * aggregation, banding and rendering can be exercised end to end against a
 * real backend.
 *
 * Deliberately NOT derived from isp. Deriving the "model" probability from the
 * market price would make the model and market columns near-identical and the
 * error comparison degenerate — the e2e would then pass even if the two were
 * wired to the same source. A deterministic per-runner hash keeps the two
 * genuinely independent while staying stable across runs.
 *
 * Usage (local-CI only — never point this at a real database):
 *   MONGODB_URI=... MONGODB_DB_NAME=... npx ts-node src/commands/seed-isp-model-probabilities.ts
 */

import { MongoClient } from "mongodb";

const COLLECTION_NAME = "industry_starting_prices";
const MODEL_VERSION_ID = "xgb-ci-fixture";

interface SeedRunner {
  id: number;
  isp: number | null;
}

interface SeedRace {
  _id: number;
  runners: SeedRunner[];
}

// Stable, evenly-spread pseudo-random weight in [1, 100] from a runner id.
// Plain integer hashing, no dependency, identical on every run.
function runnerWeight(id: number): number {
  const h = Math.abs(Math.imul(id ^ 0x9e3779b9, 0x85ebca6b)) % 1000;
  return 1 + h / 10;
}

// A DIFFERENT weight for the out-of-sample field, on purpose. Seeding both
// fields with the same number would make the e2e pass even if the Model
// Accuracy screen were wired back to modelWinProbability — the exact
// regression this whole change exists to prevent. A different salt means the
// two fields produce visibly different bands.
function runnerWeightOos(id: number): number {
  const h = Math.abs(Math.imul(id ^ 0x7f4a7c15, 0xc2b2ae35)) % 1000;
  return 1 + h / 10;
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB_NAME;
  if (!uri || !dbName) {
    console.error("MONGODB_URI and MONGODB_DB_NAME are required");
    process.exit(1);
  }

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const collection = client.db(dbName).collection<SeedRace>(COLLECTION_NAME);
    const races = await collection.find({}, { projection: { _id: 1, runners: 1 } }).toArray();
    console.log(`Scoring ${races.length} races with synthetic probabilities...`);

    let updated = 0;
    let scoredRunners = 0;
    let oosScoredRunners = 0;

    for (const race of races) {
      const runners = race.runners ?? [];
      // Only priced runners are eligible, matching the isp > 1 gate the rest of
      // the app applies (import-industry-sp.ts:139).
      const eligible = runners.filter(r => r.isp != null && r.isp > 1);
      if (eligible.length === 0) continue;

      const weights = eligible.map(r => runnerWeight(r.id));
      const total = weights.reduce((s, w) => s + w, 0);
      const oosWeights = eligible.map(r => runnerWeightOos(r.id));
      const oosTotal = oosWeights.reduce((s, w) => s + w, 0);

      // A slice of races is deliberately left WITHOUT an out-of-sample score,
      // standing in for the earliest real races that have no prior form behind
      // them. Without this the e2e could never exercise the coverage line or
      // the "unscored runners are excluded, not zero-filled" rule, both of
      // which are the point of the field.
      const hasOosScore = race._id % 5 !== 0;

      const setFields: Record<string, unknown> = {};
      const arrayFilters: Record<string, unknown>[] = [];
      eligible.forEach((runner, i) => {
        // Normalized within the race to sum to 100, the same invariant
        // ml/train_and_predict.py's normalize_within_race() guarantees.
        const pct = Math.round((weights[i] / total) * 100 * 100) / 100;
        setFields[`runners.$[r${i}].modelWinProbability`] = pct;
        setFields[`runners.$[r${i}].modelVersionId`] = MODEL_VERSION_ID;
        if (hasOosScore) {
          setFields[`runners.$[r${i}].modelWinProbabilityOos`] =
            Math.round((oosWeights[i] / oosTotal) * 100 * 100) / 100;
        }
        arrayFilters.push({ [`r${i}.id`]: runner.id });
      });

      await collection.updateOne({ _id: race._id }, { $set: setFields }, { arrayFilters });
      updated += 1;
      scoredRunners += eligible.length;
      if (hasOosScore) oosScoredRunners += eligible.length;
    }

    console.log(`Done. Scored ${scoredRunners} runners across ${updated} races as ${MODEL_VERSION_ID}, ` +
      `of which ${oosScoredRunners} also carry a synthetic out-of-sample score.`);
  } finally {
    await client.close();
  }
}

main().catch(err => {
  console.error("seed-isp-model-probabilities failed:", err);
  process.exit(1);
});
