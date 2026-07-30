/* eslint-disable no-console */
// Read-only prod verification for IndustrySpDAO.getModelVsSpRunners, backing the
// new Model vs SP screen (/model-vs-sp).
//
// Three things this proves against real production data, none of which the
// throwaway-fixture integration test can:
//
//   1. COUNT RECONCILIATION — the count pipeline ($size of a $filter, summed per
//      race) agrees exactly with an independently-shaped naive count ($unwind,
//      then match the flattened runner conditions). Two differently-written
//      pipelines agreeing is the strongest correctness signal short of a full
//      reimplementation, and it's the same discipline the pnlStats.count vs
//      totalRunners regression in industry-sp-dao.ts was caught by.
//
//   2. PAGE-WALK INTEGRITY — walking every page of a real result set yields
//      exactly `total` rows with no duplicate and no omission, and the sort key
//      stays monotonic across page boundaries. This is what the edge sort's
//      (edge, raceTime, runnerId) tiebreak exists for; without a total order,
//      rows that tie on edge can swap between page queries.
//
//   3. THE BLOCKING-SORT CEILING — the edge sort has no index able to serve it
//      (its key is arithmetic over two fields of an array subdocument) and Atlas
//      M0 silently ignores allowDiskUse, so it is bounded only by the router's
//      366-day span clamp. This times that sort at widening windows and prints
//      the error verbatim if one blows the 32MB limit (error 292), so the clamp
//      is set from evidence rather than arithmetic.
//
// Direct-to-DAO rather than over HTTP: /api/model-vs-sp is auth-gated and there
// is no production login here — same reasoning as
// verify-isp-year-walk-fix-2026-07-28.ts.
//
// Run: NODE_CONFIG_DIR=./config npx ts-node scripts/verify-model-vs-sp-pagination-2026-07-30.ts
import { MongoClient } from "mongodb";
import config from "config";
import { IndustrySpDAO, ModelVsSpParams, ModelVsSpSort } from "../src/lib/dao/industry-sp-dao";

function params(overrides: Partial<ModelVsSpParams> = {}): ModelVsSpParams {
  return {
    page: 1,
    limit: 100,
    sort: "date_desc",
    minRaceTime: "2024-01-01",
    maxRaceTime: "2024-01-31T23:59:59.999",
    minModelProb: 0,
    maxModelProb: 100,
    minImpliedProb: 0,
    maxImpliedProb: 100,
    minAbsEdge: 0,
    maxAbsEdge: 100,
    minIsp: 1,
    maxIsp: 1000,
    minRunners: 1,
    maxRunners: 100,
    countries: [],
    includeTotal: true,
    ...overrides,
  };
}

