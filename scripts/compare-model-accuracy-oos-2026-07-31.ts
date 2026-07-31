#!/usr/bin/env ts-node

// MANUAL VERIFICATION SCRIPT — not run by any automated suite.
//
// READ-ONLY: two aggregations, no writes anywhere.
//
// Runs the Model Accuracy band aggregation twice over the same production
// rows — once on `modelWinProbability` (in-sample: written by
// ml/train_and_predict.py's final refit, which fit on the very races it then
// scored) and once on `modelWinProbabilityOos` (out-of-sample: written by
// ml/walk_forward_score.py, where each race was scored by a model fitted only
// on races that finished before it).
//
// The point is to put a number on how much the old screen flattered the model,
// and to confirm the new field is actually a different, harder-nosed
// measurement rather than a copy under a new name.
//
// Usage:
//   npx ts-node scripts/compare-model-accuracy-oos-2026-07-31.ts
//   (reads mongodb.uri / mongodb.dbName from config, same as the app)

import config from "config";
import { MongoClient } from "mongodb";

const BOUNDARIES = [0, 5, 10, 20, 100 / 3, 50, 100.0001];
const LABELS: Record<string, string> = {
  "50.0000": "under 2.0",
  "33.3333": "2.0 - 3.0",
  "20.0000": "3.0 - 5.0",
  "10.0000": "5.0 - 10.0",
  "5.0000": "10.0 - 20.0",
  "0.0000": "20.0+",
};

interface BandRow {
  _id: number | string;
  runnerCount: number;
  wins: number;
  modelProbSum: number;
  marketProbFairSum: number;
  modelSqErrSum: number;
  marketSqErrSum: number;
}

function pipelineFor(field: string): Record<string, unknown>[] {
  return [
    {
      $addFields: {
        _bookSum: {
          $reduce: {
            input: "$runners",
            initialValue: 0,
            in: {
              $add: [
                "$$value",
                { $cond: [{ $gt: ["$$this.isp", 1] }, { $divide: [100, "$$this.isp"] }, 0] },
              ],
            },
          },
        },
      },
    },
    { $unwind: "$runners" },
    { $match: { "runners.isp": { $gt: 1 }, [`runners.${field}`]: { $ne: null } } },
    {
      $project: {
        _id: 0,
        modelProb: `$runners.${field}`,
        marketProbFair: {
          $cond: [
            { $gt: ["$_bookSum", 0] },
            { $multiply: [{ $divide: [{ $divide: [100, "$runners.isp"] }, "$_bookSum"] }, 100] },
            0,
          ],
        },
        isWin: { $cond: [{ $eq: ["$runners.status", "WINNER"] }, 1, 0] },
      },
    },
    {
      $bucket: {
        groupBy: "$modelProb",
        boundaries: BOUNDARIES,
        default: "unbanded",
        output: {
          runnerCount: { $sum: 1 },
          wins: { $sum: "$isWin" },
          modelProbSum: { $sum: "$modelProb" },
          marketProbFairSum: { $sum: "$marketProbFair" },
          modelSqErrSum: {
            $sum: { $pow: [{ $subtract: [{ $divide: ["$modelProb", 100] }, "$isWin"] }, 2] },
          },
          marketSqErrSum: {
            $sum: { $pow: [{ $subtract: [{ $divide: ["$marketProbFair", 100] }, "$isWin"] }, 2] },
          },
        },
      },
    },
  ];
}

