#!/usr/bin/env ts-node

// MANUAL ANALYSIS SCRIPT — not run by any automated suite.
//
// READ-ONLY: one streaming find() over `industry_starting_prices`, plus two
// estimatedDocumentCount() calls and one lookup in `model_evaluations`.
// No writes anywhere.
//
// THE QUESTION: how good is the win-probability model, judged against the
// starting price? `compare-model-accuracy-oos-2026-07-31.ts` already answered
// the headline — out-of-sample the market's Brier beats the model's. This
// script answers *why*, and establishes whether the gap is real and stable:
//
//   1. headline Brier + Brier Skill Score vs SP, on matched rows
//   2. Murphy decomposition (reliability / resolution / uncertainty) —
//      splits the gap into a calibration part and a discrimination part
//   3. paired significance, clustered by race (one winner per race means
//      runners within a race are NOT independent)
//   4. per-year stability
//   5. by model-probability band AND by SP band (banding on the model
//      conditions on the thing under judgement, so both views are shown)
//   6. by field size (Brier falls mechanically as fields grow)
//   7. de-vig sensitivity: proportional vs power/odds-ratio de-overrounding
//
// WHICH FIELD: `modelWinProbabilityOos` (walk-forward, honest) is the subject.
// `modelWinProbability` is in-sample — ml/train_and_predict.py refits on all
// rows including the ones it then scores — and appears here only to re-measure
// how much that flatters the model.
//
// UNITS TRAP: both model fields are stored 0-100, not 0-1. This has caused a
// 100x display bug before. Everything below converts once, at read time.
//
// Usage:
//   MONGODB_URI=<atlas uri> MONGODB_DB_NAME=betfair_nlp \
//     NODE_CONFIG_DIR=./config npx ts-node scripts/model-vs-sp-brier-2026-08-04.ts

import config from "config";
import { MongoClient } from "mongodb";

const COLLECTION = "industry_starting_prices";
const PROB_FIELD = "modelWinProbabilityOos";
const IN_SAMPLE_FIELD = "modelWinProbability";

// Equal-COUNT bins for the Murphy decomposition, not equal-width.
//
// Both forecasters put most of their mass below 0.2 (the base rate is 11%), so
// equal-width bins are far too coarse where the data actually lives — the
// leftover within-bin variance then swamps reliability, which is only ~1e-4.
// Going finer everywhere is not the fix either: each bin's observed rate is a
// sample mean, so its noise inflates reliability by roughly (bins/N)*p(1-p),
// and at 1000 equal-width bins that bias is larger than the quantity being
// measured. Equal-count bins put narrow bins where the mass is and wide bins
// in the tail, which keeps both errors small at once.
const DECOMP_BINS = 100;

// Same six boundaries the Model Accuracy screen and
// compare-model-accuracy-oos-2026-07-31.ts use, so the per-band table here
// lines up with the one already in AGENTS.md.
const MODEL_BANDS: Array<[string, number, number]> = [
  ["under 2.0", 50, 100.0001],
  ["2.0 - 3.0", 100 / 3, 50],
  ["3.0 - 5.0", 20, 100 / 3],
  ["5.0 - 10.0", 10, 20],
  ["10.0 - 20.0", 5, 10],
  ["20.0+", 0, 5],
];

// The same six ranges expressed as SP prices, so the rows are directly
// comparable to the model-band table above.
const SP_BANDS: Array<[string, number, number]> = [
  ["under 2.0", 0, 2],
  ["2.0 - 3.0", 2, 3],
  ["3.0 - 5.0", 3, 5],
  ["5.0 - 10.0", 5, 10],
  ["10.0 - 20.0", 10, 20],
  ["20.0+", 20, Infinity],
];

const FIELD_SIZE_BUCKETS: Array<[string, number, number]> = [
  ["2 - 6", 2, 7],
  ["7 - 9", 7, 10],
  ["10 - 13", 10, 14],
  ["14 - 19", 14, 20],
  ["20+", 20, Infinity],
];

interface RunnerDoc {
  id?: number;
  isp?: number | null;
  status?: string;
  modelWinProbabilityOos?: number | null;
  modelWinProbability?: number | null;
}

interface RaceDoc {
  raceId?: number;
  raceDate?: string;
  runners?: RunnerDoc[];
}