async function main() {
  const uri = config.get<string>("mongodb.uri");
  const dbName = config.get<string>("mongodb.dbName");
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);
  const dao = new IndustrySpDAO(db);
  const collection = db.collection("industry_starting_prices");

  console.log(`db=${dbName}`);
  console.log("");

  // ---- 1. Count reconciliation ----
  console.log("=== 1. count reconciliation (DAO total vs an independent naive $unwind count) ===");
  const scenarios: { label: string; p: Partial<ModelVsSpParams> }[] = [
    { label: "jan-2024, unfiltered", p: {} },
    {
      label: "jan-2024, gap of 10-20 pts either way",
      p: { minAbsEdge: 10, maxAbsEdge: 20 },
    },
    {
      label: "jan-2024, gap under 5 pts (model close to market)",
      p: { maxAbsEdge: 5 },
    },
    {
      label: "jan-2024, model 20-60% and implied <= 30%",
      p: { minModelProb: 20, maxModelProb: 60, maxImpliedProb: 30 },
    },
  ];

  let mismatches = 0;
  for (const scenario of scenarios) {
    const p = params(scenario.p);
    const started = Date.now();
    const { total } = await dao.getModelVsSpRunners({ ...p, limit: 1 });
    const daoMs = Date.now() - started;

    // Deliberately a different shape: flatten first, then match on the
    // already-flattened runner fields, with no $size/$filter anywhere. If the two
    // ever disagree, one of them is wrong.
    const naiveStarted = Date.now();
    const [naive] = await collection
      .aggregate<{ n: number }>(
        [
          { $match: { raceTime: { $gte: p.minRaceTime, $lte: p.maxRaceTime } } },
          { $unwind: "$runners" },
          {
            $match: {
              "runners.isp": { $ne: null, $gt: 1, $gte: p.minIsp, $lte: p.maxIsp },
              "runners.modelWinProbability": { $ne: null, $gte: p.minModelProb, $lte: p.maxModelProb },
            },
          },
          {
            $addFields: {
              _implied: { $divide: [100, "$runners.isp"] },
            },
          },
          {
            $addFields: {
              // Independently shaped on purpose: $abs applied AFTER the
              // subtraction here, where the DAO folds it into one expression.
              _absEdge: { $abs: { $subtract: ["$runners.modelWinProbability", "$_implied"] } },
            },
          },
          {
            $match: {
              _implied: { $gte: p.minImpliedProb, $lte: p.maxImpliedProb },
              _absEdge: { $gte: p.minAbsEdge, $lte: p.maxAbsEdge },
            },
          },
          { $count: "n" },
        ],
        { allowDiskUse: true }
      )
      .toArray();
    const naiveCount = naive?.n ?? 0;
    const naiveMs = Date.now() - naiveStarted;

    const ok = total === naiveCount;
    if (!ok) mismatches++;
    console.log(
      `${ok ? "OK  " : "FAIL"} ${scenario.label}: dao_total=${total} naive_count=${naiveCount} ` +
        `(dao ${daoMs}ms, naive ${naiveMs}ms)`
    );
  }
  console.log(`count_reconciliation_mismatches=${mismatches}`);
  console.log("");

  // ---- 2. Page-walk integrity ----
  console.log("=== 2. page-walk integrity (every page, no duplicates, monotonic sort key) ===");
  for (const sort of ["date_desc", "edge_desc"] as ModelVsSpSort[]) {
    const limit = 100;
    const base = params({ sort, limit });
    const { total } = await dao.getModelVsSpRunners({ ...base, limit: 1 });
    if (total == null || total === 0) {
      console.log(`${sort}: no rows in window, skipping`);
      continue;
    }
    const pages = Math.ceil(total / limit);
    const seen = new Set<string>();
    let walked = 0;
    let monotonic = true;
    let previousKey: number | string | null = null;
    let slowestPageMs = 0;

    for (let page = 1; page <= pages; page++) {
      const started = Date.now();
      const { rows } = await dao.getModelVsSpRunners({ ...base, page, includeTotal: false });
      slowestPageMs = Math.max(slowestPageMs, Date.now() - started);
      for (const row of rows) {
        seen.add(`${row.raceId}-${row.runnerId}`);
        walked++;
        const key = sort === "edge_desc" ? row.edge : row.raceTime;
        if (previousKey !== null) {
          const ordered = sort === "edge_desc" ? (key as number) <= (previousKey as number) : key <= previousKey;
          if (!ordered) monotonic = false;
        }
        previousKey = key;
      }
    }

    const duplicates = walked - seen.size;
    console.log(
      `${sort}: total=${total} pages=${pages} walked=${walked} unique=${seen.size} ` +
        `duplicates=${duplicates} monotonic=${monotonic} slowest_page=${slowestPageMs}ms ` +
        `${walked === total && duplicates === 0 && monotonic ? "OK" : "FAIL"}`
    );
  }
  console.log("");

  // ---- 3. The blocking-sort ceiling ----
  console.log("=== 3. edge-sort ceiling at widening windows (the 366-day clamp's evidence) ===");
  const windows: { label: string; min: string; max: string }[] = [
    { label: "1 month ", min: "2024-01-01", max: "2024-01-31T23:59:59.999" },
    { label: "3 months", min: "2024-01-01", max: "2024-03-31T23:59:59.999" },
    { label: "6 months", min: "2024-01-01", max: "2024-06-30T23:59:59.999" },
    { label: "12 months (the clamp)", min: "2024-01-01", max: "2024-12-31T23:59:59.999" },
    { label: "24 months (OVER the clamp — should not be reachable via the API)", min: "2023-01-01", max: "2024-12-31T23:59:59.999" },
    { label: "whole dataset (WAY over the clamp)", min: "2015-01-01", max: "2026-12-31T23:59:59.999" },
  ];

  for (const w of windows) {
    const started = Date.now();
    try {
      const { rows, total } = await dao.getModelVsSpRunners(
        params({ sort: "edge_desc", minRaceTime: w.min, maxRaceTime: w.max, limit: 50 })
      );
      console.log(
        `OK   ${w.label}: total=${total} first_page=${rows.length} top_edge=${rows[0]?.edge?.toFixed(2) ?? "n/a"} ` +
          `(${Date.now() - started}ms)`
      );
    } catch (err) {
      const e = err as { code?: number; codeName?: string; message?: string };
      console.log(
        `FAIL ${w.label}: code=${e.code} codeName=${e.codeName} message=${e.message} (${Date.now() - started}ms)`
      );
    }
  }
  console.log("");

  // ---- 4. What includeTotal=false actually saves ----
  console.log("=== 4. includeTotal saving ===");
  {
    const p = params({ sort: "edge_desc", minRaceTime: "2024-01-01", maxRaceTime: "2024-12-31T23:59:59.999", limit: 50 });
    const withStart = Date.now();
    await dao.getModelVsSpRunners({ ...p, includeTotal: true });
    const withMs = Date.now() - withStart;
    const withoutStart = Date.now();
    await dao.getModelVsSpRunners({ ...p, includeTotal: false });
    const withoutMs = Date.now() - withoutStart;
    console.log(`with_total=${withMs}ms without_total=${withoutMs}ms saved=${withMs - withoutMs}ms`);
  }

  // ---- 5. Summary self-consistency ----
  console.log("");
  console.log("=== 5. distribution summary (bands must tile the population exactly) ===");
  for (const scenario of [
    { label: "jan-2024, no difference filter", p: {} as Partial<ModelVsSpParams> },
    { label: "jan-2024, gap 10-20 pts", p: { minAbsEdge: 10, maxAbsEdge: 20 } as Partial<ModelVsSpParams> },
  ]) {
    const { summary, total } = await dao.getModelVsSpRunners(params({ ...scenario.p, limit: 1 }));
    if (!summary) {
      console.log(`FAIL ${scenario.label}: no summary returned`);
      continue;
    }
    const banded = summary.bands.reduce((sum, b) => sum + b.count, 0);
    const tiles = banded === summary.allRunners;
    const matchesTotal = summary.matchedRunners === total;
    // The final cumulative share before the open-ended tail, plus that tail's own
    // share, must account for everyone.
    const lastCumulative = summary.bands[summary.bands.length - 2]?.cumulativePercent ?? 0;
    const tailPercent = summary.bands[summary.bands.length - 1].percent;
    const accounted = Math.abs(lastCumulative + tailPercent - 100) < 0.5;

    console.log(
      `${tiles && matchesTotal && accounted ? "OK  " : "FAIL"} ${scenario.label}: ` +
        `allRunners=${summary.allRunners} banded=${banded} matched=${summary.matchedRunners} total=${total} ` +
        `matchedPercent=${summary.matchedPercent} meanAbsEdge=${summary.meanAbsEdge}`
    );
    for (const b of summary.bands) {
      console.log(
        `       ${b.label.padEnd(18)} count=${String(b.count).padStart(7)} ` +
          `share=${String(b.percent).padStart(5)}% cumulative=${b.cumulativePercent ?? "-"}`
      );
    }
  }

  await client.close();
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
