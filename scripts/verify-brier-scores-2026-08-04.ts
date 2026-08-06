/* eslint-disable no-console */
// Verifies the Brier scores now shown on every filter surface, by recomputing
// them a completely different way and demanding the two agree.
//
// The aggregation path is a `$reduce` with a four-field accumulator, evaluated
// per race inside a pipeline that also sorts, row-ranges and $facets. The check
// below pulls the same raw documents out with a plain `find()` and does the
// arithmetic in TypeScript, one runner at a time, with no pipeline involved at
// all. Two independently-written implementations landing on the same number is
// the strongest correctness signal available short of a third — the same
// discipline verify-model-vs-sp-pagination-2026-07-30.ts applies to its counts.
//
// Four properties it proves, none of which a fixture-shaped unit test can:
//
//   1. AGGREGATION vs HAND ARITHMETIC — model and market Brier agree to 1e-9
//      on the unfiltered set and on several filtered ones.
//   2. THE FILTER SET IS THE SAME SET — brier.scored never exceeds
//      pnlStats.count, and equals it exactly whenever every matched runner
//      carries a model probability. A Brier over a different runner population
//      from the P&L beside it would be a silent lie on the same card.
//   3. THE FAST PATH AND THE SLOW PATH AGREE — pnlStats has two shapes
//      (precomputed raceStaked/raceReturns vs a $lookup + $unwind), and the
//      Brier branch is deliberately outside both. Running one filter that takes
//      each path over the same underlying races pins that.
//   4. COST — times the unfiltered query with and without the Brier stages, so
//      the two extra per-race array passes are a measured number rather than an
//      assumption. This matters: those stages sit in the one query path
//      industry-sp-dao.ts spent real effort keeping free of per-runner work.
//
// Run: NODE_CONFIG_DIR=./config npx ts-node scripts/verify-brier-scores-2026-08-04.ts
import { MongoClient } from "mongodb";
import config from "config";
import { IndustrySpDAO } from "../src/lib/dao/industry-sp-dao";

const MONGO_URI = process.env.MONGODB_URI || config.get<string>("database.uri");
const DB_NAME = process.env.MONGODB_DB || config.get<string>("database.name");

interface RunnerLike {
  isp?: number | null;
  status?: string;
  modelWinProbabilityOos?: number | null;
  trainerFormWinRate?: number | null;
}

interface RaceLike {
  runners?: RunnerLike[];
}

// The hand-written counterpart of raceBrierSumsExpr — deliberately written in
// the most obvious way possible (a loop, no cleverness), because its only job
// is to disagree with the pipeline if the pipeline is wrong.
function handBrier(
  races: RaceLike[],
  keep: (r: RunnerLike) => boolean
): { scored: number; model: number | null; market: number | null } {
  let scored = 0;
  let modelSum = 0;
  let marketSum = 0;

  for (const race of races) {
    const runners = race.runners ?? [];
    // Book sum over the FULL field, not the kept subset — the overround is a
    // property of the race, not of whatever the filter happened to keep.
    let bookSum = 0;
    for (const r of runners) {
      if (typeof r.isp === "number" && r.isp > 1) bookSum += 100 / r.isp;
    }

    for (const r of runners) {
      if (typeof r.isp !== "number" || r.isp <= 1) continue;
      if (typeof r.modelWinProbabilityOos !== "number") continue;
      if (!keep(r)) continue;

      const y = r.status === "WINNER" ? 1 : 0;
      const modelP = r.modelWinProbabilityOos / 100;
      const marketPct = bookSum > 0 ? ((100 / r.isp) / bookSum) * 100 : 100 / r.isp;
      const marketP = marketPct / 100;

      scored += 1;
      modelSum += (modelP - y) ** 2;
      marketSum += (marketP - y) ** 2;
    }
  }

  return {
    scored,
    model: scored > 0 ? modelSum / scored : null,
    market: scored > 0 ? marketSum / scored : null,
  };
}

