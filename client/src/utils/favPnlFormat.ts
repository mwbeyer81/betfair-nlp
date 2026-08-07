import { FavPnlStats, PnlStats } from "../services/chatApi";
import { formatPnl, formatPct } from "./ispFormat";

/**
 * Formatting and comparison helpers for the favourite-backed baseline shown
 * beside every filtered P&L. The arithmetic that produces it lives on the
 * backend (src/lib/service/fav-pnl.ts) — this module only formats and compares.
 */

/**
 * Which staking convention a surface is showing. The baseline MUST be read in
 * the same one as the figure it sits under: to-win-£1 and £1-level disagree by
 * roughly 11 points on identical bets purely through bet sizing, so comparing a
 * filtered to-win figure against a level baseline would manufacture an edge (or
 * hide one) out of nothing.
 */
export type StakeConvention = "toWin" | "level";

const ZERO_BOOK = { staked: 0, returns: 0, pnl: 0 };

/**
 * The baseline's own staked/returns/pnl in the requested convention.
 *
 * `level` is read defensively even though the type says it is always there:
 * this object can arrive from a sessionStorage entry written by an earlier
 * deploy (see ispSplitsCache) or from a saved result's stored snapshot, and
 * neither is version-checked. A missing half must degrade to "no baseline",
 * exactly as a missing whole does — never to a crash inside a card's render.
 */
export function favBook(fav: FavPnlStats | null | undefined, convention: StakeConvention) {
  if (fav == null) return null;
  if (convention === "level") return fav.level ?? ZERO_BOOK;
  return { staked: fav.staked ?? 0, returns: fav.returns ?? 0, pnl: fav.pnl ?? 0 };
}

/**
 * True when there is a baseline to show at all.
 *
 * Gates on `count`, not on `staked`: zero bets is an ordinary state (a filter
 * matching no race, or races whose every runner is unpriced) and must render as
 * an em dash, whereas £0.00 would read as a baseline that broke even.
 */
export function hasFavPnl(fav: FavPnlStats | null | undefined): boolean {
  return fav != null && fav.count > 0 && ((fav.staked ?? 0) > 0 || (fav.level?.staked ?? 0) > 0);
}

export function favRoi(fav: FavPnlStats | null | undefined, convention: StakeConvention): number | null {
  const book = favBook(fav, convention);
  if (book == null || book.staked <= 0) return null;
  return (100 * book.pnl) / book.staked;
}

export function formatFavPnl(fav: FavPnlStats | null | undefined, convention: StakeConvention): string {
  const book = favBook(fav, convention);
  if (!hasFavPnl(fav) || book == null || book.staked <= 0) return "—";
  return `${formatPnl(book.pnl)} (${formatPct(book.pnl, book.staked)})`;
}

/**
 * How far the filtered selection's ROI sits above the baseline's, in percentage
 * points. Positive means the filter beat blindly backing favourites over the
 * same races — which is the only question this whole feature exists to answer,
 * and the reason the raw baseline number is never shown on its own.
 *
 * A difference of ROIs, not of P&L: the two books stake different totals (one
 * bet per race against one per qualifying runner), so their cash P&Ls are not
 * on the same scale and subtracting them would compare a £5 book to a £500 one.
 *
 * null unless both sides have a real book, since the comparison is meaningless
 * otherwise.
 */
export function favEdgePts(
  pnl: PnlStats | null | undefined,
  fav: FavPnlStats | null | undefined,
  convention: StakeConvention
): number | null {
  const baseline = favRoi(fav, convention);
  if (baseline == null || pnl == null || pnl.staked <= 0) return null;
  return (100 * pnl.pnl) / pnl.staked - baseline;
}

export function formatFavEdge(edge: number | null): string {
  if (edge == null) return "—";
  // Explicit sign and "pts": this is a difference between two percentages, and
  // writing it as a bare "%" would invite reading it as a return.
  return `${edge >= 0 ? "+" : "−"}${Math.abs(edge).toFixed(1)} pts`;
}

/**
 * A one-line plain-English verdict, used as the accessibility label and as the
 * caption under the numbers.
 *
 * Deliberately hedged on a small sample, for the same reason brierVerdict is: a
 * few dozen races of favourite-backing is dominated by whether a couple of 8/1
 * shots obliged, and these screens make it very easy to filter down that far.
 */
export const MIN_MEANINGFUL_FAV_RACES = 200;

export function isSmallFavSample(fav: FavPnlStats | null | undefined): boolean {
  return fav != null && fav.races > 0 && fav.races < MIN_MEANINGFUL_FAV_RACES;
}

export function favVerdict(
  pnl: PnlStats | null | undefined,
  fav: FavPnlStats | null | undefined,
  convention: StakeConvention
): string {
  if (!hasFavPnl(fav)) return "No favourite-backed baseline for this selection.";
  const races = fav?.races ?? 0;
  const baseline = favRoi(fav, convention);
  const edge = favEdgePts(pnl, fav, convention);
  const base = `Backing the favourite in these ${races} race${races === 1 ? "" : "s"} returns ${baseline?.toFixed(1)}%`;
  if (edge == null) return `${base}.`;
  const direction = edge > 0 ? "beats" : edge < 0 ? "trails" : "matches";
  const sample = races < MIN_MEANINGFUL_FAV_RACES ? " — too few races to read as a result" : "";
  return `${base}; this selection ${direction} it by ${Math.abs(edge).toFixed(1)} points${sample}.`;
}

/**
 * Combines two splits' baselines into one — used by the saved-results list
 * card, which shows the pair of splits as a single headline figure.
 *
 * A plain sum of every component, which is exactly right here and needs none of
 * the weighted-average care `combineBrierStats` takes: these are money and
 * counts over two disjoint race windows, not means. The ROI is recomputed from
 * the combined totals downstream, never averaged from the two sides' own.
 *
 * undefined (not a zeroed object) when neither side has one — a result saved
 * before this field existed must render as "no baseline", not as one that broke
 * even.
 */
export function combineFavPnl(
  a: FavPnlStats | null | undefined,
  b: FavPnlStats | null | undefined
): FavPnlStats | undefined {
  if (a == null && b == null) return undefined;
  const parts = [a, b].filter((x): x is FavPnlStats => x != null);
  return parts.reduce<FavPnlStats>(
    (acc, p) => ({
      races: acc.races + p.races,
      count: acc.count + p.count,
      staked: acc.staked + p.staked,
      returns: acc.returns + p.returns,
      pnl: acc.pnl + p.pnl,
      level: {
        staked: acc.level.staked + (p.level?.staked ?? 0),
        returns: acc.level.returns + (p.level?.returns ?? 0),
        pnl: acc.level.pnl + (p.level?.pnl ?? 0),
      },
    }),
    { races: 0, count: 0, staked: 0, returns: 0, pnl: 0, level: { staked: 0, returns: 0, pnl: 0 } }
  );
}
