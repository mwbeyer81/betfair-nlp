/**
 * Brier score for a set of horses.
 *
 * The Brier score is the mean squared error of a probability forecast against
 * the 0/1 outcome it was forecasting: `mean((p - y)^2)`, where `p` is the
 * forecast win probability (0-1) and `y` is 1 for a winner and 0 for everything
 * else. Lower is better; 0 is perfect. It is a *proper* scoring rule, which is
 * the whole reason it earns a place next to P&L on the filter screens — unlike
 * ROI over a few hundred races, it cannot be gamed by being confidently wrong
 * on longshots, and it converges far faster, because every runner contributes
 * rather than just the winners.
 *
 * Two scores are reported together, over exactly the same runners:
 *
 * - `model` — the XGBoost win probability (`runners.modelWinProbability`).
 * - `market` — the probability the runner's starting price implies, normalised
 *   by the race's own book sum so it is comparable to a model column that
 *   ml/train_and_predict.py's `normalize_within_race()` has already forced to
 *   sum to 100. A real SP book sums to ~115-125%, so scoring the market on raw
 *   `100/isp` would hand the model a win it did not earn. Same convention as
 *   `model-accuracy-service.ts`'s `marketBrier`, deliberately — two screens
 *   showing "the Brier score" must be reading the same number off the same
 *   runners.
 *
 * The model score alone is close to meaningless in isolation (a Brier of 0.08
 * is excellent over an 8-runner field and terrible over a two-horse match), so
 * every surface that shows one shows the market's beside it. The question a
 * filter screen can actually answer is "is the model better calibrated than the
 * market *on these horses*", and that is the gap between the two, not either
 * one's absolute value.
 *
 * ## What these numbers are NOT
 *
 * Two caveats, both real, neither fixable here:
 *
 * 1. **The population is selected.** On a filtered set the runners are chosen —
 *    often on the model's own output (the "model beats SP" / "min model win %"
 *    filters). A Brier score over a model-selected subset is a conditional
 *    score, not a calibration certificate for the model as a whole. It is still
 *    exactly the right number for "on the horses this filter picks, who is
 *    closer to the truth", which is what a filter screen asks.
 *
 * 2. **This scores `modelWinProbability`, which is not out-of-sample.** That is
 *    the field ml/train_and_predict.py writes, and it is the field the filters
 *    themselves select on — so scoring anything else would describe a different
 *    forecast from the one the user filtered by, and the Brier would no longer
 *    be about the horses on screen. But it means that over years the model was
 *    trained on, the model's score here is optimistic. `/model-accuracy` scores
 *    `modelWinProbabilityOos` instead (ml/walk_forward_score.py: every race
 *    scored by a model fitted only on races that finished before it), which is
 *    the honest number for "is the model actually any good" — and the two
 *    therefore will NOT agree, by design. See MODEL_ACCURACY_PROB_FIELD in
 *    model-accuracy-dao.ts.
 *
 *    The one place on these screens where the caveat does not apply is a saved
 *    result's Live Performance rollup: those races were captured after the
 *    filter was saved, so nothing there was in any training set.
 */

/**
 * Raw accumulators, as the aggregations emit them — summable across races,
 * which is the only correct way to combine them (see `sumBrierSums`).
 *
 * Two denominators rather than one because the Betfair-SP screen
 * (`/api/runners`) has no model column at all: there, `scored` is 0 and only
 * the market score is defined. On every industry-SP surface the aggregation
 * restricts BOTH sums to the same model-scored runners, so `scored === priced`
 * and the pair is directly comparable.
 */
export interface BrierSums {
  /** Runners carrying a model probability — the denominator of `model`. */
  scored: number;
  /** Runners carrying a usable price — the denominator of `market`. */
  priced: number;
  modelSqErrSum: number;
  marketSqErrSum: number;
}

export interface BrierStats {
  /**
   * How many of the filtered runners the model score is over. Always <= the
   * qualifying runner count `pnlStats.count` reports: runners the model never
   * scored (the CSV-imported historical years predate the ML pipeline) carry no
   * probability and are excluded, rather than folded in as a 0% forecast the
   * model would then be blamed for getting wrong.
   */
  scored: number;
  /** How many the market score is over. */
  priced: number;
  /** Mean squared error of the model's win probability; null if nothing scored. */
  model: number | null;
  /** The same for the SP-implied (overround-normalised) probability. */
  market: number | null;
}

export const EMPTY_BRIER_SUMS: BrierSums = { scored: 0, priced: 0, modelSqErrSum: 0, marketSqErrSum: 0 };

export const EMPTY_BRIER: BrierStats = { scored: 0, priced: 0, model: null, market: null };

// 6dp matches model-accuracy-service.ts's own rounding. Brier scores over a
// racing field live around 0.05-0.12, so the interesting digits are in the 3rd
// and 4th decimal place — rounding any harder here would flatten real
// differences between the model and the market before the UI ever sees them.
function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/**
 * Turns raw squared-error sums into the pair of scores a screen renders.
 *
 * `null` (not 0) when nothing was scored: a filter matching no model-scored
 * runner is an ordinary state — every pre-ML year of the dataset is like that —
 * and 0 is the *best possible* Brier score, so defaulting to it would render a
 * flawless forecast where there is in fact no forecast at all.
 */
export function brierFromSums(sums: Partial<BrierSums> | null | undefined): BrierStats {
  const scored = sums?.scored ?? 0;
  const priced = sums?.priced ?? 0;
  return {
    scored,
    priced,
    model: scored > 0 ? round6((sums?.modelSqErrSum ?? 0) / scored) : null,
    market: priced > 0 ? round6((sums?.marketSqErrSum ?? 0) / priced) : null,
  };
}

/**
 * Adds per-race sums up before scoring them.
 *
 * Needed wherever a total is assembled from parts (the saved-result Live
 * Performance rollup stores one document per race and sums them on the client):
 * a Brier score is a mean, so averaging per-race means would weight a 4-runner
 * race the same as a 16-runner one. Sums first, divide once.
 */
export function sumBrierSums(parts: (Partial<BrierSums> | null | undefined)[]): BrierSums {
  return parts.reduce<BrierSums>(
    (acc, p) => ({
      scored: acc.scored + (p?.scored ?? 0),
      priced: acc.priced + (p?.priced ?? 0),
      modelSqErrSum: acc.modelSqErrSum + (p?.modelSqErrSum ?? 0),
      marketSqErrSum: acc.marketSqErrSum + (p?.marketSqErrSum ?? 0),
    }),
    { ...EMPTY_BRIER_SUMS }
  );
}