function summarise(rows: BandRow[]) {
  const key = (id: number | string) => (typeof id === "number" ? id.toFixed(4) : String(id));
  const byBand = rows
    .map(r => ({
      label: LABELS[key(r._id)] ?? key(r._id),
      lower: typeof r._id === "number" ? r._id : -1,
      runners: r.runnerCount,
      modelSays: (r.modelProbSum / r.runnerCount) || 0,
      actual: (r.wins / r.runnerCount) * 100 || 0,
      market: (r.marketProbFairSum / r.runnerCount) || 0,
      modelBrier: r.modelSqErrSum / r.runnerCount || 0,
      marketBrier: r.marketSqErrSum / r.runnerCount || 0,
    }))
    .sort((a, b) => b.lower - a.lower);

  const totals = rows.reduce(
    (acc, r) => ({
      runners: acc.runners + r.runnerCount,
      wins: acc.wins + r.wins,
      modelSqErrSum: acc.modelSqErrSum + r.modelSqErrSum,
      marketSqErrSum: acc.marketSqErrSum + r.marketSqErrSum,
    }),
    { runners: 0, wins: 0, modelSqErrSum: 0, marketSqErrSum: 0 }
  );

  return {
    bands: byBand,
    runners: totals.runners,
    modelBrier: totals.modelSqErrSum / totals.runners,
    marketBrier: totals.marketSqErrSum / totals.runners,
  };
}

async function main(): Promise<void> {
  const client = new MongoClient(config.get<string>("mongodb.uri"));
  await client.connect();
  try {
    const collection = client.db(config.get<string>("mongodb.dbName")).collection("industry_starting_prices");

    console.log("Aggregating in-sample (modelWinProbability)...");
    const inSample = summarise(
      await collection.aggregate<BandRow>(pipelineFor("modelWinProbability"), { allowDiskUse: true }).toArray()
    );
    console.log("Aggregating out-of-sample (modelWinProbabilityOos)...");
    const oos = summarise(
      await collection.aggregate<BandRow>(pipelineFor("modelWinProbabilityOos"), { allowDiskUse: true }).toArray()
    );

    const pct = (n: number) => `${n.toFixed(1)}%`;
    console.log("\nBand              |        in-sample        |      out-of-sample      | market");
    console.log("                  | says   won    n         | says   won    n         | (fair)");
    console.log("-".repeat(88));
    for (const band of oos.bands) {
      const twin = inSample.bands.find(b => b.label === band.label);
      console.log(
        `${band.label.padEnd(17)} | ${pct(twin?.modelSays ?? 0).padStart(6)} ${pct(twin?.actual ?? 0).padStart(6)} ` +
          `${String(twin?.runners ?? 0).padStart(8)} | ${pct(band.modelSays).padStart(6)} ${pct(band.actual).padStart(6)} ` +
          `${String(band.runners).padStart(8)} | ${pct(band.market).padStart(6)}`
      );
    }

    console.log("\nOverall Brier (lower is better):");
    console.log(`  model, in-sample      ${inSample.modelBrier.toFixed(4)}  over ${inSample.runners.toLocaleString()} runners`);
    console.log(`  model, out-of-sample  ${oos.modelBrier.toFixed(4)}  over ${oos.runners.toLocaleString()} runners`);
    console.log(`  market (same rows)    ${oos.marketBrier.toFixed(4)}`);

    const flattery = oos.modelBrier - inSample.modelBrier;
    console.log(`\nIn-sample scoring understated the model's error by ${flattery.toFixed(4)} of Brier.`);
    console.log(
      oos.modelBrier < oos.marketBrier
        ? "Out-of-sample, the MODEL is more accurate than the market."
        : "Out-of-sample, the MARKET is more accurate than the model."
    );

    // The two fields must not be the same numbers under different names — if
    // the walk-forward write-back had silently copied the in-sample values,
    // every band above would match to the decimal.
    const identical = oos.bands.every(b => {
      const twin = inSample.bands.find(t => t.label === b.label);
      return twin != null && Math.abs(twin.modelSays - b.modelSays) < 0.001 && twin.runners === b.runners;
    });
    console.log(identical
      ? "\nWARNING: the two fields are identical band for band — the walk-forward write-back did not do what it claims."
      : "\nThe two fields differ band for band, as they must.");
  } finally {
    await client.close();
  }
}

main().catch(e => {
  console.error("comparison failed:", e);
  process.exit(1);
});
