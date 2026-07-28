// Converts a model win-probability percentage into "fair" bookmaker-style
// odds — the price at which backing the runner is exactly break-even long
// run. If a real bookmaker quotes odds higher than this, the bet has
// positive expected value against the model; lower, and it doesn't.
// Deliberately the inverse of ispFormat.ts's impliedProbabilityPct (which
// goes real-odds -> probability, for historical ISP data) — this repo has
// no odds field on live Daily Races runners to compare against directly
// (see daily-race-dao.ts), so this only ever produces the model's own
// implied price, not a live market comparison.
export function fairDecimalOdds(modelWinProbabilityPct: number): number | null {
  if (modelWinProbabilityPct <= 0) return null;
  return 100 / modelWinProbabilityPct;
}

// The standard UK/Irish fractional-odds ladder (the same fixed set of
// prices every bookmaker actually quotes from — not just any reduced
// fraction) as [numerator, denominator] pairs, ascending by value. There's
// no existing decimal->fraction utility in this repo to reuse (parse-isp.ts
// only ever goes fraction->decimal for real recorded ISP strings); this is
// the standard list published by e.g. the Racing Post / Betfair "odds
// converter" tables.
const FRACTIONAL_ODDS_LADDER: [number, number][] = [
  [1, 100], [1, 50], [1, 33], [1, 25], [1, 20], [1, 16], [1, 14], [1, 12],
  [1, 10], [1, 9], [1, 8], [2, 15], [1, 7], [2, 13], [1, 6], [2, 11],
  [1, 5], [2, 9], [1, 4], [2, 7], [3, 10], [1, 3], [4, 11], [2, 5], [4, 9],
  [1, 2], [4, 7], [8, 15], [4, 6], [8, 13], [4, 5], [5, 6], [10, 11],
  [20, 21], [1, 1],
  [21, 20], [11, 10], [6, 5], [5, 4], [11, 8], [6, 4], [13, 8], [7, 4], [15, 8],
  [2, 1], [85, 40], [9, 4], [5, 2], [11, 4],
  [3, 1], [10, 3], [7, 2], [4, 1], [9, 2], [5, 1],
  [11, 2], [6, 1], [13, 2], [7, 1], [15, 2], [8, 1], [17, 2], [9, 1], [10, 1],
  [11, 1], [12, 1], [14, 1], [16, 1], [20, 1], [25, 1], [33, 1], [40, 1],
  [50, 1], [66, 1], [100, 1],
];

// Snaps decimalOdds to the nearest price on the real fractional-odds ladder
// above and returns it as "num/den" (or "Evens" at 1/1, matching how
// bookmakers actually display that one price) — deliberately NOT a bare
// GCD-reduced fraction of (decimalOdds - 1), which produces mathematically
// "accurate" but unrecognizable prices (e.g. "64/17") no bookmaker would
// ever quote and that would look broken to a punter.
export function toFractionalOdds(decimalOdds: number): string {
  const profit = decimalOdds - 1;
  if (profit <= 0) return "-";

  let best = FRACTIONAL_ODDS_LADDER[0];
  let bestErr = Math.abs(profit - best[0] / best[1]);
  for (const entry of FRACTIONAL_ODDS_LADDER) {
    const err = Math.abs(profit - entry[0] / entry[1]);
    if (err < bestErr) {
      bestErr = err;
      best = entry;
    }
  }

  const [num, den] = best;
  if (num === den) return "Evens";
  return `${num}/${den}`;
}
