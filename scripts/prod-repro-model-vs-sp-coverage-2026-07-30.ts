/* eslint-disable no-console */
// Read-only prod sanity check for the new Model vs SP screen (/model-vs-sp).
//
// Two questions this answers before the screen ships:
//
//   1. Does the screen have data at all, and over what date range? Its rows
//      require BOTH modelWinProbability and a real isp on the same runner, and
//      modelWinProbability is absent on every CSV-imported historical runner
//      (only ml/train_and_predict.py and the RacingAPI results-capture path set
//      it). So the ~11-year isp date range is NOT the model-scored date range,
//      and the screen's year/month pills must be bounded by the latter or most
//      of them can only ever return 0 rows. The measured coverage_min_race_time
//      below is what MODEL_COVERAGE_MIN_DATE in ModelVsSpScreen.tsx is set from.
//
//   2. Is a +/-5 point model-vs-SP gap actually meaningful, or a rounding
//      artefact? The edge distribution answers what the filter's defaults and
//      the user's mental model should be.
//
// Direct-to-DAO/collection rather than over HTTP: /api/model-vs-sp is auth-gated
// (registered below router.use(jwtAuth)) and there's no production login here —
// the same reasoning as verify-isp-year-walk-fix-2026-07-28.ts.
//
// Deliberately ONE QUERY PER CALENDAR YEAR, never a single unbounded $unwind
// over the whole collection: that's ~1M runner documents and the anti-pattern
// getFilterBounds' comment in industry-sp-dao.ts documents.
//
// Run: NODE_CONFIG_DIR=./config npx ts-node scripts/prod-repro-model-vs-sp-coverage-2026-07-30.ts
import { MongoClient } from "mongodb";
import config from "config";

const FIRST_YEAR = 2015;
const LAST_YEAR = 2026;

// 5-point buckets from -60 to +60, plus overflow on each end.
const BUCKET_BOUNDARIES: number[] = [];
for (let b = -60; b <= 60; b += 5) BUCKET_BOUNDARIES.push(b);

