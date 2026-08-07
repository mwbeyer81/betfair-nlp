import { EMPTY_FAV_SUMS, favPnlFromSums, sumFavSums } from "../fav-pnl";

// The aggregation's own arithmetic is covered against a real MongoDB in
// src/lib/dao/__tests__/industry-sp-dao-fav-pnl.integration.test.ts. These
// cover the pure roll-up half: what the sums MEAN once they arrive, which is
// where the null-vs-zero and ratio-of-sums traps live.
describe("favPnlFromSums", () => {
  it("derives both books from one set of sums", () => {
    // 3 races, 4 bets (one joint favourite). To-win staked £2 returning £3;
    // level staked = the bet count, returning £10.
    const stats = favPnlFromSums({ races: 3, bets: 4, staked: 2, returns: 3, levelReturns: 10 });
    expect(stats).toEqual({
      races: 3,
      count: 4,
      staked: 2,
      returns: 3,
      pnl: 1,
      level: { staked: 4, returns: 10, pnl: 6 },
    });
  });

  it("stakes the level book per BET, not per race", () => {
    // The joint-favourite case, isolated: 1 race, 2 bets. Staking per race
    // would under-report the level book by half here and quietly inflate its
    // ROI, since both bets' returns are still counted.
    const stats = favPnlFromSums({ races: 1, bets: 2, staked: 0.5, returns: 0, levelReturns: 0 });
    expect(stats.level.staked).toBe(2);
    expect(stats.level.pnl).toBe(-2);
  });

  it("reports zeros for an empty selection, and count is what says 'no answer'", () => {
    const stats = favPnlFromSums(EMPTY_FAV_SUMS);
    expect(stats.count).toBe(0);
    expect(stats.pnl).toBe(0);
    expect(stats.level.pnl).toBe(0);
  });

  it("survives a missing or partial sums document", () => {
    // The `$group` branch returns an empty array when no document reached it,
    // so the DAO hands this undefined rather than a zeroed object.
    expect(favPnlFromSums(undefined)).toEqual(favPnlFromSums(EMPTY_FAV_SUMS));
    expect(favPnlFromSums(null)).toEqual(favPnlFromSums(EMPTY_FAV_SUMS));
    expect(favPnlFromSums({ races: 2 }).count).toBe(0);
  });
});

describe("sumFavSums", () => {
  it("adds parts before any division happens", () => {
    // Two days of captured results. The combined ROI is 12/8 - 1 = +50%, which
    // is NOT the mean of the two days' own ROIs (+100% and 0%) — the whole
    // reason this sums rather than averages.
    const total = sumFavSums([
      { races: 2, bets: 2, staked: 1, returns: 2, levelReturns: 4 },
      { races: 6, bets: 6, staked: 3, returns: 3, levelReturns: 8 },
    ]);
    expect(total).toEqual({ races: 8, bets: 8, staked: 4, returns: 5, levelReturns: 12 });
    const stats = favPnlFromSums(total);
    expect((100 * stats.level.pnl) / stats.level.staked).toBeCloseTo(50, 6);
  });

  it("ignores absent parts rather than treating them as a zero-return day", () => {
    // A day with no capture at all must not drag the baseline down; a day that
    // captured races the favourite lost must. Only the second is a real 0.
    const withGap = sumFavSums([{ races: 1, bets: 1, staked: 1, returns: 2, levelReturns: 3 }, null, undefined]);
    expect(withGap).toEqual({ races: 1, bets: 1, staked: 1, returns: 2, levelReturns: 3 });
  });

  it("returns a fresh zeroed object for no parts at all", () => {
    const empty = sumFavSums([]);
    expect(empty).toEqual(EMPTY_FAV_SUMS);
    // Not the shared constant itself — a caller mutating a result must not
    // corrupt every future roll-up.
    expect(empty).not.toBe(EMPTY_FAV_SUMS);
  });
});
