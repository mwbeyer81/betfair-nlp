#!/usr/bin/env ts-node

// MANUAL ANALYSIS SCRIPT — not run by any automated suite.
//
// READ-ONLY: aggregations only, no writes anywhere.
//
// Question: does the model make money where it DISAGREES with the market, and
// how big does the disagreement have to be before backing is worth it?
//
// Scored strictly on `modelWinProbabilityOos` (walk-forward: each race scored
// by a model fitted only on races that finished before it), never on
// `modelWinProbability` — see model-accuracy-dao.ts:17-38 for why that
// distinction is load-bearing.
//
// Disagreement is measured as ratio = modelProb / marketProbFair, where
// marketProbFair is the ISP-implied probability renormalised by the race's book
// sum (a bookmaker book sums to ~115-125%, the model's to exactly 100). ratio > 1
// means the model rates the runner MORE likely than the market does — i.e. the
// model wants a shorter price — which is the direction a backer cares about.
//
// Two staking conventions are reported side by side because they answer
// different questions:
//   * level      — flat GBP 1 per bet. What a punter actually does; every bet
//                  counts equally.
//   * to-win-1   — stake 1/(isp-1) to win GBP 1. The repo-wide convention
//                  (industry-sp-dao.ts:660-666), kept so figures reconcile with
//                  the Model Accuracy screen. It stakes ~2 on an evens shot and
//                  ~0.05 on a 21.0 shot, so its ROI is dominated by favourites.
//
// Usage:
//   npx ts-node scripts/model-market-disagreement-2026-08-01.ts

import config from "config";
import { MongoClient } from "mongodb";

const PROB_FIELD = "modelWinProbabilityOos";

// Ratio boundaries. Deliberately tighter around 1.0 (where most runners sit)
// than out in the tails.
const RATIO_BOUNDARIES = [0, 0.5, 0.7, 0.85, 0.95, 1.05, 1.2, 1.4, 1.8, 1e9];
const RATIO_LABELS = [
  "model 2x+ longer",
  "model 1.4-2x longer",
  "model 15-30% longer",
  "model 5-15% longer",
  "agree (+/-5%)",
  "model 5-20% shorter",
  "model 20-40% shorter",
  "model 40-80% shorter",
  "model 1.8x+ shorter",
];

// Model price bands, same boundaries as the Model Accuracy screen.
const BAND_BOUNDARIES = [0, 5, 10, 20, 100 / 3, 50, 100.0001];
const BAND_LABELS: Record<string, string> = {
  "0": "20.0+",
  "5": "10.0-20.0",
  "10": "5.0-10.0",
  "20": "3.0-5.0",
  "33.33333333333333": "2.0-3.0",
  "50": "under 2.0",
};

interface Row {
  _id: unknown;
  runners: number;
  wins: number;
  modelProbSum: number;
  marketProbSum: number;
  levelStaked: number;
  levelReturns: number;
  winStaked: number;
  winReturns: number;
  modelSqErrSum: number;
  marketSqErrSum: number;
}

/** Stages from raw race docs down to one scalar doc per scored runner. */
function runnerStages(): Record<string, unknown>[] {
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
    // isp > 1 is the repo-wide eligibility gate; $ne: null (query form, which
    // also excludes a MISSING field) drops runners the walk-forward run could
    // not score. Both gates matter — see model-accuracy-dao.ts:245-256.
    { $match: { "runners.isp": { $gt: 1 }, [`runners.${PROB_FIELD}`]: { $ne: null } } },
    {
      $project: {
        _id: 0,
        year: { $substr: ["$raceTime", 0, 4] },
        modelProb: `$runners.${PROB_FIELD}`,
        isp: "$runners.isp",
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
      $match: { marketProbFair: { $gt: 0 } },
    },
    {
      $addFields: { ratio: { $divide: ["$modelProb", "$marketProbFair"] } },
    },
  ];
}

/** The per-group accumulators, shared by every breakdown below. */
function accumulators(): Record<string, unknown> {
  return {
    runners: { $sum: 1 },
    wins: { $sum: "$isWin" },
    modelProbSum: { $sum: "$modelProb" },
    marketProbSum: { $sum: "$marketProbFair" },
    // Level stakes: 1 per bet, returns isp on a winner.
    levelStaked: { $sum: 1 },
    levelReturns: { $sum: { $cond: [{ $eq: ["$isWin", 1] }, "$isp", 0] } },
    // To-win-1: stake 1/(isp-1), returns stake + 1 on a winner.
    winStaked: { $sum: { $divide: [1, { $subtract: ["$isp", 1] }] } },
    winReturns: {
      $sum: {
        $cond: [
          { $eq: ["$isWin", 1] },
          { $add: [{ $divide: [1, { $subtract: ["$isp", 1] }] }, 1] },
          0,
        ],
      },
    },
    modelSqErrSum: {
      $sum: { $pow: [{ $subtract: [{ $divide: ["$modelProb", 100] }, "$isWin"] }, 2] },
    },
    marketSqErrSum: {
      $sum: { $pow: [{ $subtract: [{ $divide: ["$marketProbFair", 100] }, "$isWin"] }, 2] },
    },
  };
}

