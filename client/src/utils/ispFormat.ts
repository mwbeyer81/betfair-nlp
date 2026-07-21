import { IspRace, IspRunner, PnlStats } from "../services/chatApi";

export type OddsMode = "fraction" | "decimal";

// Industry SP is conventionally quoted as a fraction ("8/15") — that's the
// default display. Decimal is the derived/secondary form, shown rounded to
// 2dp (the value stored in the DB is already rounded at import time, but
// .toFixed(2) here is a defensive belt-and-braces guard against ever
// rendering an unrounded value, e.g. from older cached data).
export function formatIsp(runner: IspRunner, mode: OddsMode): string {
  if (mode === "fraction") return runner.ispFraction ?? (runner.isp != null ? runner.isp.toFixed(2) : "-");
  return runner.isp != null ? runner.isp.toFixed(2) : "-";
}

export function stakeToWin1(isp: number): number {
  return 1 / (isp - 1);
}

export function formatGbp(val: number): string {
  return `£${Math.abs(val).toFixed(2)}`;
}

export function formatPnl(val: number): string {
  return val >= 0 ? `+${formatGbp(val)}` : `-${formatGbp(val)}`;
}

export function formatPct(pnl: number, staked: number): string {
  if (staked === 0) return "";
  const pct = (pnl / staked) * 100;
  return pct >= 0 ? `+${pct.toFixed(1)}%` : `${pct.toFixed(1)}%`;
}

export function computeRangePnl(races: IspRace[]): PnlStats {
  let staked = 0, returns = 0, count = 0;
  for (const race of races) {
    for (const runner of race.runners) {
      if (runner.isp != null && runner.isp > 1) {
        count++;
        const stake = 1 / (runner.isp - 1);
        staked += stake;
        if (runner.status === "WINNER") returns += stake + 1;
      }
    }
  }
  return { staked, returns, pnl: returns - staked, count };
}

export function runnerPnl(runner: IspRunner): number | null {
  if (runner.isp == null) return null;
  return runner.status === "WINNER" ? 1 : -stakeToWin1(runner.isp);
}

export function formatRaceTime(isoTime: string): string {
  try {
    return new Date(isoTime).toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/London",
    });
  } catch {
    return isoTime;
  }
}

export function formatRaceDate(isoTime: string): string {
  try {
    return new Date(isoTime).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "Europe/London",
    });
  } catch {
    return "";
  }
}

// Mirrors the same Flat/Jumps bucketing used server-side in
// src/commands/precompute-trainer-form.ts (toFormCategory there) — kept in
// sync manually since the trainer-form badge's category needs to match
// exactly what the precompute script grouped by. Anything that isn't
// exactly "Flat" (Hurdle, Chase, NH Flat, ...) is Jumps.
export function toFormCategory(raceType: string): "Flat" | "Jumps" {
  return (raceType || "").trim().toLowerCase() === "flat" ? "Flat" : "Jumps";
}
