import { toFractionalOdds } from "./oddsFormat";

export type BetOrderStatus = "pending" | "triggered" | "expired" | "cancelled";

export const BET_ORDER_STATUS_LABEL: Record<BetOrderStatus, string> = {
  pending: "Pending",
  triggered: "Triggered",
  expired: "Expired",
  cancelled: "Cancelled",
};

export interface BetOrder {
  id: string;
  runnerId: string;
  horse: string;
  course: string;
  offTime: string;
  targetProfit: number;
  maxStake: number;
  minQualifyingPrice: number;
  status: BetOrderStatus;
  createdAt: string;
}

// The Betfair back price that would return exactly the requested target
// profit while staking exactly maxStake — anything at or above this price
// nets at least that much profit for the same stake, so it's the threshold
// a conditional bet order actually watches for. Mirrors oddsFormat.ts's
// "unknown input -> null, never a fabricated number" convention: this repo
// has no live Betfair price feed at all yet (see AGENTS.md), so this value
// is purely a derived condition to watch for later, not a live quote.
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
