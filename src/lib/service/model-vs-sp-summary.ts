// The "how close is the model to the market, overall?" summary shown above the
// Model vs SP list. Kept separate from the DAO because the banding is a pure
// function of counts — the aggregation only ever emits raw per-band tallies, and
// every percentage, cumulative total and label is derived here, where it can be
// unit-tested without a database.

import { BrierStats, BrierSums, brierFromSums } from "./brier";

// Cut points for |model% - implied SP%|, in percentage points. Chosen from the
// real distribution rather than round numbers for their own sake: production
// measures a mean absolute gap of 5.28 points (see
// scripts/prod-repro-model-vs-sp-coverage-2026-07-30.ts), so the interesting
// detail is all in the first few points and the tail is long and thin. The final
// band is open-ended.
export const EDGE_BAND_BOUNDS = [2, 5, 10, 20, 50] as const;

export interface EdgeBand {
  // Inclusive lower bound of |edge| for this band, in percentage points.
  minAbs: number;
  // Exclusive upper bound, or null for the open-ended final band.
  maxAbs: number | null;
  // "within ±2 pts", "±20 to ±50 pts", "beyond ±50 pts"
  label: string;
  count: number;
  // Share of allRunners in this band alone, 0-100, rounded to 1dp.
  percent: number;
  // Share of allRunners in this band OR any narrower one — the number that
  // answers "what proportion of runners is the model within ±10 points of?".
  // null on the open-ended final band, where it would always be 100.
  cumulativePercent: number | null;
}

export interface ModelVsSpSummary {
  // Every runner matching the current filters EXCEPT the difference range —
  // deliberately the denominator, so the bands describe the whole population
  // being looked at rather than shifting as the difference filter narrows.
  allRunners: number;
  // Those also inside the current difference range.
  matchedRunners: number;
  // matchedRunners as a share of allRunners, 0-100, 1dp. 0 when there are none.
  matchedPercent: number;
  // Mean |edge| across allRunners, in percentage points, 1dp.
  meanAbsEdge: number;
  bands: EdgeBand[];
  // Brier score of the model and of the market, over the MATCHED runners —
  // the rows the screen is actually listing, not the wider `allRunners`
  // denominator the bands describe. Deliberately so: the bands answer "how
  // far apart are model and market across the population", while this answers
  // "on the runners this difference range selects, which of the two is closer
  // to what happened". A large mean edge with a model Brier *above* the
  // market's is the signature of a filter that has found disagreement rather
  // than an edge.
  brier: BrierStats;
}

// Raw tallies as the aggregation emits them: one count per band, in
// EDGE_BAND_BOUNDS order, plus the open-ended final band.
export interface RawEdgeBandCounts {
  allRunners: number;
  matchedRunners: number;
  sumAbsEdge: number;
  // Length must be EDGE_BAND_BOUNDS.length + 1.
  bandCounts: number[];
  brierSums?: Partial<BrierSums> | null;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function bandLabel(minAbs: number, maxAbs: number | null): string {
  if (maxAbs == null) return `beyond ±${minAbs} pts`;
  if (minAbs === 0) return `within ±${maxAbs} pts`;
  return `±${minAbs} to ±${maxAbs} pts`;
}

/**
 * Turns raw per-band tallies into the summary the screen renders.
 *
 * Guards a division by zero throughout: a filter combination matching nothing is
 * an ordinary state here (the screen shows the summary before the user has
 * narrowed anything), not an error, so every percentage falls back to 0 rather
 * than NaN — which would otherwise render as "NaN%" in the UI.
 */
export function buildEdgeSummary(raw: RawEdgeBandCounts): ModelVsSpSummary {
  const expectedBands = EDGE_BAND_BOUNDS.length + 1;
  const counts =
    raw.bandCounts.length === expectedBands
      ? raw.bandCounts
      : // Defensive: a shape mismatch means the aggregation and this module have
        // drifted. Pad/truncate rather than throwing, so a summary bug can never
        // take down the list itself.
        Array.from({ length: expectedBands }, (_, i) => raw.bandCounts[i] ?? 0);

  const all = raw.allRunners;
  const pct = (n: number) => (all > 0 ? round1((n / all) * 100) : 0);

  let running = 0;
  const bands: EdgeBand[] = counts.map((count, i) => {
    const minAbs = i === 0 ? 0 : EDGE_BAND_BOUNDS[i - 1];
    const maxAbs = i < EDGE_BAND_BOUNDS.length ? EDGE_BAND_BOUNDS[i] : null;
    running += count;
    return {
      minAbs,
      maxAbs,
      label: bandLabel(minAbs, maxAbs),
      count,
      percent: pct(count),
      cumulativePercent: maxAbs == null ? null : pct(running),
    };
  });

  return {
    allRunners: all,
    matchedRunners: raw.matchedRunners,
    matchedPercent: pct(raw.matchedRunners),
    meanAbsEdge: all > 0 ? round1(raw.sumAbsEdge / all) : 0,
    bands,
    brier: brierFromSums(raw.brierSums),
  };
}