const pct = (n: number, d: number) => (d > 0 ? (100 * n) / d : 0);
const f = (n: number, w: number, dp = 1) => n.toFixed(dp).padStart(w);

function printTable(title: string, rows: Row[], label: (id: unknown) => string): void {
  console.log(`\n${title}`);
  console.log(
    "  " +
      "bucket".padEnd(22) +
      "runners".padStart(9) +
      "strike".padStart(8) +
      "model".padStart(8) +
      "market".padStart(8) +
      "  |" +
      "level P&L".padStart(11) +
      "lvl ROI".padStart(9) +
      "  |" +
      "win P&L".padStart(10) +
      "win ROI".padStart(9)
  );
  console.log("  " + "-".repeat(104));
  for (const r of rows) {
    if (r.runners === 0) continue;
    const levelPnl = r.levelReturns - r.levelStaked;
    const winPnl = r.winReturns - r.winStaked;
    console.log(
      "  " +
        label(r._id).padEnd(22) +
        r.runners.toLocaleString().padStart(9) +
        f(pct(r.wins, r.runners), 8) +
        // modelProbSum is already in 0-100 units, so the mean is just the
        // sum over the count — no further scaling.
        f(r.modelProbSum / r.runners, 8) +
        f(r.marketProbSum / r.runners, 8) +
        "  |" +
        f(levelPnl, 11) +
        f(pct(levelPnl, r.levelStaked), 8) +
        "%" +
        "  |" +
        f(winPnl, 10) +
        f(pct(winPnl, r.winStaked), 8) +
        "%"
    );
  }
}

async function main(): Promise<void> {
  const client = new MongoClient(config.get<string>("mongodb.uri"));
  await client.connect();
  const db = client.db(config.get<string>("mongodb.dbName"));
  const col = db.collection("industry_starting_prices");

  console.log("=".repeat(106));
  console.log("MODEL vs MARKET DISAGREEMENT — walk-forward scores only, staked at industry SP");
  console.log("=".repeat(106));

  // ---- 1. Overall baseline + ratio buckets -------------------------------
  const overall = (await col
    .aggregate<Row>([...runnerStages(), { $group: { _id: null, ...accumulators() } }], {
      allowDiskUse: true,
    })
    .toArray())[0];

  printTable("BASELINE — every scored runner backed blind", [overall], () => "all runners");

  const byRatio = await col
    .aggregate<Row>(
      [
        ...runnerStages(),
        {
          $bucket: {
            groupBy: "$ratio",
            boundaries: RATIO_BOUNDARIES,
            default: "other",
            output: accumulators(),
          },
        },
        { $sort: { _id: 1 } },
      ],
      { allowDiskUse: true }
    )
    .toArray();

  const ratioLabel = (id: unknown) => {
    const i = RATIO_BOUNDARIES.indexOf(Number(id));
    return i >= 0 && i < RATIO_LABELS.length ? RATIO_LABELS[i] : String(id);
  };
  printTable("BY DISAGREEMENT — model price vs market price", byRatio, ratioLabel);

  // ---- 2. Disagreement x model price band --------------------------------
  for (const band of [50, 100 / 3, 20, 10, 5, 0]) {
    const idx = BAND_BOUNDARIES.indexOf(band);
    const upper = idx >= 0 && idx + 1 < BAND_BOUNDARIES.length ? BAND_BOUNDARIES[idx + 1] : 100.0001;
    const rows = await col
      .aggregate<Row>(
        [
          ...runnerStages(),
          { $match: { modelProb: { $gte: band, $lt: upper } } },
          {
            $bucket: {
              groupBy: "$ratio",
              boundaries: RATIO_BOUNDARIES,
              default: "other",
              output: accumulators(),
            },
          },
          { $sort: { _id: 1 } },
        ],
        { allowDiskUse: true }
      )
      .toArray();
    printTable(
      `MODEL PRICE BAND ${BAND_LABELS[String(band)] ?? band} — by disagreement`,
      rows,
      ratioLabel
    );
  }

  // ---- 3. Year-by-year stability for the strong-disagreement subset ------
  const byYear = await col
    .aggregate<Row>(
      [
        ...runnerStages(),
        { $match: { ratio: { $gte: 1.2 } } },
        { $group: { _id: "$year", ...accumulators() } },
        { $sort: { _id: 1 } },
      ],
      { allowDiskUse: true }
    )
    .toArray();
  printTable("STABILITY — 'model 20%+ shorter' subset, by year", byYear, (id) => String(id));

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
