import { BrierStats, BrierSums } from "../services/chatApi";

/**
 * Formatting and roll-up helpers for the Brier scores shown on every filter
 * surface. The arithmetic that produces them lives on the backend
 * (src/lib/service/brier.ts) — this module only formats, compares, and (for the
 * one surface that receives per-race parts rather than a finished score) sums.
 */

// 4dp, not the 6 the API sends. Brier scores over a racing field sit around
// 0.05-0.12 and a model beating the market does so by ~0.001-0.01, so the 4th
// decimal is the last one that carries a real signal; the 5th and 6th are there
// for the arithmetic, not for a human reading a card.
export function formatBrier(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(4);
}

/**
 * How far the model's Brier sits below the market's — positive means the model
 * is BETTER (its squared error is smaller). Sign is flipped from the raw
 * subtraction deliberately: everywhere else in this app a positive number
 * coloured green means good news, and a "improvement of -0.0031" would be a
 * trap for anyone reading quickly.
 *
 * null unless both scores exist, since the whole comparison is meaningless
 * otherwise.
 */
export function brierEdge(brier: BrierStats | null | undefined): number | null {
  if (brier?.model == null || brier?.market == null) return null;
  return brier.market - brier.model;
}

export function formatBrierEdge(edge: number | null): string {
  if (edge == null) return "—";
  // 4dp with an explicit sign: the difference is often in the third or fourth
  // decimal, and without the sign a reader has to compare two numbers to work
  // out which way it went.
  return `${edge >= 0 ? "+" : "−"}${Math.abs(edge).toFixed(4)}`;
}

/** True when there is a model score to show at all. */
export function hasModelBrier(brier: BrierStats | null | undefined): boolean {
  return brier != null && brier.model != null && brier.scored > 0;
}

/**
 * A one-line plain-English verdict, used as the accessibility label and as the
 * caption under the numbers. Deliberately hedged on a small sample: a Brier
 * gap over a few dozen runners is noise, and the screens this appears on make
 * it very easy to filter down to a handful of horses.
 */
export function brierVerdict(brier: BrierStats | null | undefined): string {
  if (!hasModelBrier(brier)) return "No model-scored runners in this selection.";
  const edge = brierEdge(brier);
  if (edge == null) return `Model Brier ${formatBrier(brier?.model)} (no market score to compare).`;
  const scored = brier?.scored ?? 0;
  const direction = edge > 0 ? "better calibrated than" : edge < 0 ? "worse calibrated than" : "level with";
  const sample = scored < MIN_MEANINGFUL_SAMPLE ? ` — only ${scored} runners, treat as noise` : "";
  return `Model ${formatBrier(brier?.model)} vs SP ${formatBrier(brier?.market)}: model is ${direction} the market on these ${scored} runners${sample}.`;
}

// Below this, the gap between two Brier scores is dominated by which horses
// happened to win rather than by either forecast's quality. Not a significance
// test — just the point where the UI stops presenting the comparison as a
// result and starts flagging it as a small sample. Chosen to match the order of
// magnitude at which this app's own convergence graph stops being volatile
// (see PnlConvergencePanel: ROI% settles over hundreds of races, not tens).
export const MIN_MEANINGFUL_SAMPLE = 200;

export function isSmallBrierSample(brier: BrierStats | null | undefined): boolean {
  return hasModelBrier(brier) && (brier?.scored ?? 0) < MIN_MEANINGFUL_SAMPLE;
}

/**
 * Rolls per-race squared-error sums up into one score.
 *
 * Sums first, divides once — averaging per-race Brier scores would weight a
 * 5-runner race the same as a 16-runner one. Mirrors `brierFromSums` +
 * `sumBrierSums` in src/lib/service/brier.ts; duplicated rather than shared
 * because this repo has no code path between src/ and client/src/, and the
 * unit test pins both to the same hand-derived numbers.
 */
export function brierFromParts(parts: (BrierSums | null | undefined)[]): BrierStats {
  let scored = 0;
  let priced = 0;
  let modelSqErrSum = 0;
  let marketSqErrSum = 0;
  for (const p of parts) {
    if (!p) continue;
    scored += p.scored ?? 0;
    priced += p.priced ?? 0;
    modelSqErrSum += p.modelSqErrSum ?? 0;
    marketSqErrSum += p.marketSqErrSum ?? 0;
  }
  const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
  return {
    scored,
    priced,
    // null, not 0 — 0 is the best possible Brier score, so defaulting to it
    // would render a flawless forecast where none was ever made.
    model: scored > 0 ? round6(modelSqErrSum / scored) : null,
    market: priced > 0 ? round6(marketSqErrSum / priced) : null,
  };
}

/**
 * Combines two already-scored sets into one — used where the client holds
 * finished scores rather than raw sums (a saved result stores one per split,
 * and the list card wants the pair as a single figure).
 *
 * Reconstructs each side's squared-error total as `score x denominator`, adds
 * those, and divides by the combined denominator. That is the correct weighted
 * combination, and it is exact apart from the 6dp the scores were rounded to
 * when they were stored — which is four orders of magnitude below the 4dp this
 * app displays, so it cannot move a rendered digit.
 *
 * Prefer `brierFromParts` wherever the raw sums are actually available; this
 * exists only for the case where they are not.
 */
export function combineBrierStats(
  a: BrierStats | null | undefined,
  b: BrierStats | null | undefined
): BrierStats | undefined {
  // Neither side present at all — a result saved before Brier scores existed.
  // undefined (not a zeroed object) so the caller renders "no score", not one.
  if (a == null && b == null) return undefined;
  const parts: BrierSums[] = [a, b].filter((x): x is BrierStats => x != null).map(x => ({
    scored: x.scored,
    priced: x.priced,
    modelSqErrSum: (x.model ?? 0) * x.scored,
    marketSqErrSum: (x.market ?? 0) * x.priced,
  }));
  return brierFromParts(parts);
}
