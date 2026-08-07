import { FavSums } from "../service/fav-pnl";

/**
 * MongoDB aggregation expressions for the favourite-backed baseline defined in
 * `src/lib/service/fav-pnl.ts` — read that file first for what "the favourite"
 * means and why the baseline is deliberately blind to the runner-level filters.
 *
 * Kept here rather than inline in the DAOs for the same reason `brier-expr.ts`
 * exists: more than one pipeline needs the identical arithmetic, and a baseline
 * that means one thing on the Filters screen and a slightly different thing on
 * a saved result is worse than no baseline at all.
 *
 * Everything below emits SUMS, never a P&L — the subtraction happens once, in
 * `favPnlFromSums`, after the sums have been rolled up across every race.
 */

/**
 * One race's favourite-backed sums, as a single object expression suitable for
 * `$addFields`.
 *
 * ## Why this is computed here and not from a `$lookup`
 *
 * This is emitted per race, alongside `_brier`, BEFORE industry-sp-dao.ts's
 * `$project` reduces each doc to a handful of scalars for sorting — so the five
 * numbers travel through the sort/skip/limit as ~40 more bytes and the `favPnl`
 * facet branch is a plain `$group` over them. The alternative (a `$lookup` back
 * to the full document inside the facet, as the `pnlStats` slow path is forced
 * to do) would re-fetch every matched race's whole runners array on every
 * request — the single largest cost this pipeline has already been optimised
 * once to remove.
 *
 * ## Two passes, not four
 *
 * `$min` needs its own pass by definition (the shortest price is not known
 * until every runner has been seen), so the price is bound once via `$let` and
 * the `$reduce` that follows walks the array a second time. Writing the
 * favourite test inline in the `$reduce` instead would recompute the minimum
 * once per runner — O(runners^2) per race, for a value constant across the race.
 * Both passes are over an already-in-memory ~9-element array: no `$unwind`, no
 * `$lookup`, no extra documents downstream.
 *
 * ## The equality test is exact, and safe
 *
 * `parse-isp.ts` rounds every stored price to 2dp, so `$eq` against the array's
 * own `$min` compares two identical stored values rather than two computed
 * floats. Same technique, same reasoning as `modelTopPickCond`'s `$eq` against
 * `$max` — and the same tie behaviour: joint favourites all match, and all are
 * backed.
 */
export function raceFavSumsExpr(p: {
  runnersPath: string;
  priceField: string;
  /**
   * Extra conditions a runner must satisfy to be considered for favouritism,
   * written against `$$fr` (the binding the backable-runner `$filter` below
   * uses). The Betfair-SP collection needs `status !== "REMOVED"` here: a
   * withdrawn runner can still carry a price in that dataset, and it must not
   * be allowed to hold the minimum — that would make the whole race's baseline
   * a bet nobody could have struck. The industry-SP collection passes none,
   * because a non-runner there simply has no `isp`.
   */
  backableCond?: Record<string, unknown>[];
}): Record<string, unknown> {
  const runnerPrice = `$$this.${p.priceField}`;
  // isp > 1 rather than merely non-null: a price of exactly 1.0 (or below) is
  // not a bet anyone can strike, and 1/(isp-1) would divide by zero. Identical
  // to the "backable runner" test every other pipeline in this repo applies.
  const backable = {
    $filter: {
      input: { $ifNull: [p.runnersPath, []] },
      as: "fr",
      cond: {
        $and: [
          { $isNumber: `$$fr.${p.priceField}` },
          { $gt: [`$$fr.${p.priceField}`, 1] },
          ...(p.backableCond ?? []),
        ],
      },
    },
  };

  const toWinStake = { $divide: [1, { $subtract: [runnerPrice, 1] }] };
  const won = { $eq: ["$$this.status", "WINNER"] };

  return {
    $let: {
      vars: { favRunners: backable },
      in: {
        $let: {
          // null over an empty array — every runner unpriced or withdrawn. The
          // `$eq` below then matches nothing and the race contributes all
          // zeros, including `races: 0`, so it is excluded from the baseline's
          // denominator rather than counted as a race the favourite lost.
          vars: {
            favPrice: { $min: { $map: { input: "$$favRunners", as: "fm", in: `$$fm.${p.priceField}` } } },
          },
          in: {
            $reduce: {
              input: "$$favRunners",
              initialValue: { races: 0, bets: 0, staked: 0, returns: 0, levelReturns: 0 },
              in: {
                $cond: [
                  { $eq: [runnerPrice, "$$favPrice"] },
                  {
                    // Set, not added: any matching runner marks this as one
                    // race with an identifiable favourite, and a second joint
                    // favourite must not make it count as two races (it does
                    // correctly count as two `bets`).
                    races: 1,
                    bets: { $add: ["$$value.bets", 1] },
                    staked: { $add: ["$$value.staked", toWinStake] },
                    returns: {
                      $add: ["$$value.returns", { $cond: [won, { $add: [toWinStake, 1] }, 0] }],
                    },
                    levelReturns: {
                      $add: ["$$value.levelReturns", { $cond: [won, runnerPrice, 0] }],
                    },
                  },
                  "$$value",
                ],
              },
            },
          },
        },
      },
    },
  };
}

/**
 * `$group` accumulators that roll per-race sums (as emitted by
 * `raceFavSumsExpr` into `field`) up to a whole filtered set.
 */
export function favGroupAccumulators(field: string): Record<keyof FavSums, unknown> {
  return {
    races: { $sum: `$${field}.races` },
    bets: { $sum: `$${field}.bets` },
    staked: { $sum: `$${field}.staked` },
    returns: { $sum: `$${field}.returns` },
    levelReturns: { $sum: `$${field}.levelReturns` },
  };
}
