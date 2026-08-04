import { BrierSums } from "../service/brier";

/**
 * MongoDB aggregation expressions for the Brier sums defined in
 * `src/lib/service/brier.ts`. Kept here rather than inline in the DAOs because
 * three separate pipelines need the identical arithmetic, and a Brier score
 * that means one thing on the Filters screen and a slightly different thing on
 * a saved result is worse than no Brier score at all.
 *
 * Everything below emits SUMS, never means — the division happens once, in
 * `brierFromSums`, after the sums have been rolled up across every race in the
 * filtered set.
 */

/** Field name of the per-runner model probability, 0-100. */
export const MODEL_PROB_FIELD = "modelWinProbability";

/**
 * The race's total implied probability, in percent, over every runner with a
 * real price — a bookmaker's SP book sums to ~115-125%, not 100.
 *
 * Deliberately computed over the FULL runners array, not the filtered subset:
 * the overround is a property of the race's whole book, and normalising by the
 * sum over (say) the three runners a filter happens to keep would produce
 * "probabilities" summing to 100% across three horses.
 *
 * Mirrors `model-accuracy-dao.ts`'s `_bookSum` exactly.
 */
export function bookSumExpr(runnersPath: string, priceField: string): Record<string, unknown> {
  return {
    $reduce: {
      input: { $ifNull: [runnersPath, []] },
      initialValue: 0,
      in: {
        $add: [
          "$$value",
          { $cond: [{ $gt: [`$$this.${priceField}`, 1] }, { $divide: [100, `$$this.${priceField}`] }, 0] },
        ],
      },
    },
  };
}

/**
 * Squared error of one 0-100 percentage probability against one runner's
 * result — the per-runner term of the Brier score. `statusPath` is the
 * runner's own status field; "WINNER" is the repo-wide winner marker
 * (industry-sp-dao.ts, market-definition-dao.ts, model-accuracy-dao.ts all
 * test it the same way).
 */
export function sqErrPctExpr(probPctExpr: unknown, statusPath: string): Record<string, unknown> {
  return {
    $pow: [
      {
        $subtract: [
          { $divide: [probPctExpr, 100] },
          { $cond: [{ $eq: [statusPath, "WINNER"] }, 1, 0] },
        ],
      },
      2,
    ],
  };
}

/**
 * The overround-normalised ("fair") probability a price implies, in percent.
 * Falls back to the raw implied probability if the book sum is unusable, which
 * can only happen for a race with no priced runners at all — in which case
 * nothing reaches this expression anyway.
 */
export function fairProbPctExpr(pricePath: string, bookSumExprOrPath: unknown): Record<string, unknown> {
  const raw = { $divide: [100, pricePath] };
  return {
    $let: {
      vars: { book: bookSumExprOrPath },
      in: { $cond: [{ $gt: ["$$book", 0] }, { $multiply: [{ $divide: [raw, "$$book"] }, 100] }, raw] },
    },
  };
}

/**
 * One race's Brier sums over the runners a filter kept, as a single object
 * expression suitable for `$addFields`.
 *
 * ## Why one `$reduce` and not `$filter` + `$map`
 *
 * This runs on every race the filters match — on the unfiltered default view
 * that is the whole ~109k-race collection — so it sits directly in the path
 * industry-sp-dao.ts spent real effort keeping free of per-runner work (see the
 * `pnlStats` fast-path comment there). A `$filter` to select the qualifying
 * runners plus a `$map` per score would walk each race's runners array three
 * times; one `$reduce` with a three-field accumulator walks it once. The book
 * sum needs its own prior pass by definition (a fair probability cannot be
 * computed before the book total is known), so this is two array passes per
 * race total, both over an already-in-memory ~9-element array — no `$unwind`,
 * no `$lookup`, no extra documents flowing downstream.
 *
 * ## Both sums cover the same runners
 *
 * `scored` and `priced` are incremented together, so on this pipeline the model
 * and market scores always describe an identical runner set. That is the point:
 * the comparison is the number worth reading. Runners the model never scored
 * are skipped by BOTH — dropping them from the model's score but leaving them
 * in the market's would compare the two over different horses.
 *
 * @param qualifyingCondExpr the caller's own "is this runner in the filtered
 *   set" condition, written against `$$r` — the same `$$r`-bound form every
 *   `$filter` in industry-sp-dao.ts already uses, bound here via `$let` so the
 *   exact same condition object can be shared between the two.
 */
export function raceBrierSumsExpr(p: {
  runnersPath: string;
  priceField: string;
  /** Null on datasets with no model column (Betfair BSP) — market score only. */
  modelProbField: string | null;
  qualifyingCondExpr: Record<string, unknown>;
  bookSumPath: string;
}): Record<string, unknown> {
  const pricePath = `$$this.${p.priceField}`;
  const modelPath = p.modelProbField ? `$$this.${p.modelProbField}` : null;
  const statusPath = "$$this.status";

  // $isNumber, not { $ne: [path, null] }. The two comments this repo already
  // carries on that question disagree with each other (industry-sp-dao.ts's
  // buildModelVsSpRunnerCond says a missing path compares equal to null;
  // model-accuracy-dao.ts's `scoredRunners` says it does not), and this
  // expression must be right regardless of which reading is correct: a runner
  // whose modelWinProbability is missing, explicitly null, or somehow
  // non-numeric must never contribute a squared error, because the only value
  // arithmetic could give it is 0 — a confident, wrong forecast the model never
  // actually made.
  const hasModel = modelPath ? { $isNumber: modelPath } : true;
  const eligible = {
    $and: [
      { $let: { vars: { r: "$$this" }, in: p.qualifyingCondExpr } },
      { $isNumber: pricePath },
      { $gt: [pricePath, 1] },
      hasModel,
    ],
  };

  const modelTerm = modelPath ? sqErrPctExpr(modelPath, statusPath) : 0;
  const marketTerm = sqErrPctExpr(fairProbPctExpr(pricePath, p.bookSumPath), statusPath);

  return {
    $reduce: {
      input: { $ifNull: [p.runnersPath, []] },
      initialValue: { scored: 0, priced: 0, modelSqErrSum: 0, marketSqErrSum: 0 },
      in: {
        $cond: [
          eligible,
          {
            // `scored` stays 0 when there is no model column, so brierFromSums
            // reports a null model score rather than a perfect one.
            scored: { $add: ["$$value.scored", modelPath ? 1 : 0] },
            priced: { $add: ["$$value.priced", 1] },
            modelSqErrSum: { $add: ["$$value.modelSqErrSum", modelTerm] },
            marketSqErrSum: { $add: ["$$value.marketSqErrSum", marketTerm] },
          },
          "$$value",
        ],
      },
    },
  };
}

/**
 * `$group` accumulators that roll per-race sums (as emitted by
 * `raceBrierSumsExpr` into `field`) up to a whole filtered set.
 */
export function brierGroupAccumulators(field: string): Record<keyof BrierSums, unknown> {
  return {
    scored: { $sum: `$${field}.scored` },
    priced: { $sum: `$${field}.priced` },
    modelSqErrSum: { $sum: `$${field}.modelSqErrSum` },
    marketSqErrSum: { $sum: `$${field}.marketSqErrSum` },
  };
}