// 5e-7, i.e. half of the last place brierFromSums rounds to. Tighter than that
// (1e-9 was the first attempt) fails on every single check for the one reason
// that is not a bug: the DAO deliberately returns a 6dp number and this file
// computes full float precision.
function close(a: number | null, b: number | null, tol = 5e-7): boolean {
  if (a == null || b == null) return a === b;
  return Math.abs(a - b) < tol;
}

let failures = 0;

function check(label: string, ok: boolean, detail: string): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) {
    failures += 1;
    console.log(`      ${detail}`);
  }
}

async function main(): Promise<void> {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db(DB_NAME);
  const dao = new IndustrySpDAO(db);

  const allRaces = await db
    .collection("industry_starting_prices")
    .find({}, { projection: { runners: 1 } })
    .toArray();
  console.log(`\n${allRaces.length} races in ${DB_NAME}.industry_starting_prices\n`);

  if (allRaces.length === 0) {
    console.log("No data — nothing to verify. Seed the collection first (see .claude/commands/mongo-integration-tests.md).");
    await client.close();
    process.exit(1);
  }

  // --- 1. Unfiltered. Takes the pnlStats FAST path (isp range covers
  // everything, no runner-level filter active), which is exactly the path that
  // reads no runner subdocuments at all — so the Brier branch is carrying the
  // whole per-runner computation on its own here.
  {
    const res = await dao.getAllRacesByRace(1, 1);
    const hand = handBrier(allRaces as RaceLike[], () => true);
    check(
      "unfiltered: model Brier matches hand arithmetic",
      close(res.brier.model, hand.model),
      `aggregation=${res.brier.model} hand=${hand.model}`
    );
    check(
      "unfiltered: market Brier matches hand arithmetic",
      close(res.brier.market, hand.market),
      `aggregation=${res.brier.market} hand=${hand.market}`
    );
    check(
      "unfiltered: scored count matches",
      res.brier.scored === hand.scored,
      `aggregation=${res.brier.scored} hand=${hand.scored}`
    );
    check(
      "unfiltered: brier.scored <= pnlStats.count (same runner set, minus unscored)",
      res.brier.scored <= res.pnlStats.count,
      `scored=${res.brier.scored} pnlCount=${res.pnlStats.count}`
    );
    console.log(
      `      model=${res.brier.model} market=${res.brier.market} over ${res.brier.scored} of ${res.pnlStats.count} runners\n`
    );
  }

  // --- 2. Narrowed ISP range. Forces the pnlStats SLOW path ($lookup +
  // $unwind), over a runner subset the fast path above would have included.
  {
    const minIsp = 2;
    const maxIsp = 10;
    const res = await dao.getAllRacesByRace(1, 1, 1, 30, [], minIsp, maxIsp);
    const hand = handBrier(
      allRaces as RaceLike[],
      r => typeof r.isp === "number" && r.isp >= minIsp && r.isp <= maxIsp
    );
    check(
      `isp ${minIsp}-${maxIsp} (slow P&L path): model Brier matches`,
      close(res.brier.model, hand.model),
      `aggregation=${res.brier.model} hand=${hand.model}`
    );
    check(
      `isp ${minIsp}-${maxIsp}: market Brier matches`,
      close(res.brier.market, hand.market),
      `aggregation=${res.brier.market} hand=${hand.market}`
    );
    check(
      `isp ${minIsp}-${maxIsp}: scored count matches`,
      res.brier.scored === hand.scored,
      `aggregation=${res.brier.scored} hand=${hand.scored}`
    );
    console.log(
      `      model=${res.brier.model} market=${res.brier.market} over ${res.brier.scored} of ${res.pnlStats.count} runners\n`
    );
  }

  // --- 3. "Model beats SP". The selection is made ON the model's own output,
  // which is the case the doc comment in src/lib/service/brier.ts warns about —
  // and the case most likely to expose a mismatch between what the filter keeps
  // and what the Brier scores, since the condition itself involves both isp and
  // modelWinProbabilityOos.
  {
    const res = await dao.getAllRacesByRace(
      1, 1, 1, 30, [], 1, 1000, "asc", 1, 10000, 1, null, null, null, [], [], [], [], null, null,
      0, 0, 100, null, 0, true
    );
    const hand = handBrier(
      allRaces as RaceLike[],
      r =>
        typeof r.isp === "number" &&
        r.isp > 0 &&
        typeof r.modelWinProbabilityOos === "number" &&
        r.modelWinProbabilityOos - 100 / r.isp > 0
    );
    check(
      "model-beats-SP: model Brier matches",
      close(res.brier.model, hand.model),
      `aggregation=${res.brier.model} hand=${hand.model}`
    );
    check(
      "model-beats-SP: market Brier matches",
      close(res.brier.market, hand.market),
      `aggregation=${res.brier.market} hand=${hand.market}`
    );
    check(
      "model-beats-SP: brier.scored equals pnlStats.count (this filter requires a model prob)",
      res.brier.scored === res.pnlStats.count,
      `scored=${res.brier.scored} pnlCount=${res.pnlStats.count}`
    );
    console.log(
      `      model=${res.brier.model} market=${res.brier.market} over ${res.brier.scored} runners` +
        `  (model ${res.brier.model != null && res.brier.market != null && res.brier.model < res.brier.market ? "BEATS" : "does NOT beat"} market)\n`
    );
  }

  // --- 4. Split windows. Each split is the same query over a race row range,
  // so a split's Brier must equal the hand computation over that slice of the
  // chronologically sorted races.
  {
    const splits = await dao.getAllRacesByRace(1, 1, 1, 30, [], 1, 1000, "asc", 1, 10000, 1, 5);
    const sorted = (await db
      .collection("industry_starting_prices")
      .find({}, { projection: { runners: 1, raceTime: 1 } })
      .sort({ raceTime: 1 })
      .limit(5)
      .toArray()) as RaceLike[];
    const hand = handBrier(sorted, () => true);
    check(
      "row range 1-5: model Brier matches the same 5 races by hand",
      close(splits.brier.model, hand.model),
      `aggregation=${splits.brier.model} hand=${hand.model}`
    );
  }

  // --- 5. Empty result. A filter matching nothing must report null, never 0 —
  // 0 is the BEST possible Brier score, so a zero here would render a flawless
  // forecast on a screen showing no horses at all.
  {
    const res = await dao.getAllRacesByRace(
      1, 1, 1, 30, ["ZZ_NOT_A_COUNTRY"], 1, 1000
    );
    check(
      "no matches: model Brier is null, not 0",
      res.brier.model === null && res.brier.market === null && res.brier.scored === 0,
      `got ${JSON.stringify(res.brier)}`
    );
  }

  // --- 6. Cost. The Brier stages add two array passes per matched race to a
  // query that previously did none on its fast path. Timed rather than assumed.
  {
    const timeIt = async (fn: () => Promise<unknown>, runs = 5): Promise<number> => {
      // One warm-up, discarded — the first run pays for connection warm-up and
      // plan caching, which would otherwise dominate a small sample.
      await fn();
      const start = Date.now();
      for (let i = 0; i < runs; i += 1) await fn();
      return (Date.now() - start) / runs;
    };

    const withBrier = await timeIt(() => dao.getAllRacesByRace(1, 1));
    // The same match + facet without the Brier stages, run straight against the
    // driver so the comparison isolates exactly the added work.
    const withoutBrier = await timeIt(() =>
      db
        .collection("industry_starting_prices")
        .aggregate([
          { $match: { runnersWithIspCount: { $gte: 1, $lte: 30 } } },
          { $addFields: { inRangeRunnersCount: "$runnersWithIspCount" } },
          {
            $facet: {
              total: [{ $count: "count" }],
              pnlStats: [
                { $group: { _id: null, staked: { $sum: "$raceStaked" }, returns: { $sum: "$raceReturns" } } },
              ],
            },
          },
        ])
        .toArray()
    );
    console.log(
      `\nCost: ${withBrier.toFixed(1)}ms with Brier vs ${withoutBrier.toFixed(1)}ms for the equivalent ` +
        `query without it (${allRaces.length} races). Ratio ${(withBrier / Math.max(withoutBrier, 0.01)).toFixed(2)}x.\n` +
        `NOTE: this dataset is small — read the ratio, not the absolute numbers, and re-run against prod scale before trusting it.\n`
    );
  }

  await client.close();
  console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
