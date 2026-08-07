/**
 * "What would backing the favourite have returned over these same races?" —
 * the market baseline every filtered P&L on this app is implicitly measured
 * against.
 *
 * A filter's P&L answers "did this selection make money", which is not the
 * question a user actually has. Backing every runner in the dataset loses
 * ~11.7% (to-win-£1) purely to the overround, so ANY selection that loses less
 * than that is already doing something, and one that loses more is doing
 * something worse than not choosing at all. Blindly backing each race's
 * favourite is the cheapest, most widely understood benchmark of that kind: no
 * model, no filter, no skill, just the horse the market rated shortest. Shown
 * beside the filtered figure it converts an unreadable "-£67.78 (-11.8%)" into
 * a comparison — did this filter beat doing the dumbest possible thing on the
 * same races.
 *
 * ## What "the favourite" means here
 *
 * The runner with the LOWEST industry SP among the race's backable runners
 * (isp > 1), computed over the race's FULL runners array — deliberately not
 * narrowed by the ISP range or by any of the trainer-form/model/model-beats-SP
 * runner filters. Two reasons:
 *
 * 1. A benchmark narrowed by the same filters it is benchmarking is not a
 *    benchmark. If an isp range of 5-10 could move which horse counts as "the
 *    favourite", the baseline would shift under every filter change and could
 *    never be compared across two filter sets.
 * 2. It is what a person means by the word. The favourite of a race is a fact
 *    about the race, not about the query.
 *
 * The RACES, on the other hand, are exactly the filtered ones (and, on a split
 * card, exactly that split's row window) — that is the whole point: same races,
 * different selection.
 *
 * Joint favourites keep BOTH runners, and each is backed at full stake — the
 * same tie decision `modelTopPickCond` already makes in industry-sp-dao.ts for
 * the model's top pick, for the same reasons: a tie at the 2dp these prices are
 * stored to is genuine, dropping the race loses data, and breaking the tie
 * arbitrarily would make the answer depend on document order. It does mean
 * `count` can exceed `races`, which is why both are reported.
 *
 * ## Both staking conventions, always
 *
 * Same rule as the filtered P&L (see industry-sp-dao.ts's `levelPnl` comment):
 * to-win-£1 and £1-level disagree by ~11 points on the SAME bets purely through
 * bet sizing. A benchmark is only meaningful against a figure computed the same
 * way, so this carries both and each surface reads whichever one it is showing
 * beside — never one against the other.
 */

/**
 * Raw per-race accumulators, as the aggregation emits them — summable across
 * races, which is the only correct way to combine them (a ROI is a ratio of
 * sums, never a mean of ratios).
 */
export interface FavSums {
  /** Races that had at least one backable runner, i.e. an identifiable favourite. */
  races: number;
  /** Favourite bets placed. Exceeds `races` only where a race had joint favourites. */
  bets: number;
  /** Staked to win £1 per bet: 1/(isp-1). */
  staked: number;
  /** Returned on that stake: stake + 1 on a winner, else 0. */
  returns: number;
  /** Returned on a £1 flat stake: isp on a winner, else 0. (Staked is `bets`.) */
  levelReturns: number;
}

export interface FavPnlStats {
  races: number;
  /** Favourite bets the figures below are over. 0 means "no answer", never "broke even". */
  count: number;
  /** To-win-£1, matching the convention `pnlStats` uses. */
  staked: number;
  returns: number;
  pnl: number;
  /** £1 flat per bet, matching the convention `levelPnl` uses. */
  level: { staked: number; returns: number; pnl: number };
}

export const EMPTY_FAV_SUMS: FavSums = { races: 0, bets: 0, staked: 0, returns: 0, levelReturns: 0 };

export const EMPTY_FAV_PNL: FavPnlStats = {
  races: 0,
  count: 0,
  staked: 0,
  returns: 0,
  pnl: 0,
  level: { staked: 0, returns: 0, pnl: 0 },
};

/**
 * Turns raw sums into the figures a screen renders.
 *
 * Zeros are returned (rather than nulls) because the caller distinguishes "no
 * answer" from "break-even" on `count`, exactly as `pnlStats.staked > 0` already
 * gates the filtered headline everywhere it is shown. Doing it on `count` and
 * not on `staked` matters: a race whose favourite is priced at exactly 1.0 is
 * excluded as unbackable, so a zero stake with a non-zero count cannot arise —
 * but a zero count with real races can (every runner unpriced), and that must
 * render as "—".
 */
export function favPnlFromSums(sums: Partial<FavSums> | null | undefined): FavPnlStats {
  const races = sums?.races ?? 0;
  const bets = sums?.bets ?? 0;
  const staked = sums?.staked ?? 0;
  const returns = sums?.returns ?? 0;
  const levelReturns = sums?.levelReturns ?? 0;
  return {
    races,
    count: bets,
    staked,
    returns,
    pnl: returns - staked,
    level: { staked: bets, returns: levelReturns, pnl: levelReturns - bets },
  };
}

/**
 * Adds per-race sums up before turning them into a P&L.
 *
 * Needed wherever a total is assembled from parts (the saved-result Live
 * Performance rollup stores one document per race and sums them on the client),
 * for the same reason `sumBrierSums` exists: ROI is a ratio of sums, so
 * averaging per-race ROIs would weight a race with one £1.20 favourite the same
 * as a race with two joint favourites at 12.0.
 */
export function sumFavSums(parts: (Partial<FavSums> | null | undefined)[]): FavSums {
  return parts.reduce<FavSums>(
    (acc, p) => ({
      races: acc.races + (p?.races ?? 0),
      bets: acc.bets + (p?.bets ?? 0),
      staked: acc.staked + (p?.staked ?? 0),
      returns: acc.returns + (p?.returns ?? 0),
      levelReturns: acc.levelReturns + (p?.levelReturns ?? 0),
    }),
    { ...EMPTY_FAV_SUMS }
  );
}
