import { toFractionalOdds } from "./oddsFormat";
import { BetOrder, BetOrderStatus, BetOrderType } from "../services/chatApi";

export type { BetOrder, BetOrderStatus, BetOrderType };

// "placing" is a brief transient state (see BetOrderDAO.tryTransition on
// the backend) that a GET could theoretically observe mid-evaluation;
// "unmatched"/"error" are real, distinct failure states — see
// bet-order-dao.ts's BetOrderStatus doc comment for why none of these are
// folded into "pending".
export const BET_ORDER_STATUS_LABEL: Record<BetOrderStatus, string> = {
  pending: "Pending",
  unmatched: "Unmatched",
  placing: "Placing…",
  triggered: "Triggered",
  expired: "Expired",
  cancelled: "Cancelled",
  error: "Error",
};

// The Betfair back price that would return exactly the requested target
// profit while staking exactly maxStake — anything at or above this price
// nets at least that much profit for the same stake, so it's the threshold
// a conditional bet order actually watches for. Mirrors oddsFormat.ts's
// "unknown input -> null, never a fabricated number" convention. Used
// client-side for the Place Bet dialog's live preview before the order is
// even created — the backend (bet-order-service.ts) computes and persists
// the authoritative value using this exact same formula.
export function minQualifyingPrice(targetProfit: number, maxStake: number): number | null {
  if (!Number.isFinite(targetProfit) || !Number.isFinite(maxStake)) return null;
  if (targetProfit <= 0 || maxStake <= 0) return null;
  return 1 + targetProfit / maxStake;
}

// Same "Fair {fraction} ({decimal})" framing as the existing Fair-odds pick
// badge (oddsFormat.ts), so the bet condition reads as a natural extension
// of a price the user has already seen on this same row. Instant orders are
// only ever persisted terminal (see bet-order-service.ts's placeInstant —
// no "pending" instant order exists), so a matchedPrice is always present
// once one reaches this formatter; the scheduled wording is kept as a
// defensive fallback rather than assumed unreachable.
export function formatBetOrderCondition(order: BetOrder): string {
  if (order.orderType === "instant" && order.matchedPrice != null) {
    return `Backed now at ${toFractionalOdds(order.matchedPrice)} (${order.matchedPrice.toFixed(2)})`;
  }
  const price = order.minQualifyingPrice;
  return `Back at ${toFractionalOdds(price)} (${price.toFixed(2)})+ to win £${order.targetProfit.toFixed(2)} (stake up to £${order.maxStake.toFixed(2)})`;
}

// The real, settled outcome — only ever set for a real (non-simulated) bet
// once Betfair itself confirms the race has settled (see
// BetOrderService.refreshSettledResults). null means "not settled yet",
// never inferred — a bet with no result shown here just hasn't finished
// yet, not "assumed lost".
export function formatBetOrderResult(order: BetOrder): string | null {
  if (order.betOutcome == null || order.settledProfit == null) return null;
  const sign = order.settledProfit > 0 ? "+" : order.settledProfit < 0 ? "-" : "";
  const amount = Math.abs(order.settledProfit).toFixed(2);
  if (order.betOutcome === "WON") return `Won ${sign}£${amount}`;
  if (order.betOutcome === "LOST") return `Lost ${sign}£${amount}`;
  if (order.betOutcome === "VOID") return "Void — stake returned";
  return `${order.betOutcome} (${sign}£${amount})`;
}