async function main() {
  const uri = config.get<string>("mongodb.uri");
  const dbName = config.get<string>("mongodb.dbName");
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);
  const collection = db.collection("industry_starting_prices");

  console.log(`db=${dbName} collection=industry_starting_prices`);
  console.log("");

  // ---- Per-year coverage, computed with per-document $size/$filter only ----
  console.log("=== per-year coverage (races and runners) ===");
  console.log("year races_total races_with_scored_runner runners_isp_gt1 runners_with_model runners_with_both");

  let grandRaces = 0;
  let grandRacesScored = 0;
  let grandIsp = 0;
  let grandModel = 0;
  let grandBoth = 0;

  for (let year = FIRST_YEAR; year <= LAST_YEAR; year++) {
    const started = Date.now();
    const ispCond = { $and: [{ $ifNull: ["$$r.isp", false] }, { $gt: ["$$r.isp", 1] }] };
    const modelCond = { $ne: ["$$r.modelWinProbability", null] };

    const [row] = await collection
      .aggregate<{
        races: number;
        racesScored: number;
        runnersIsp: number;
        runnersModel: number;
        runnersBoth: number;
      }>(
        [
          { $match: { raceTime: { $gte: `${year}-01-01`, $lte: `${year}-12-31T23:59:59.999` } } },
          {
            $addFields: {
              _isp: { $size: { $filter: { input: "$runners", as: "r", cond: ispCond } } },
              _model: { $size: { $filter: { input: "$runners", as: "r", cond: modelCond } } },
              _both: {
                $size: { $filter: { input: "$runners", as: "r", cond: { $and: [ispCond, modelCond] } } },
              },
            },
          },
          {
            $group: {
              _id: null,
              races: { $sum: 1 },
              racesScored: { $sum: { $cond: [{ $gt: ["$_both", 0] }, 1, 0] } },
              runnersIsp: { $sum: "$_isp" },
              runnersModel: { $sum: "$_model" },
              runnersBoth: { $sum: "$_both" },
            },
          },
        ],
        { allowDiskUse: true }
      )
      .toArray();

    const r = row ?? { races: 0, racesScored: 0, runnersIsp: 0, runnersModel: 0, runnersBoth: 0 };
    grandRaces += r.races;
    grandRacesScored += r.racesScored;
    grandIsp += r.runnersIsp;
    grandModel += r.runnersModel;
    grandBoth += r.runnersBoth;

    console.log(
      `${year} ${r.races} ${r.racesScored} ${r.runnersIsp} ${r.runnersModel} ${r.runnersBoth}` +
        `   (${Date.now() - started}ms)`
    );
  }

  console.log("");
  console.log(`races_total=${grandRaces}`);
  console.log(`races_with_any_scored_runner=${grandRacesScored}`);
  console.log(`runners_with_isp_gt1=${grandIsp}`);
  console.log(`runners_with_model_prob=${grandModel}`);
  console.log(`runners_with_both=${grandBoth}  <-- the population of the Model vs SP screen`);
  console.log("");

  // ---- The coverage window: what bounds the year/month pills ----
  console.log("=== model-score coverage window ===");
  {
    const started = Date.now();
    const scoredRaceMatch = {
      $expr: {
        $gt: [
          {
            $size: {
              $filter: {
                input: "$runners",
                as: "r",
                cond: {
                  $and: [
                    { $ifNull: ["$$r.isp", false] },
                    { $gt: ["$$r.isp", 1] },
                    { $ne: ["$$r.modelWinProbability", null] },
                  ],
                },
              },
            },
          },
          0,
        ],
      },
    };
    const [minDoc] = await collection
      .find(scoredRaceMatch, { projection: { raceTime: 1 } })
      .sort({ raceTime: 1 })
      .limit(1)
      .toArray();
    const [maxDoc] = await collection
      .find(scoredRaceMatch, { projection: { raceTime: 1 } })
      .sort({ raceTime: -1 })
      .limit(1)
      .toArray();

    console.log(`coverage_min_race_time=${minDoc?.raceTime ?? "NONE"}`);
    console.log(`coverage_max_race_time=${maxDoc?.raceTime ?? "NONE"}`);
    console.log(`MODEL_COVERAGE_MIN_DATE should be ${(minDoc?.raceTime ?? "").slice(0, 10) || "NONE"}`);
    console.log(`(${Date.now() - started}ms)`);
  }
  console.log("");

  // ---- Edge distribution, one year at a time ----
  console.log("=== edge distribution (model% - 100/isp), per year then overall ===");
  const overall = new Map<string, number>();
  let overallSum = 0;
  let overallAbsSum = 0;
  let overallCount = 0;
  let gt0 = 0;
  let eq0 = 0;
  let lt0 = 0;

  for (let year = FIRST_YEAR; year <= LAST_YEAR; year++) {
    const started = Date.now();
    const rows = await collection
      .aggregate<{ _id: string; n: number; sum: number; absSum: number }>(
        [
          { $match: { raceTime: { $gte: `${year}-01-01`, $lte: `${year}-12-31T23:59:59.999` } } },
          {
            $project: {
              edges: {
                $map: {
                  input: {
                    $filter: {
                      input: "$runners",
                      as: "r",
                      cond: {
                        $and: [
                          { $ifNull: ["$$r.isp", false] },
                          { $gt: ["$$r.isp", 1] },
                          { $ne: ["$$r.modelWinProbability", null] },
                        ],
                      },
                    },
                  },
                  as: "r",
                  in: { $subtract: ["$$r.modelWinProbability", { $divide: [100, "$$r.isp"] }] },
                },
              },
            },
          },
          { $unwind: "$edges" },
          {
            $group: {
              _id: {
                $concat: [
                  {
                    $toString: {
                      $multiply: [5, { $floor: { $divide: [{ $min: [{ $max: ["$edges", -60] }, 60] }, 5] } }],
                    },
                  },
                  "",
                ],
              },
              n: { $sum: 1 },
              sum: { $sum: "$edges" },
              absSum: { $sum: { $abs: "$edges" } },
            },
          },
        ],
        { allowDiskUse: true }
      )
      .toArray();

    let yearCount = 0;
    for (const r of rows) {
      overall.set(r._id, (overall.get(r._id) ?? 0) + r.n);
      overallSum += r.sum;
      overallAbsSum += r.absSum;
      yearCount += r.n;
    }
    overallCount += yearCount;
    if (yearCount > 0) console.log(`${year} scored_runners=${yearCount} (${Date.now() - started}ms)`);
  }

  console.log("");
  console.log("bucket_lower_bound count");
  for (const b of BUCKET_BOUNDARIES) {
    const n = overall.get(String(b)) ?? 0;
    if (n > 0) console.log(`${b >= 0 ? "+" : ""}${b} ${n}`);
  }

  // Sign split, in its own cheap pass per year (the bucket key can't
  // distinguish "exactly 0" from "0 to +5").
  for (let year = FIRST_YEAR; year <= LAST_YEAR; year++) {
    const [row] = await collection
      .aggregate<{ gt: number; eq: number; lt: number }>(
        [
          { $match: { raceTime: { $gte: `${year}-01-01`, $lte: `${year}-12-31T23:59:59.999` } } },
          {
            $project: {
              edges: {
                $map: {
                  input: {
                    $filter: {
                      input: "$runners",
                      as: "r",
                      cond: {
                        $and: [
                          { $ifNull: ["$$r.isp", false] },
                          { $gt: ["$$r.isp", 1] },
                          { $ne: ["$$r.modelWinProbability", null] },
                        ],
                      },
                    },
                  },
                  as: "r",
                  in: { $subtract: ["$$r.modelWinProbability", { $divide: [100, "$$r.isp"] }] },
                },
              },
            },
          },
          { $unwind: "$edges" },
          {
            $group: {
              _id: null,
              gt: { $sum: { $cond: [{ $gt: ["$edges", 0] }, 1, 0] } },
              eq: { $sum: { $cond: [{ $eq: ["$edges", 0] }, 1, 0] } },
              lt: { $sum: { $cond: [{ $lt: ["$edges", 0] }, 1, 0] } },
            },
          },
        ],
        { allowDiskUse: true }
      )
      .toArray();
    gt0 += row?.gt ?? 0;
    eq0 += row?.eq ?? 0;
    lt0 += row?.lt ?? 0;
  }

  console.log("");
  console.log(`edge_gt_0=${gt0}`);
  console.log(`edge_eq_0=${eq0}`);
  console.log(`edge_lt_0=${lt0}`);
  if (overallCount > 0) {
    console.log(`mean_edge=${(overallSum / overallCount).toFixed(3)}`);
    console.log(`mean_abs_edge=${(overallAbsSum / overallCount).toFixed(3)}`);
  }
  console.log("");

  // ---- Which training runs are represented ----
  console.log("=== model versions present ===");
  const versions = await collection
    .aggregate<{ _id: string | null; n: number }>(
      [
        { $unwind: "$runners" },
        { $match: { "runners.modelVersionId": { $ne: null } } },
        { $group: { _id: "$runners.modelVersionId", n: { $sum: 1 } } },
        { $sort: { n: -1 } },
      ],
      { allowDiskUse: true }
    )
    .toArray();
  for (const v of versions) console.log(`modelVersionId=${v._id} runners=${v.n}`);
  if (versions.length === 0) console.log("(none — no runner carries a modelVersionId)");

  await client.close();
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
