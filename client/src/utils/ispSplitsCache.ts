import { PnlStats, IspFilterBounds } from "../services/chatApi";

// Caches the /isp home page's aggregate result (grand total + both splits)
// in sessionStorage, keyed by the exact filter/split combination that
// produced it. Filters should only ever be *reapplied* (a genuine network
// request) when the user presses Apply or Reset — everything else that
// re-mounts this screen (navigating to /isp/races and back via "← Filters",
// opening/closing the split detail panel, a stray re-render) should reuse
// the last known-good result instantly instead of re-fetching. Deliberately
// scoped to this one aggregate result, not the paginated races list on
// /isp/races — that's expected to always fetch fresh as you page through it.
export interface CachedSplitResult {
  fromRow: number;
  toRow: number | null;
  total: number;
  totalRunners: number;
  pnlStats: PnlStats;
}

export interface CachedSplitsResult {
  totalRaces: number;
  totalRunners: number;
  raceCap: number;
  // filterBounds/countries ride along on the same /splits response (see
  // getSplitStats on the backend) so a cache hit can populate the whole
  // screen — including the filter panel's controls — without a second
  // request. They're effectively static (only change on a manual reseed),
  // so there's no correctness cost to serving them straight from cache.
  filterBounds: IspFilterBounds;
  countries: string[];
  courses: string[];
  goings: string[];
  raceClasses: string[];
  raceTypes: string[];
  splitA: CachedSplitResult;
  splitB: CachedSplitResult;
}

export interface SplitsCacheParams {
  minRunners: number;
  maxRunners: number;
  countries: string[];
  minIsp: number;
  maxIsp: number;
  minRunnersInRange: number;
  maxRunnersInRange: number;
  minDate: string;
  maxDate: string;
  courses: string[];
  goings: string[];
  raceClasses: string[];
  raceTypes: string[];
  trainerSearch: string;
  jockeySearch: string;
  trainerFormMinWinRate: number;
  minTrainerFormRunners: number;
  maxTrainerFormRunners: number;
  minModelWinProbability: number;
  onlyModelBeatsSp: boolean;
  // Only affects the *default* split's boundary computation (races vs
  // qualifying-runner-count bisection) — still part of the cache key since
  // it changes what a default-split request returns.
  splitByRunners: boolean;
  // Default-split mode is its own cache bucket, distinct from any explicit
  // range — the backend recomputes the default from whatever the current
  // grand total is, so caching it under a fixed fromRow/toRow would go
  // stale the moment the underlying data changes size.
  isDefault: boolean;
  fromRowA: number;
  toRowA: number | null;
  fromRowB: number;
  toRowB: number | null;
  // Runner-mode equivalent of fromRowA/etc. above — only one unit is ever
  // actually sent to the backend at a time (see IndustrySpScreen's fetch
  // effect), but both are included here so a switch between "Split by
  // races" and "Split by runners" with an otherwise-identical explicit
  // range can't collide on the same cache entry.
  fromRunnerA: number | null;
  toRunnerA: number | null;
  fromRunnerB: number | null;
  toRunnerB: number | null;
  // The anon/authenticated race cap changes what the backend actually
  // returns for the exact same filter/split combination — without this,
  // signing up (or logging out) mid-session could silently serve the
  // other tier's cached result instead of re-fetching under the new cap.
  isAuthenticated: boolean;
}

const CACHE_PREFIX = "isp-splits-cache:";

export function buildSplitsCacheKey(p: SplitsCacheParams): string {
  return (
    CACHE_PREFIX +
    JSON.stringify([
      p.minRunners,
      p.maxRunners,
      [...p.countries].sort(),
      p.minIsp,
      p.maxIsp,
      p.minRunnersInRange,
      p.maxRunnersInRange,
      p.minDate,
      p.maxDate,
      [...p.courses].sort(),
      [...p.goings].sort(),
      [...p.raceClasses].sort(),
      [...p.raceTypes].sort(),
      p.trainerSearch,
      p.jockeySearch,
      p.trainerFormMinWinRate,
      p.minTrainerFormRunners,
      p.maxTrainerFormRunners,
      p.minModelWinProbability,
      p.onlyModelBeatsSp,
      p.splitByRunners,
      p.isDefault
        ? "default"
        : [p.fromRowA, p.toRowA, p.fromRowB, p.toRowB, p.fromRunnerA, p.toRunnerA, p.fromRunnerB, p.toRunnerB],
      p.isAuthenticated,
    ])
  );
}

export function readSplitsCache(key: string): CachedSplitsResult | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as CachedSplitsResult) : null;
  } catch {
    // Corrupt entry, or sessionStorage unavailable (private browsing,
    // disabled storage) — treat exactly like a cache miss.
    return null;
  }
}

export function writeSplitsCache(key: string, result: CachedSplitsResult): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(key, JSON.stringify(result));
  } catch {
    // Quota exceeded or storage disabled — caching is a pure perf
    // optimization, never worth failing the page over.
  }
}
