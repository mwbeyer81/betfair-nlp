import { EMPTY_BRIER, brierFromSums, sumBrierSums } from "../brier";

describe("brierFromSums", () => {
  it("divides each squared-error sum by its own denominator", () => {
    // Two runners, hand-derived: a 40% forecast that won (0.6^2 = 0.36) and a
    // 40% forecast that lost (0.4^2 = 0.16). Mean = 0.26.
    expect(brierFromSums({ scored: 2, priced: 2, modelSqErrSum: 0.52, marketSqErrSum: 0.3 })).toEqual({
      scored: 2,
      priced: 2,
      model: 0.26,
      market: 0.15,
    });
  });

  it("rounds to 6dp, matching model-accuracy-service", () => {
    // 1/3 — a repeating decimal, so this pins the rounding rather than just
    // asserting a number that happened to be exact anyway.
    expect(brierFromSums({ scored: 3, priced: 3, modelSqErrSum: 1, marketSqErrSum: 1 }).model).toBe(0.333333);
  });

  it("reports null, NOT zero, when nothing was scored", () => {
    // The single most important case in this file. 0 is the BEST POSSIBLE
    // Brier score, so a filter matching no model-scored runner defaulting to 0
    // would render a flawless forecast on a screen showing no forecast at all.
    // Every pre-ML year of this dataset produces exactly this state.
    expect(brierFromSums({ scored: 0, priced: 0, modelSqErrSum: 0, marketSqErrSum: 0 })).toEqual(EMPTY_BRIER);
    expect(brierFromSums(null).model).toBeNull();
    expect(brierFromSums(undefined).market).toBeNull();
    expect(brierFromSums({}).model).toBeNull();
  });

  it("scores the market alone when there is no model column", () => {
    // The Betfair-SP screen: ml/train_and_predict.py scores the industry-SP
    // collection only, so `scored` is 0 there by construction while `priced`
    // counts every runner. The market score must survive that; the model score
    // must not be invented.
    const stats = brierFromSums({ scored: 0, priced: 4, modelSqErrSum: 0, marketSqErrSum: 1 });
    expect(stats.model).toBeNull();
    expect(stats.market).toBe(0.25);
    expect(stats.priced).toBe(4);
  });

  it("keeps the two denominators independent", () => {
    // Guards against a refactor that collapses them back into one count: on the
    // ISP surfaces they are deliberately equal, so a bug swapping them would be
    // invisible everywhere except here.
    const stats = brierFromSums({ scored: 2, priced: 10, modelSqErrSum: 1, marketSqErrSum: 1 });
    expect(stats.model).toBe(0.5);
    expect(stats.market).toBe(0.1);
  });
});

describe("sumBrierSums", () => {
  it("adds parts up so a mean is taken over runners, not over races", () => {
    // The reason this function exists. Race A: 1 runner, squared error 0.9.
    // Race B: 9 runners, total squared error 0.9. Summing first gives
    // 1.8/10 = 0.18. Averaging the two races' own means would give
    // (0.9 + 0.1) / 2 = 0.5 — nearly triple, purely from letting a one-runner
    // race outvote a nine-runner one.
    const combined = sumBrierSums([
      { scored: 1, priced: 1, modelSqErrSum: 0.9, marketSqErrSum: 0.5 },
      { scored: 9, priced: 9, modelSqErrSum: 0.9, marketSqErrSum: 0.5 },
    ]);
    expect(combined).toEqual({ scored: 10, priced: 10, modelSqErrSum: 1.8, marketSqErrSum: 1 });
    expect(brierFromSums(combined).model).toBe(0.18);
  });

  it("skips absent parts rather than treating them as zeros in the denominator", () => {
    // Live-results documents captured before Brier sums were recorded have no
    // brierSums field at all. They must drop out of both the numerator and the
    // denominator — counting them as 0-error runners would drag the whole
    // score towards a perfect one.
    const combined = sumBrierSums([
      { scored: 2, priced: 2, modelSqErrSum: 0.4, marketSqErrSum: 0.4 },
      null,
      undefined,
    ]);
    expect(combined.scored).toBe(2);
    expect(brierFromSums(combined).model).toBe(0.2);
  });

  it("returns an all-zero accumulator for an empty list", () => {
    expect(sumBrierSums([])).toEqual({ scored: 0, priced: 0, modelSqErrSum: 0, marketSqErrSum: 0 });
    expect(brierFromSums(sumBrierSums([]))).toEqual(EMPTY_BRIER);
  });
});