/** Brier accumulators for the model and the market over one slice of rows. */
interface Cell {
  n: number;
  wins: number;
  mSumP: number;
  mSumSq: number;
  kSumP: number;
  kSumSq: number;
}

const newCell = (): Cell => ({ n: 0, wins: 0, mSumP: 0, mSumSq: 0, kSumP: 0, kSumSq: 0 });

function addToCell(cell: Cell, pModel: number, pMarket: number, y: number): void {
  cell.n += 1;
  cell.wins += y;
  cell.mSumP += pModel;
  cell.mSumSq += (pModel - y) ** 2;
  cell.kSumP += pMarket;
  cell.kSumSq += (pMarket - y) ** 2;
}

function cellOf<K>(map: Map<K, Cell>, key: K): Cell {
  let cell = map.get(key);
  if (!cell) {
    cell = newCell();
    map.set(key, cell);
  }
  return cell;
}

/**
 * Murphy's decomposition: Brier = reliability - resolution + uncertainty.
 *
 * reliability  how far each bin's mean forecast sits from that bin's observed
 *              win rate — pure calibration error, lower is better
 * resolution   how far each bin's observed rate sits from the overall base
 *              rate — the forecaster's ability to separate winners from
 *              losers, HIGHER is better
 * uncertainty  the base rate's own variance; identical for both forecasters,
 *              so it is the part neither can do anything about
 *
 * THE IDENTITY IS NOT EXACT ON RAW FORECASTS. It is exact for the BINNED
 * forecast (every row replaced by its bin's mean), and the difference —
 * returned here as `withinBin` — is the discrimination the binning discarded.
 * Reporting it is the honest move: an assertion that the identity holds on raw
 * forecasts would simply be false, and silently choosing a bin count that
 * makes the residual small would hide the same fact.
 *
 * `reliabilityDebiased` / `resolutionDebiased` subtract the sampling noise in
 * each bin's observed rate, which inflates both terms by ~(1/N)*sum_k p(1-p).
 * The two biases cancel in the identity, so only the split between calibration
 * and discrimination is affected — but that split is the whole point here.
 *
 * Bins are built over the SORTED scores, never splitting equal scores across a
 * boundary: the model's stored values are rounded to 2dp so ties are common,
 * and splitting a tie group creates two bins with the same mean forecast but
 * different observed rates, which is pure noise charged to reliability.
 */
function decompose(scores: number[], labels: Uint8Array, baseRate: number, nBins: number) {
  const n = scores.length;
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => scores[a] - scores[b]);
  const target = n / nBins;

  let reliability = 0;
  let resolution = 0;
  let noise = 0;
  let brierBinned = 0;
  let bins = 0;

  let start = 0;
  while (start < n) {
    let end = Math.min(n, start + Math.max(1, Math.round(target)));
    while (end < n && scores[order[end]] === scores[order[end - 1]]) end++;
    const size = end - start;

    let sumP = 0;
    let wins = 0;
    for (let i = start; i < end; i++) {
      sumP += scores[order[i]];
      wins += labels[order[i]];
    }
    const meanP = sumP / size;
    const observed = wins / size;

    reliability += size * (meanP - observed) ** 2;
    resolution += size * (observed - baseRate) ** 2;
    brierBinned += size * ((meanP - 1) ** 2 * observed + meanP ** 2 * (1 - observed));
    if (size > 1) noise += (observed * (1 - observed) * size) / (size - 1);
    bins++;
    start = end;
  }

  reliability /= n;
  resolution /= n;
  noise /= n;
  brierBinned /= n;

  let brierDirect = 0;
  for (let i = 0; i < n; i++) brierDirect += (scores[i] - labels[i]) ** 2;
  brierDirect /= n;

  return {
    bins,
    reliability,
    resolution,
    reliabilityDebiased: reliability - noise,
    resolutionDebiased: resolution - noise,
    uncertainty: baseRate * (1 - baseRate),
    brierFromBins: reliability - resolution + baseRate * (1 - baseRate),
    brierBinnedDirect: brierBinned,
    withinBin: brierDirect - brierBinned,
  };
}

