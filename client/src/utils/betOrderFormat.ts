import { toFractionalOdds } from "./oddsFormat";
import { BetOrder, BetOrderStatus } from "../services/chatApi";

export type { BetOrder, BetOrderStatus };

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
// of a price the user has already seen on this same row.
export function formatBetOrderCondition(order: BetOrder): string {
  const price = order.minQualifyingPrice;
  return `Back at ${toFractionalOdds(price)} (${price.toFixed(2)})+ to win £${order.targetProfit.toFixed(2)} (stake up to £${order.maxStake.toFixed(2)})`;
}
