import { IspRace, IspRunner, PnlStats } from "../services/chatApi";

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