/**
 * Power ("odds-ratio") de-overrounding: find k with sum(implied_i ^ k) = 1.
 *
 * The proportional method used everywhere else in this repo divides every
 * runner's raw implied probability by the book sum, which removes the same
 * FRACTION of margin from a 1/2 shot and a 100/1 shot. Real books do not load
 * margin that way — the longshot carries more of it — so proportional
 * de-vigging leaves longshot probabilities too high and favourite
 * probabilities too low. If the market beats the model under both methods, the
 * result is not an artefact of that choice.
 *
 * Returns null when the book has no overround to remove (nothing to solve).
 */
function powerDevigExponent(implied: number[]): number | null {
  const sum = implied.reduce((a, b) => a + b, 0);
  if (!(sum > 1)) return null;
  const f = (k: number) => implied.reduce((a, p) => a + Math.pow(p, k), 0) - 1;
  let lo = 1;
  let hi = 12;
  if (f(hi) > 0) return null; // pathological book; caller falls back
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * AUC by the Mann-Whitney rank-sum identity, with average ranks for ties.
 * Ties matter here: many runners share an SP, so a naive rank would inflate
 * the market's number relative to the model's.
 */
function aucRoc(scores: number[], labels: Uint8Array): number | null {
  const n = scores.length;
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => scores[a] - scores[b]);
  let rankSumPos = 0;
  let nPos = 0;
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && scores[order[j + 1]] === scores[order[i]]) j++;
    const avgRank = (i + j) / 2 + 1; // 1-based
    for (let t = i; t <= j; t++) {
      if (labels[order[t]] === 1) {
        rankSumPos += avgRank;
        nPos++;
      }
    }
    i = j + 1;
  }
  const nNeg = n - nPos;
  if (nPos === 0 || nNeg === 0) return null;
  return (rankSumPos - (nPos * (nPos + 1)) / 2) / (nPos * nNeg);
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const b4 = (x: number) => x.toFixed(6);

function bandOf(bands: Array<[string, number, number]>, value: number): string {
  for (const [label, lo, hi] of bands) {
    if (value >= lo && value < hi) return label;
  }
  return "unbanded";
}

function skill(modelBrier: number, marketBrier: number): number {
  return marketBrier > 0 ? 1 - modelBrier / marketBrier : NaN;
}

function printCellTable(title: string, rows: Array<[string, Cell]>): void {
  console.log(`\n${title}`);
  console.log("  band            |        n | model says |  actual | market says | model Brier | market Brier |    BSS");
  console.log("  " + "-".repeat(104));
  for (const [label, c] of rows) {
    if (c.n === 0) continue;
    const modelBrier = c.mSumSq / c.n;
    const marketBrier = c.kSumSq / c.n;
    console.log(
      `  ${label.padEnd(15)} | ${String(c.n).padStart(8)} | ${pct(c.mSumP / c.n).padStart(10)} | ` +
        `${pct(c.wins / c.n).padStart(7)} | ${pct(c.kSumP / c.n).padStart(11)} | ` +
        `${b4(modelBrier).padStart(11)} | ${b4(marketBrier).padStart(12)} | ` +
        `${skill(modelBrier, marketBrier).toFixed(4).padStart(7)}`
    );
  }
}

async function main(): Promise<void> {
  const uri = config.get<string>("mongodb.uri");
  const dbName = config.get<string>("mongodb.dbName");
  const client = new MongoClient(uri);
  await client.connect();

  try {
    const db = client.db(dbName);
    const collection = db.collection<RaceDoc>(COLLECTION);

    // Printed before anything else reads data: which database produced these
    // numbers should never have to be inferred afterwards.
    const redacted = uri.replace(/\/\/[^@]*@/, "//<redacted>@");
    console.log(`Target: ${redacted} db=${dbName} collection=${COLLECTION}`);
    console.log(`Races in collection: ${(await collection.estimatedDocumentCount()).toLocaleString()}`);

    // The BSP caveat in the write-up depends on this still being true, so it is
    // checked rather than repeated on trust from the 2026-08-01 entry.
    const marketDefs = await db.collection("market_definitions").estimatedDocumentCount();
    const priceUpdates = await db.collection("price_updates").estimatedDocumentCount();
    console.log(`market_definitions: ${marketDefs}   price_updates: ${priceUpdates}` +
      (marketDefs === 0 && priceUpdates === 0
        ? "   -> no Betfair BSP available; 'market' below is industry SP throughout"
        : "   -> BSP data now EXISTS; the ISP-only caveat needs revisiting"));

    const overall = newCell();
    const byYear = new Map<string, Cell>();
    const byModelBand = new Map<string, Cell>();
    const bySpBand = new Map<string, Cell>();
    const byFieldSize = new Map<string, Cell>();

    // Baselines and the sensitivity variant, each over its own row count
    // because each is defined on a slightly different subset.
    let inSampleN = 0;
    let inSampleSumSq = 0;
    let inSampleSumP = 0;
    let inSampleWins = 0;
    let powerN = 0;
    let powerSumSq = 0;
    let powerSumP = 0;
    let naiveSumSq = 0;

    // Paired per-runner Brier differences, d = model - market. Negative means
    // the model is closer. Accumulated per race as well, because exactly one
    // runner wins each race and the per-runner differences inside a race are
    // therefore strongly dependent.
    let sumD = 0;
    let sumD2 = 0;
    const raceD: number[] = [];
    const raceN: number[] = [];

    const modelScores: number[] = [];
    const marketScores: number[] = [];
    const labelList: number[] = [];

    // Row accounting — every runner dropped is dropped for exactly one stated
    // reason, so the matched count below is auditable rather than asserted.
    let racesSeen = 0;
    let racesUsed = 0;
    let droppedNoIsp = 0;
    let droppedNoModel = 0;
    let droppedNoBook = 0;
    let racesNoDate = 0;
    let powerFallbacks = 0;

    console.log("\nStreaming races (projection is 5 fields per runner)...");
    const cursor = collection.find(
      { [`runners.${PROB_FIELD}`]: { $ne: null } },
      {
        projection: {
          _id: 0,
          raceId: 1,
          raceDate: 1,
          "runners.id": 1,
          "runners.isp": 1,
          "runners.status": 1,
          [`runners.${PROB_FIELD}`]: 1,
          [`runners.${IN_SAMPLE_FIELD}`]: 1,
        },
      }
    );

    for await (const race of cursor) {
      racesSeen++;
      if (racesSeen % 20000 === 0) console.log(`  ...${racesSeen.toLocaleString()} races`);

      const runners = race.runners ?? [];

      // The book sum is taken over every runner with a usable SP, NOT only the
      // ones the model scored — that is what makes it the race's actual book,
      // and it is the same definition compare-model-accuracy-oos-2026-07-31.ts
      // and ml/market_benchmark.py use.
      const priced = runners.filter(r => typeof r.isp === "number" && (r.isp as number) > 1);
      const bookSum = priced.reduce((acc, r) => acc + 100 / (r.isp as number), 0);
      const fieldSize = priced.length;

      const implied = priced.map(r => 1 / (r.isp as number));
      const k = powerDevigExponent(implied);

      const year = typeof race.raceDate === "string" && race.raceDate.length >= 4
        ? race.raceDate.slice(0, 4)
        : null;
      if (year === null) racesNoDate++;

      let raceDiff = 0;
      let raceRows = 0;

      for (const runner of runners) {
        const modelPct = runner[PROB_FIELD];
        const isp = runner.isp;

        if (typeof isp !== "number" || isp <= 1) {
          droppedNoIsp++;
          continue;
        }
        if (typeof modelPct !== "number") {
          droppedNoModel++;
          continue;
        }
        if (!(bookSum > 0)) {
          droppedNoBook++;
          continue;
        }

        const y = runner.status === "WINNER" ? 1 : 0;
        const pModel = modelPct / 100;
        const pMarket = 100 / isp / bookSum; // proportional de-vig, as a fraction

        addToCell(overall, pModel, pMarket, y);
        if (year) addToCell(cellOf(byYear, year), pModel, pMarket, y);
        addToCell(cellOf(byModelBand, bandOf(MODEL_BANDS, modelPct)), pModel, pMarket, y);
        addToCell(cellOf(bySpBand, bandOf(SP_BANDS, isp)), pModel, pMarket, y);
        addToCell(cellOf(byFieldSize, bandOf(FIELD_SIZE_BUCKETS, fieldSize)), pModel, pMarket, y);

        const d = (pModel - y) ** 2 - (pMarket - y) ** 2;
        sumD += d;
        sumD2 += d * d;
        raceDiff += d;
        raceRows++;

        // Power de-vig on the same row, so the two market variants are always
        // compared over an identical population.
        const pPower = k === null ? pMarket : Math.pow(1 / isp, k);
        if (k === null) powerFallbacks++;
        powerN++;
        powerSumP += pPower;
        powerSumSq += (pPower - y) ** 2;

        if (fieldSize > 0) naiveSumSq += (1 / fieldSize - y) ** 2;

        const inSamplePct = runner[IN_SAMPLE_FIELD];
        if (typeof inSamplePct === "number") {
          inSampleN++;
          inSampleSumP += inSamplePct / 100;
          inSampleSumSq += (inSamplePct / 100 - y) ** 2;
          inSampleWins += y;
        }

        modelScores.push(pModel);
        marketScores.push(pMarket);
        labelList.push(y);
      }

      if (raceRows > 0) {
        racesUsed++;
        raceD.push(raceDiff);
        raceN.push(raceRows);
      }
    }

    const N = overall.n;
    if (N === 0) {
      console.error("\nNo matched rows. Is MONGODB_URI pointed at Atlas? The local CI fixtures carry no walk-forward scores.");
      process.exitCode = 1;
      return;
    }

    const baseRate = overall.wins / N;
    const modelBrier = overall.mSumSq / N;
    const marketBrier = overall.kSumSq / N;

    console.log("\n=== ROW ACCOUNTING ===");
    console.log(`  races streamed        ${racesSeen.toLocaleString()}`);
    console.log(`  races contributing    ${racesUsed.toLocaleString()}` + (racesNoDate ? `   (${racesNoDate} with no raceDate, excluded from the per-year table only)` : ""));
    console.log(`  MATCHED runner-rows   ${N.toLocaleString()}   (isp > 1, ${PROB_FIELD} present, book sum > 0)`);
    console.log(`  dropped: no usable SP ${droppedNoIsp.toLocaleString()}`);
    console.log(`  dropped: no OOS score ${droppedNoModel.toLocaleString()}`);
    console.log(`  dropped: empty book   ${droppedNoBook.toLocaleString()}`);
    console.log(`  base rate (win share) ${pct(baseRate)}`);

    console.log("\n=== HEADLINE (identical rows for both) ===");
    const labels = Uint8Array.from(labelList);
    const modelAuc = aucRoc(modelScores, labels);
    const marketAuc = aucRoc(marketScores, labels);
    console.log(`  model (out-of-sample)  Brier ${b4(modelBrier)}   AUC ${modelAuc?.toFixed(4)}   mean p ${pct(overall.mSumP / N)}`);
    console.log(`  market / SP (fair)     Brier ${b4(marketBrier)}   AUC ${marketAuc?.toFixed(4)}   mean p ${pct(overall.kSumP / N)}`);
    console.log(`  model (in-sample)      Brier ${b4(inSampleSumSq / inSampleN)}   over ${inSampleN.toLocaleString()} rows, mean p ${pct(inSampleSumP / inSampleN)}`);
    console.log(`  baseline: base rate    Brier ${b4(baseRate * (1 - baseRate))}   (predict ${pct(baseRate)} for everything)`);
    console.log(`  baseline: 1/fieldSize  Brier ${b4(naiveSumSq / N)}`);
    console.log(`\n  Brier Skill Score vs SP:  ${skill(modelBrier, marketBrier).toFixed(4)}   (negative = the model is worse than the price)`);
    console.log(`  Brier gap (model - SP):   ${(modelBrier - marketBrier).toFixed(6)}`);
    console.log(`  in-sample flattery:       ${(modelBrier - inSampleSumSq / inSampleN).toFixed(6)} of Brier`);
    console.log(`  skill vs base rate:       model ${skill(modelBrier, baseRate * (1 - baseRate)).toFixed(4)}   SP ${skill(marketBrier, baseRate * (1 - baseRate)).toFixed(4)}`);

    console.log("\n=== MURPHY DECOMPOSITION (Brier = reliability - resolution + uncertainty) ===");
    console.log("  lower reliability is better (calibration); HIGHER resolution is better (discrimination)");
    const mDec = decompose(modelScores, labels, baseRate, DECOMP_BINS);
    const kDec = decompose(marketScores, labels, baseRate, DECOMP_BINS);
    console.log(`  ${mDec.bins} equal-count bins for the model, ${kDec.bins} for the market\n`);
    console.log("                 | reliability | resolution | uncertainty | = binned Brier | + within-bin | = direct Brier");
    console.log("  " + "-".repeat(100));
    for (const [name, dec, direct] of [
      ["model", mDec, modelBrier],
      ["market / SP", kDec, marketBrier],
    ] as Array<[string, ReturnType<typeof decompose>, number]>) {
      console.log(
        `  ${name.padEnd(13)} | ${b4(dec.reliability).padStart(11)} | ${b4(dec.resolution).padStart(10)} | ` +
          `${b4(dec.uncertainty).padStart(11)} | ${b4(dec.brierFromBins).padStart(14)} | ` +
          `${b4(dec.withinBin).padStart(12)} | ${b4(direct).padStart(14)}`
      );
    }
    console.log("\n  debiased (bin-sampling noise removed from both terms):");
    console.log(`    model        reliability ${b4(mDec.reliabilityDebiased)}   resolution ${b4(mDec.resolutionDebiased)}`);
    console.log(`    market / SP  reliability ${b4(kDec.reliabilityDebiased)}   resolution ${b4(kDec.resolutionDebiased)}`);
    console.log(`\n  reliability gap (model - SP): ${(mDec.reliabilityDebiased - kDec.reliabilityDebiased).toFixed(6)}   <- calibration cost`);
    console.log(`  resolution gap  (SP - model): ${(kDec.resolutionDebiased - mDec.resolutionDebiased).toFixed(6)}   <- discrimination cost`);
    console.log(`  within-bin gap  (SP - model): ${(kDec.withinBin - mDec.withinBin).toFixed(6)}   <- finer-grained discrimination the binning discarded`);
    const totalGap = modelBrier - marketBrier;
    if (Math.abs(totalGap) > 1e-9) {
      console.log(`\n  share of the ${totalGap.toFixed(6)} Brier gap from calibration:    ${pct((mDec.reliabilityDebiased - kDec.reliabilityDebiased) / totalGap)}`);
      console.log(`  share of the ${totalGap.toFixed(6)} Brier gap from discrimination: ${pct(((kDec.resolutionDebiased - mDec.resolutionDebiased) + (kDec.withinBin - mDec.withinBin)) / totalGap)}`);
    }

    // Self-check: the identity is exact for the BINNED forecast, so this is
    // where an arithmetic error would show up. The raw-vs-binned difference is
    // reported above as `within-bin` rather than asserted away.
    let identityOk = true;
    for (const [name, dec] of [["model", mDec], ["market", kDec]] as Array<[string, ReturnType<typeof decompose>]>) {
      const err = Math.abs(dec.brierFromBins - dec.brierBinnedDirect);
      if (err > 1e-9) {
        console.error(`  DECOMPOSITION CHECK FAILED for ${name}: rel - res + unc = ${dec.brierFromBins}, but the binned forecast's Brier is ${dec.brierBinnedDirect} (error ${err})`);
        identityOk = false;
        process.exitCode = 1;
      }
    }
    if (identityOk) console.log("\n  decomposition identity holds for the binned forecast in both cases (error < 1e-9).");

    console.log("\n=== IS THE GAP REAL? paired per-runner Brier differences (model - market) ===");
    const meanD = sumD / N;
    const varD = sumD2 / N - meanD * meanD;
    const naiveSe = Math.sqrt(varD / N);
    let clusterVar = 0;
    for (let i = 0; i < raceD.length; i++) {
      clusterVar += (raceD[i] - raceN[i] * meanD) ** 2;
    }
    const clusterSe = Math.sqrt(clusterVar) / N;
    console.log(`  mean difference        ${meanD.toExponential(4)}   (positive = model worse)`);
    console.log(`  naive SE (per runner)  ${naiveSe.toExponential(4)}   z = ${(meanD / naiveSe).toFixed(1)}`);
    console.log(`  race-clustered SE      ${clusterSe.toExponential(4)}   z = ${(meanD / clusterSe).toFixed(1)}   <- the honest one`);
    console.log(`  95% CI (clustered)     [${(meanD - 1.96 * clusterSe).toExponential(4)}, ${(meanD + 1.96 * clusterSe).toExponential(4)}]`);
    console.log(`  clustered over ${raceD.length.toLocaleString()} races (one winner per race, so runners within a race are not independent)`);

    console.log("\n=== DE-VIG SENSITIVITY (does the market still win under a different de-vig?) ===");
    const powerBrier = powerSumSq / powerN;
    console.log(`  proportional de-vig    Brier ${b4(marketBrier)}   mean p ${pct(overall.kSumP / N)}`);
    console.log(`  power/odds-ratio       Brier ${b4(powerBrier)}   mean p ${pct(powerSumP / powerN)}` + (powerFallbacks ? `   (${powerFallbacks} rows fell back to proportional)` : ""));
    console.log(`  model                  Brier ${b4(modelBrier)}`);
    console.log(`  -> the market is ${modelBrier > Math.max(marketBrier, powerBrier) ? "MORE" : modelBrier < Math.min(marketBrier, powerBrier) ? "LESS" : "not consistently more"} accurate than the model under both de-vig methods.`);

    printCellTable("=== BY YEAR ===", [...byYear.entries()].sort((a, b) => a[0].localeCompare(b[0])));
    printCellTable("=== BY MODEL PROBABILITY BAND (conditions on the model's own view) ===",
      MODEL_BANDS.map(([label]) => [label, cellOf(byModelBand, label)] as [string, Cell]));
    printCellTable("=== BY SP BAND (independent of the model) ===",
      SP_BANDS.map(([label]) => [label, cellOf(bySpBand, label)] as [string, Cell]));
    printCellTable("=== BY FIELD SIZE (Brier falls mechanically as fields grow) ===",
      FIELD_SIZE_BUCKETS.map(([label]) => [label, cellOf(byFieldSize, label)] as [string, Cell]));

    // Cross-check against the number the Python pipeline stored. These were
    // produced independently — sklearn over a pandas frame there, a streaming
    // Node pass here — so agreement validates both.
    const stored = await db
      .collection("model_evaluations")
      .find({ evaluationType: "walk_forward" })
      .sort({ runAt: -1 })
      .limit(1)
      .toArray();
    if (stored.length > 0) {
      const s = stored[0] as Record<string, any>;
      console.log(`\n=== CROSS-CHECK vs stored walk-forward evaluation (${s.oosVersionId}, run ${s.runAt}) ===`);
      console.log(`  stored model Brier  ${s.overall?.raw?.brierScore}  over ${Number(s.overall?.raw?.n).toLocaleString()} rows   | here ${b4(modelBrier)} over ${N.toLocaleString()}   delta ${(modelBrier - (s.overall?.raw?.brierScore ?? NaN)).toExponential(3)}`);
      console.log(`  stored market Brier ${s.overall?.market?.brierScore}  over ${Number(s.overall?.market?.n).toLocaleString()} rows   | here ${b4(marketBrier)} over ${N.toLocaleString()}   delta ${(marketBrier - (s.overall?.market?.brierScore ?? NaN)).toExponential(3)}`);
      console.log(`  stored model AUC    ${s.overall?.raw?.aucRoc}   | here ${modelAuc?.toFixed(6)}`);
      console.log(`  stored market AUC   ${s.overall?.market?.aucRoc}   | here ${marketAuc?.toFixed(6)}`);
      console.log(`  NOTE: the stored run scored model and market on slightly different row counts (${s.overall?.raw?.n} vs ${s.overall?.market?.n});`);
      console.log(`        this script intersects first, so both are scored on the same ${N.toLocaleString()} rows.`);
    }

    // If the walk-forward write-back had silently copied the in-sample values,
    // the two fields would agree to the decimal everywhere.
    const inSampleMean = inSampleSumP / inSampleN;
    if (Math.abs(inSampleMean - overall.mSumP / N) < 1e-6 && Math.abs(inSampleSumSq / inSampleN - modelBrier) < 1e-6) {
      console.log("\nWARNING: the in-sample and out-of-sample fields are numerically identical — the walk-forward write-back did not do what it claims.");
    } else {
      console.log(`\nThe two model fields differ as they must (in-sample win rate on its rows ${pct(inSampleWins / inSampleN)}).`);
    }
  } finally {
    await client.close();
  }
}

main().catch(e => {
  console.error("analysis failed:", e);
  process.exit(1);
});
