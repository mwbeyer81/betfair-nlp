import React, { useState, useEffect } from "react";
import { View, ScrollView, TouchableOpacity, StyleSheet, SafeAreaView } from "react-native";
import { Text, Button, ActivityIndicator } from "react-native-paper";
import { chatApi, IspRace, IspRunner } from "../services/chatApi";
import { colors, statusPill, radii, spacing } from "../theme";
import { PageContainer } from "./PageContainer";
import { AppHeader } from "./AppHeader";
import type { Route } from "../hooks/useRouter";
import {
  stakeToWin1,
  formatGbp,
  formatPnl,
  formatPct,
  formatIsp,
  computeRangePnl,
  runnerPnl,
  formatRaceTime,
  raceYearKey,
  raceMonthKey,
  raceMonthLabel,
  yearsInRange,
  monthsInRange,
  toFormCategory,
  OddsMode,
  modelBeatsSp,
  impliedProbabilityPct,
} from "../utils/ispFormat";
import {
  urlIntParam,
  urlFloatParam,
  urlStringParam,
  urlToRowParam,
  urlCountriesParam,
  urlSetParam,
  urlSortParam,
  updateUrlParams,
} from "../utils/ispUrlParams";
import { buildHierarchy, collectHierarchyNodeKeys, YearNode, MonthNode } from "../utils/raceHierarchy";

const PAGE_SIZE = 20;

// Same values as IndustrySpScreen's own ABSOLUTE_MIN_DATE/ABSOLUTE_MAX_DATE —
// duplicated rather than imported to avoid adding a dependency on that
// screen's internals; both represent "the real dataset's earliest/latest
// possible date" and change together only if the underlying data range
// itself changes. Used here purely to know which years to render a header
// for when minDate/maxDate are absent from the URL (an unbounded filter).
const ABSOLUTE_MIN_DATE = "2015-01-01";
const ABSOLUTE_MAX_DATE = "2026-12-31";

// Groups races into a Year → Month → Day → Meeting tree for the collapsible
// results list — thin IspRace-specific wrapper over the generic
// buildHierarchy (client/src/utils/raceHierarchy.ts), shared with
// SavedResultDetailScreen's own Live Performance hierarchy.
function buildRaceHierarchy(races: IspRace[]) {
  return buildHierarchy(races, {
    dateTime: race => race.raceTime,
    meetingId: race => race.meetingId,
    meetingLabel: race => race.course,
  });
}

// Inserts an empty placeholder YearNode for every year the applied date
// filter could contain but no race data has loaded for yet — lets the
// screen render a full "2024 / 2025 / 2026" set of collapsed year headers
// immediately (see expandYearDefaultMonth), rather than only years the
// user has actually tapped open so far.
function mergeYearPlaceholders(hierarchy: YearNode<IspRace>[], yearKeys: string[]): YearNode<IspRace>[] {
  const byKey = new Map(hierarchy.map(y => [y.key, y]));
  return yearKeys.map(key => byKey.get(key) ?? { key, items: [], months: [] });
}

// Same idea, one level down: a year whose own data hasn't all loaded yet
// (its "Load more" hasn't reached every month within it) still gets a
// header for every month it *could* contain, not just the ones its
// currently-loaded races happen to fall in — e.g. a month's races loading
// in first shouldn't mean the next one simply doesn't exist on screen
// until "Load more" happens to reach it.
//
// `knownStartMonth` (set once expandYearDefaultMonth's probe resolves —
// see yearDataStartMonth) clips the *lower* bound further still: a row
// range (Split A/B) doesn't necessarily start at a year's own January —
// it starts wherever its own fromRow lands chronologically, so a month
// strictly before the confirmed real start isn't "not loaded yet", it's
// provably impossible for this filter and shouldn't render a header
// implying otherwise. Absent (year not yet probed) falls back to the
// year's own full calendar span, the generous default until that's known.
function mergeMonthPlaceholders(year: YearNode<IspRace>, effectiveMinDate: string, effectiveMaxDate: string, order: "asc" | "desc", knownStartMonth?: string): MonthNode<IspRace>[] {
  const { from, to } = yearBounds(year.key, effectiveMinDate, effectiveMaxDate);
  const knownStartDate = knownStartMonth ? `${knownStartMonth}-01` : null;
  const clippedFrom = knownStartDate && knownStartDate > from ? knownStartDate : from;
  const monthKeys = monthsInRange(clippedFrom, to, order);
  const byKey = new Map(year.months.map(m => [m.key, m]));
  return monthKeys.map(key => byKey.get(key) ?? { key, label: raceMonthLabel(`${key}-01T00:00:00`), items: [], days: [] });
}

// Loading state for one calendar month's own races — each expanded month
// paginates completely independently of every other month (see
// loadMonthPage). Years are pure rollup/grouping now, not an independent
// fetch unit — see the isp-month-direct-load history (a year-level "page
// 1" fetch could land in whichever month happened to have the earliest
// matching race, e.g. July for a Jan-Dec filter, instead of the filter's
// own literal first month). `total` is null until the first page for
// this month has actually been fetched (see monthCountLabel — that's
// what distinguishes "haven't checked yet" from "checked, and there are
// genuinely none").
interface RangeLoadState {
  races: IspRace[];
  page: number;
  total: number | null;
  isLoading: boolean;
  error: boolean;
}

// Clips `year`'s own Jan1->Dec31 span to the filter's actual effective
// range — e.g. a filter of 2024-06-01 -> 2025-03-01 shouldn't let 2024's
// "own" span reach back to 2024-01-01, or 2025's reach past 2025-03-01.
// Plain string min/max is safe here since every value involved is a bare
// "YYYY-MM-DD" (the API appends the end-of-day time suffix server-side —
// see parseDateRangeParams — so this never needs to reason about times).
function yearBounds(year: string, effectiveMinDate: string, effectiveMaxDate: string): { from: string; to: string } {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  return {
    from: yearStart > effectiveMinDate ? yearStart : effectiveMinDate,
    to: yearEnd < effectiveMaxDate ? yearEnd : effectiveMaxDate,
  };
}

// Same idea, one level down — clips `monthKey`'s ("YYYY-MM") own 1st-to-
// last-day span to the filter's actual effective range.
function monthBounds(monthKey: string, effectiveMinDate: string, effectiveMaxDate: string): { from: string; to: string } {
  const [yearStr, monthStr] = monthKey.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr); // 1-12
  const monthStart = `${monthKey}-01`;
  // Date's own month arg is 0-indexed, so passing the 1-indexed `month`
  // straight through with day 0 lands on the day before that month's own
  // 1st in Date's indexing — i.e. `monthKey`'s real last day.
  const lastDay = new Date(year, month, 0).getDate();
  const monthEnd = `${monthKey}-${String(lastDay).padStart(2, "0")}`;
  return {
    from: monthStart > effectiveMinDate ? monthStart : effectiveMinDate,
    to: monthEnd < effectiveMaxDate ? monthEnd : effectiveMaxDate,
  };
}

interface IspRacesScreenProps {
  navigate: (to: Route, query?: string) => void;
  isAuthenticated: boolean;
  onLogout?: () => void;
  onRequestAuth?: () => void;
  onBack: () => void;
  onNavigateToMeeting: (meetingId: string) => void;
  onNavigateToRace: (raceId: number) => void;
  onNavigateToRunner: (raceId: number, runnerId: number) => void;
  onNavigateToTrainer: (trainer: string, formCategory: "Flat" | "Jumps") => void;
}

// A read-only view of whatever filters were applied on the Industry SP
// filters screen (/isp) — it reads the committed filter values straight out
// of the URL rather than offering its own editing UI.
export const IspRacesScreen: React.FC<IspRacesScreenProps> = ({
  navigate,
  isAuthenticated,
  onLogout,
  onRequestAuth,
  onBack,
  onNavigateToMeeting,
  onNavigateToRace,
  onNavigateToRunner,
  onNavigateToTrainer,
}) => {
  // Every expanded month owns its own races/page/total, loaded via its own
  // small paginated request (see loadMonthPage) — there is no single flat
  // "all loaded races" list or cursor anymore, and years have no fetch
  // state of their own (they're pure rollup/grouping — see yearCountLabel).
  // The rendered race list (visibleRaces below) is just the union of
  // whatever months currently have state.
  const [monthStates, setMonthStates] = useState<Record<string, RangeLoadState>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalRaces, setTotalRaces] = useState(0);
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">(() => urlSortParam());
  const [oddsMode, setOddsMode] = useState<OddsMode>("fraction");
  // Every year header renders immediately from the filter's own date range
  // (see yearKeys below), long before any race data for most of them has
  // loaded — only whichever year(s) page 1 actually landed in start
  // expanded (set once the mount fetch resolves, see the mount/sortOrder
  // effect below — NOT statically computed from yearKeys[0] here, since
  // with an unbounded filter yearKeys starts at ABSOLUTE_MIN_DATE's year,
  // which for real data is typically nowhere near where the real results
  // actually are). Within an expanded year, only its own literal first
  // month (per the filter's effective range, not wherever real data
  // happens to start) is expanded+loaded by default — see
  // expandYearDefaultMonth. Every other year/month starts collapsed until
  // the user taps it (or "Expand All"), which triggers loadMonthPage.
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(new Set());
  // Years whose default-first-month expansion has already run — makes
  // expandYearDefaultMonth idempotent, so re-collapsing/re-expanding a
  // year the user has already interacted with doesn't reset which
  // month(s) they'd already opened or refire that first fetch.
  const [initializedYears, setInitializedYears] = useState<Set<string>>(new Set());
  // Earliest month key ("YYYY-MM") each year's own row-ranged data has
  // actually been confirmed to start in, once expandYearDefaultMonth's
  // probe resolves — a row range (Split A/B) doesn't necessarily start
  // at a year's own January, so every month strictly before this one is
  // provably impossible for the current filter, not just unloaded (see
  // mergeMonthPlaceholders). Absent until the year has been probed at
  // least once, during which every month in the year still renders as a
  // placeholder — the generous default until the real bound is known.
  const [yearDataStartMonth, setYearDataStartMonth] = useState<Record<string, string>>({});

  const minRunners = urlIntParam("minRunners", 1);
  const maxRunners = urlIntParam("maxRunners", 20);
  const fromRow = urlIntParam("fromRow", 1);
  const toRow = urlToRowParam();
  const minIsp = urlFloatParam("minIsp", 1);
  const maxIsp = urlFloatParam("maxIsp", 1000);
  const minRunnersInRange = urlIntParam("minInIspRange", 1);
  const maxRunnersInRange = urlIntParam("maxInIspRange", 30);
  const minDate = urlStringParam("minDate", "");
  const maxDate = urlStringParam("maxDate", "");
  const countries = [...urlCountriesParam()];
  const courses = [...urlSetParam("courses")];
  const goings = [...urlSetParam("goings")];
  const raceClasses = [...urlSetParam("raceClasses")];
  const raceTypes = [...urlSetParam("raceTypes")];
  const trainer = urlStringParam("trainer", "") || undefined;
  const jockey = urlStringParam("jockey", "") || undefined;
  // "Has trainer form" (IndustrySpScreen) only writes hasTrainerForm=true to
  // the URL, not the raw minTrainerFormRunners/maxTrainerFormRunners the API
  // actually takes — this screen derives them itself rather than reading
  // stale param names, the same way applyFilter() does on that screen.
  const trainerFormMinWinRate = urlFloatParam("trainerFormMinWinRate", 0);
  const hasTrainerForm = urlStringParam("hasTrainerForm", "") === "true";
  const minTrainerFormRunners = hasTrainerForm ? 1 : 0;
  const maxTrainerFormRunners = 100;
  const minModelWinProbability = urlFloatParam("minModelWinProbability", 0);
  const onlyModelBeatsSp = urlStringParam("onlyModelBeatsSp", "") === "true";

  // Absent minDate/maxDate means "unbounded" (see IspRacesScreen's own
  // fallback of "" — deliberately not FILTER_DEFAULTS' arbitrary
  // convenience default, see the isp-date-filter-lost-on-default-match
  // fix) — falling back to the dataset's true absolute bounds here still
  // gives a full, correct year list (e.g. 2015-2026) to render placeholder
  // headers for, rather than an empty one.
  const effectiveMinDate = minDate || ABSOLUTE_MIN_DATE;
  const effectiveMaxDate = maxDate || ABSOLUTE_MAX_DATE;
  const yearKeys = yearsInRange(effectiveMinDate, effectiveMaxDate, sortOrder);

  useEffect(() => {
    updateUrlParams({ sort: sortOrder !== "asc" ? sortOrder : undefined });
  }, [sortOrder]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setError(null);
      setMonthStates({});
      setInitializedYears(new Set());
      setYearDataStartMonth({});
      try {
        // A small, unscoped probe — page 1 of the row-ranged sequence with
        // no sub-date range — purely to learn the grand total (for the
        // header) and which year(s) real data actually starts in. A single
        // 20-race page usually lands entirely within one year, but not
        // always (a filter matching few races near a year boundary can
        // genuinely span two) — every year actually present gets expanded,
        // not just the first race's year, or a real race that did load
        // would end up invisible under a collapsed year header. Not used
        // to seed any month's own races directly: yearKeys[0] can't be
        // trusted for this (see above), and this probe's own `total` is
        // the *grand* total across the whole row range, not any single
        // month's — the year(s) present still get their own default first
        // month loaded below, the same way every other year does when
        // tapped (see expandYearDefaultMonth) — deliberately NOT whichever
        // month this probe's data happens to fall in, since that's driven
        // by wherever the earliest *matching* race is, not the filter's
        // own literal start (e.g. a Jan-Dec 2024 filter whose earliest
        // qualifying race happens to be in July doesn't mean January isn't
        // still the natural place a user expects to land).
        const probe = await chatApi.getIndustrySp(1, PAGE_SIZE, minRunners, maxRunners, countries, minIsp, maxIsp, sortOrder, minRunnersInRange, maxRunnersInRange, fromRow, toRow ?? undefined, minDate || undefined, maxDate || undefined, courses, goings, raceClasses, raceTypes, trainer, jockey, trainerFormMinWinRate, minTrainerFormRunners, maxTrainerFormRunners, undefined, minModelWinProbability, onlyModelBeatsSp);
        if (cancelled) return;
        setTotalRaces(probe.total);
        if (probe.data.length === 0) {
          setCollapsedKeys(new Set());
          setIsLoading(false);
          return;
        }
        const startYears = new Set(probe.data.map(r => raceYearKey(r.raceTime)));
        setCollapsedKeys(new Set(yearKeys.filter(y => !startYears.has(y)).map(y => `year:${y}`)));
        setIsLoading(false);
        for (const y of startYears) expandYearDefaultMonth(y);
      } catch {
        if (!cancelled) {
          setError("Failed to load races");
          setIsLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Filter values are read once from the URL on mount — this screen has no
    // editing UI of its own, so only sortOrder (its one interactive control)
    // needs to retrigger the fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortOrder]);

  // Fetches the next page of exactly one calendar month's own races —
  // scoped via subMinDate/subMaxDate (see chatApi.getIndustrySp/the DAO)
  // to (the filter's row range) ∩ (this month), so it pages independently
  // of every other month rather than needing to walk through them first.
  // Called for a month's very first page when it's tapped open (see
  // toggleNode) and again for each subsequent page via that month's own
  // "Load more" button — the exact same function either way, the same way
  // expandYearDefaultMonth uses it for whichever month starts expanded.
  async function loadMonthPage(monthKey: string) {
    const state = monthStates[monthKey];
    if (state?.isLoading) return;
    if (state && state.total != null && state.races.length >= state.total) return;
    const nextPage = (state?.page ?? 0) + 1;
    setMonthStates(prev => ({
      ...prev,
      [monthKey]: { races: prev[monthKey]?.races ?? [], page: prev[monthKey]?.page ?? 0, total: prev[monthKey]?.total ?? null, isLoading: true, error: false },
    }));
    try {
      const { from, to } = monthBounds(monthKey, effectiveMinDate, effectiveMaxDate);
      const result = await chatApi.getIndustrySp(nextPage, PAGE_SIZE, minRunners, maxRunners, countries, minIsp, maxIsp, sortOrder, minRunnersInRange, maxRunnersInRange, fromRow, toRow ?? undefined, minDate || undefined, maxDate || undefined, courses, goings, raceClasses, raceTypes, trainer, jockey, trainerFormMinWinRate, minTrainerFormRunners, maxTrainerFormRunners, undefined, minModelWinProbability, onlyModelBeatsSp, undefined, from, to);
      setMonthStates(prev => {
        const prevRaces = prev[monthKey]?.races ?? [];
        const seen = new Set(prevRaces.map(r => r.raceId));
        const newRaces = result.data.filter(r => !seen.has(r.raceId));
        return { ...prev, [monthKey]: { races: [...prevRaces, ...newRaces], page: nextPage, total: result.total, isLoading: false, error: false } };
      });
    } catch {
      setMonthStates(prev => ({
        ...prev,
        [monthKey]: { races: prev[monthKey]?.races ?? [], page: prev[monthKey]?.page ?? 0, total: prev[monthKey]?.total ?? null, isLoading: false, error: true },
      }));
    }
  }

  // Expands+loads whichever month(s) a year's own row-ranged data
  // actually starts in, and collapses every other month in that year.
  // Deliberately data-driven, NOT "always the calendar's own January" —
  // a row range (Split A/B) doesn't necessarily start at a year's own
  // Jan 1st; it starts wherever its own fromRow lands chronologically,
  // which could genuinely be July (or later) with zero possible races
  // before that point for *this* split specifically. Probes this year's
  // row-ranged window with no sub-month restriction — the real backend
  // returns whichever races are chronologically first within it, telling
  // us where to land, the same way the outer mount effect's own probe
  // finds which year to land in. Used both by the mount effect (for
  // whichever year the initial probe lands in) and by toggleNode (the
  // first time a user expands any other year). Idempotent via
  // initializedYears — re-collapsing/re-expanding a year already
  // interacted with doesn't reset its months or refire this probe.
  async function expandYearDefaultMonth(year: string) {
    if (initializedYears.has(year)) return;
    setInitializedYears(prev => new Set(prev).add(year));
    const { from, to } = yearBounds(year, effectiveMinDate, effectiveMaxDate);
    try {
      const probe = await chatApi.getIndustrySp(1, PAGE_SIZE, minRunners, maxRunners, countries, minIsp, maxIsp, sortOrder, minRunnersInRange, maxRunnersInRange, fromRow, toRow ?? undefined, minDate || undefined, maxDate || undefined, courses, goings, raceClasses, raceTypes, trainer, jockey, trainerFormMinWinRate, minTrainerFormRunners, maxTrainerFormRunners, undefined, minModelWinProbability, onlyModelBeatsSp, undefined, from, to);
      if (probe.data.length === 0) return;
      const startMonths = new Set(probe.data.map(r => raceMonthKey(r.raceTime)));
      // Every month strictly before the earliest one actually present is
      // provably impossible for this row range, not just "not loaded
      // yet" — records this so mergeMonthPlaceholders can stop rendering
      // a header for it at all (see its own comment).
      const earliestStartMonth = [...startMonths].sort()[0];
      setYearDataStartMonth(prev => ({ ...prev, [year]: earliestStartMonth }));
      const months = monthsInRange(from, to, sortOrder);
      setCollapsedKeys(prev => {
        const next = new Set(prev);
        for (const m of months) {
          if (startMonths.has(m)) next.delete(`month:${m}`);
          else next.add(`month:${m}`);
        }
        return next;
      });
      for (const m of startMonths) loadMonthPage(m);
    } catch {
      // Allow a retry on the next tap rather than leaving this year
      // permanently stuck showing every month as unloaded.
      setInitializedYears(prev => {
        const next = new Set(prev);
        next.delete(year);
        return next;
      });
      setError("Failed to load races");
    }
  }

  // With "Has trainer form" (or the model win-probability threshold) active,
  // the backend only guarantees a race has *at least one* qualifying runner
  // for each filter independently — it still returns every runner in the
  // race, most of which typically won't themselves qualify. Narrowing to
  // just the qualifying ones here (rather than showing the full field) is
  // what actually delivers "only see horses that have recent trainer form
  // available" (or a high model win probability), not just "races
  // containing such a horse somewhere". When both filters are active at
  // once, a runner must satisfy both to display — a rare edge case where a
  // matching race could show zero runners if no single runner satisfies
  // both independently-satisfied thresholds, but that's a predictable,
  // correct outcome rather than silently ignoring one filter.
  function qualifyingRunners(race: IspRace): IspRunner[] {
    return race.runners.filter(r => {
      if (hasTrainerForm && !(r.trainerFormWinRate != null && r.trainerFormWinRate >= trainerFormMinWinRate)) {
        return false;
      }
      if (minModelWinProbability > 0 && !(r.modelWinProbability != null && r.modelWinProbability >= minModelWinProbability)) {
        return false;
      }
      if (onlyModelBeatsSp && !modelBeatsSp(r)) {
        return false;
      }
      return true;
    });
  }

  // The union of every month's own independently-loaded races — there's no
  // single flat list/cursor anymore (see monthStates/loadMonthPage above).
  // Deduped by raceId globally (not just within a single month's own
  // fetch — loadMonthPage's own dedup only ever sees that one month's
  // prior races), a defensive check against the backend ever returning a
  // race under more than one month's sub-date range (e.g. a boundary
  // case, or multiple months' fetches racing when a single page-1 spans
  // more than one calendar month).
  const races = (() => {
    const seen = new Set<number>();
    const result: IspRace[] = [];
    for (const state of Object.values(monthStates)) {
      for (const race of state.races) {
        if (!seen.has(race.raceId)) {
          seen.add(race.raceId);
          result.push(race);
        }
      }
    }
    return result;
  })();
  const visibleRaces = races.filter(race => qualifyingRunners(race).length > 0);
  const visibleRunners = visibleRaces.reduce((sum, r) => sum + qualifyingRunners(r).length, 0);

  // yearKeys (the filter's full possible year range) always wins over
  // whatever years happen to already have loaded data — a year with zero
  // races loaded so far still gets a header, just an empty/placeholder one
  // (see mergeYearPlaceholders), so the user can see and tap it instead of
  // it silently not existing until the pagination cursor happens to reach it.
  const hierarchy = mergeYearPlaceholders(buildRaceHierarchy(visibleRaces), yearKeys).map(year => ({
    ...year,
    months: mergeMonthPlaceholders(year, effectiveMinDate, effectiveMaxDate, sortOrder, yearDataStartMonth[year.key]),
  }));
  const allNodeKeys = collectHierarchyNodeKeys(hierarchy);
  const isAllCollapsed = allNodeKeys.length > 0 && allNodeKeys.every(k => collapsedKeys.has(k));

  function toggleNode(key: string) {
    const wasCollapsed = collapsedKeys.has(key);
    setCollapsedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
    if (key.startsWith("year:")) {
      // Expanding a year for the first time loads (and expands) just its
      // own first month — see expandYearDefaultMonth. A no-op on repeat
      // taps of an already-interacted-with year (idempotent via
      // initializedYears), so it never resets whichever months the user
      // has already opened individually.
      if (wasCollapsed) expandYearDefaultMonth(key.slice("year:".length));
    } else if (key.startsWith("month:")) {
      const monthKey = key.slice("month:".length);
      // Retry on a re-tap too, not just the first expand — otherwise a
      // failed fetch needs two taps (collapse, then re-expand) before
      // loadMonthPage's own guard lets a retry through again.
      if (wasCollapsed || monthStates[monthKey]?.error) {
        loadMonthPage(monthKey);
      }
    }
  }

  function toggleCollapseAll() {
    if (isAllCollapsed) {
      setCollapsedKeys(new Set());
      // Every not-yet-interacted-with year gets its own default first
      // month loaded — same as tapping each individually, just fired
      // together (a no-op for years already initialized, so months the
      // user already opened by hand are left exactly as they were).
      for (const year of yearKeys) {
        expandYearDefaultMonth(year);
      }
    } else {
      setCollapsedKeys(new Set(allNodeKeys));
    }
  }

  // Same staking math as the per-race P&L badge (ispFormat.computeRangePnl),
  // rolled up over every qualifying runner across a whole year/month/day/
  // meeting's races — reuses qualifyingRunners so a group total always
  // matches the sum of the individual race/runner rows rendered under it.
  // Deliberately NOT `computeRangePnl(races.map(race => ({ ...race,
  // runners: qualifyingRunners(race) })))` — that allocates a new race
  // object (plus a new filtered runners array) for every single race,
  // just to hand them to a function that immediately iterates and
  // discards them. Every hierarchy level's header (year/month/day/
  // meeting) calls this on every render, including collapsed ones —
  // their rows aren't rendered, but their P&L badge still needs a real
  // number — so at a few thousand loaded races this allocation churn
  // alone was a measurable chunk of the total cost confirmed via the
  // isp-year-walk-render-cost prod-repro script (still 16-20s live even
  // after collapsing the non-target year stopped DOM rendering from
  // being the bottleneck). Same staking math as computeRangePnl, just
  // iterating in place instead of building throwaway intermediates.
  function groupPnl(races: IspRace[]) {
    let staked = 0, returns = 0, count = 0;
    for (const race of races) {
      for (const runner of qualifyingRunners(race)) {
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

  // Years no longer have their own fetch state — a year's count is purely
  // a rollup of its own months' state. "Tap to load" only once every
  // month in range has genuinely never been touched; if any month is
  // still loading, say so; once every month's been checked (loaded or
  // confirmed empty) with nothing to show, it's a real "0 races".
  function yearCountLabel(year: YearNode<IspRace>): string {
    if (year.items.length > 0) return `${year.items.length} races`;
    const states = year.months.map(m => monthStates[m.key]);
    if (states.some(s => s?.isLoading)) return "Loading…";
    if (states.every(s => s === undefined)) return "Tap to load";
    return "0 races";
  }

  // A placeholder month (no races loaded for it yet) is ambiguous the same
  // way a placeholder year used to be — it could mean "never tapped" or
  // "checked, and there's genuinely nothing here". Each month now tracks
  // its own real fetch state directly (see monthStates/loadMonthPage),
  // the same way years used to before they became pure rollups.
  function monthCountLabel(month: MonthNode<IspRace>): string {
    if (month.items.length > 0) return `${month.items.length} races`;
    const state = monthStates[month.key];
    if (state?.isLoading) return "Loading…";
    // A failed fetch leaves state.total unset (see loadMonthPage's catch)
    // — check error before the generic "state exists" fallback below, or
    // a failure reads as "confirmed zero races" instead of "tap to retry".
    if (state?.error) return "Failed to load — tap to retry";
    if (state) return "0 races";
    return "Not loaded yet";
  }

  return (
    <SafeAreaView testID="industry-sp-races-screen" style={styles.screen}>
      <AppHeader
        navigate={navigate}
        isAuthenticated={isAuthenticated}
        onLogout={onLogout}
        onRequestAuth={onRequestAuth}
        onBack={onBack}
        subtitle={
          !isLoading
            ? `Races · ${visibleRunners} runners · ${visibleRaces.length}/${totalRaces} races`
            : "Races"
        }
        testIdPrefix="industry-sp-races"
      />

      <View testID="industry-sp-races-toolbar" style={styles.toolbar}>
        <Button
          testID="industry-sp-sort-toggle"
          mode="contained-tonal"
          compact
          onPress={() => setSortOrder(o => (o === "asc" ? "desc" : "asc"))}
          style={styles.toolbarButton}
          labelStyle={styles.toolbarButtonLabel}
        >
          {sortOrder === "asc" ? "First → Last" : "Last → First"}
        </Button>
        <Button
          testID="industry-sp-odds-mode-toggle"
          mode="outlined"
          compact
          onPress={() => setOddsMode(m => (m === "fraction" ? "decimal" : "fraction"))}
          style={styles.toolbarButtonOutlined}
          labelStyle={styles.toolbarButtonOutlinedLabel}
        >
          {oddsMode === "fraction" ? "Odds: Fraction" : "Odds: Decimal"}
        </Button>
        <Button
          testID="industry-sp-collapse-all-toggle"
          mode="outlined"
          compact
          onPress={toggleCollapseAll}
          style={styles.toolbarButtonOutlined}
          labelStyle={styles.toolbarButtonOutlinedLabel}
        >
          {isAllCollapsed ? "Expand All" : "Collapse All"}
        </Button>
      </View>

      <View style={styles.body}>
        {isLoading && (
          <View testID="industry-sp-loading" style={styles.centered}>
            <ActivityIndicator size="large" animating color={colors.primary} />
            <Text variant="bodyMedium" style={styles.loadingText}>
              Loading races…
            </Text>
          </View>
        )}

        {error && !isLoading && (
          <View testID="industry-sp-error" style={styles.centered}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {!isLoading && !error && (
          <ScrollView testID="industry-sp-list" style={styles.list}>
          <PageContainer>
            {totalRaces === 0 && (
              <Text style={styles.emptyText}>No races found.</Text>
            )}
            {hierarchy.map(year => {
              const yearKey = `year:${year.key}`;
              const yearCollapsed = collapsedKeys.has(yearKey);
              const yearPnl = groupPnl(year.items);
              return (
                <View key={year.key} testID={`industry-sp-year-${year.key}`}>
                  <TouchableOpacity
                    testID={`industry-sp-year-toggle-${year.key}`}
                    style={styles.yearHeader}
                    onPress={() => toggleNode(yearKey)}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: !yearCollapsed }}
                  >
                    <Text style={[styles.groupChevron, styles.groupChevronLight]}>{yearCollapsed ? "▸" : "▾"}</Text>
                    <Text style={styles.yearLabel}>{year.key}</Text>
                    <Text testID={`industry-sp-year-count-${year.key}`} style={[styles.groupCount, styles.groupCountLight]}>
                      {yearCountLabel(year)}
                    </Text>
                    {yearPnl.staked > 0 && (
                      <Text testID={`industry-sp-year-pnl-${year.key}`} style={[styles.groupPnl, yearPnl.pnl >= 0 ? styles.pnlPos : styles.pnlNeg]}>
                        {formatPnl(yearPnl.pnl)} ({formatPct(yearPnl.pnl, yearPnl.staked)})
                      </Text>
                    )}
                  </TouchableOpacity>

                  {!yearCollapsed && (
                  <>
                  {year.months.map(month => {
                    const monthKey = `month:${month.key}`;
                    const monthCollapsed = collapsedKeys.has(monthKey);
                    const monthPnl = groupPnl(month.items);
                    return (
                      <View key={month.key} testID={`industry-sp-month-${month.key}`}>
                        <TouchableOpacity
                          testID={`industry-sp-month-toggle-${month.key}`}
                          style={styles.monthHeader}
                          onPress={() => toggleNode(monthKey)}
                          accessibilityRole="button"
                          accessibilityState={{ expanded: !monthCollapsed }}
                        >
                          <Text style={[styles.groupChevron, styles.groupChevronLight]}>{monthCollapsed ? "▸" : "▾"}</Text>
                          <Text style={styles.monthLabel}>{month.label}</Text>
                          <Text testID={`industry-sp-month-count-${month.key}`} style={[styles.groupCount, styles.groupCountLight]}>
                            {monthCountLabel(month)}
                          </Text>
                          {monthPnl.staked > 0 && (
                            <Text testID={`industry-sp-month-pnl-${month.key}`} style={[styles.groupPnl, monthPnl.pnl >= 0 ? styles.pnlPos : styles.pnlNeg]}>
                              {formatPnl(monthPnl.pnl)} ({formatPct(monthPnl.pnl, monthPnl.staked)})
                            </Text>
                          )}
                        </TouchableOpacity>

                        {!monthCollapsed && (
                        <>
                        {month.days.map(day => {
                          const dayKey = `day:${day.key}`;
                          const dayCollapsed = collapsedKeys.has(dayKey);
                          const dayPnl = groupPnl(day.items);
                          return (
                            <View key={day.key} testID={`industry-sp-day-${day.key}`}>
                              <TouchableOpacity
                                testID={`industry-sp-day-toggle-${day.key}`}
                                style={styles.dayHeader}
                                onPress={() => toggleNode(dayKey)}
                                accessibilityRole="button"
                                accessibilityState={{ expanded: !dayCollapsed }}
                              >
                                <Text style={styles.groupChevron}>{dayCollapsed ? "▸" : "▾"}</Text>
                                <Text style={styles.dayLabel}>{day.label}</Text>
                                <Text style={styles.groupCount}>{day.items.length} races</Text>
                                {dayPnl.staked > 0 && (
                                  <Text testID={`industry-sp-day-pnl-${day.key}`} style={[styles.groupPnl, dayPnl.pnl >= 0 ? styles.pnlPos : styles.pnlNeg]}>
                                    {formatPnl(dayPnl.pnl)} ({formatPct(dayPnl.pnl, dayPnl.staked)})
                                  </Text>
                                )}
                              </TouchableOpacity>

                              {!dayCollapsed && day.meetings.map(meeting => {
                                const meetingKey = `meeting:${meeting.meetingId}`;
                                const meetingCollapsed = collapsedKeys.has(meetingKey);
                                const meetingPnl = groupPnl(meeting.items);
                                return (
                                  <View key={meeting.meetingId} testID={`industry-sp-meeting-${meeting.meetingId}`}>
                                    <View style={styles.eventHeader}>
                                      <TouchableOpacity
                                        testID={`industry-sp-meeting-toggle-${meeting.meetingId}`}
                                        onPress={() => toggleNode(meetingKey)}
                                        accessibilityRole="button"
                                        accessibilityState={{ expanded: !meetingCollapsed }}
                                      >
                                        <Text style={styles.groupChevron}>{meetingCollapsed ? "▸" : "▾"}</Text>
                                      </TouchableOpacity>
                                      <TouchableOpacity
                                        testID={`industry-sp-meeting-link-${meeting.meetingId}`}
                                        onPress={() => onNavigateToMeeting(meeting.meetingId)}
                                      >
                                        <Text style={styles.eventName}>{meeting.label}</Text>
                                      </TouchableOpacity>
                                      <Text style={styles.groupCount}>{meeting.items.length} races</Text>
                                      {meetingPnl.staked > 0 && (
                                        <Text testID={`industry-sp-meeting-pnl-${meeting.meetingId}`} style={[styles.groupPnl, meetingPnl.pnl >= 0 ? styles.pnlPos : styles.pnlNeg]}>
                                          {formatPnl(meetingPnl.pnl)} ({formatPct(meetingPnl.pnl, meetingPnl.staked)})
                                        </Text>
                                      )}
                                    </View>
                                    {!meetingCollapsed && meeting.items.map(race => (
                                      <View key={race.raceId}>
                                        <TouchableOpacity
                                          testID={`industry-sp-race-${race.raceId}`}
                                          style={styles.raceHeader}
                                          onPress={() => onNavigateToRace(race.raceId)}
                                        >
                                          <Text style={styles.raceTime}>{formatRaceTime(race.raceTime)}</Text>
                                          <Text style={styles.raceType}>{race.raceType}</Text>
                                          <Text style={styles.raceCount}>{qualifyingRunners(race).length} runners</Text>
                                          {(() => {
                                            const rp = computeRangePnl([{ ...race, runners: qualifyingRunners(race) }]);
                                            if (rp.staked === 0) return null;
                                            return (
                                              <Text style={[styles.racePnl, rp.pnl >= 0 ? styles.pnlPos : styles.pnlNeg]}>
                                                {formatPnl(rp.pnl)} ({formatPct(rp.pnl, rp.staked)})
                                              </Text>
                                            );
                                          })()}
                                        </TouchableOpacity>
                                        {qualifyingRunners(race).map((runner: IspRunner) => (
                                          <TouchableOpacity
                                            key={runner.id}
                                            testID={`industry-sp-item-${runner.id}`}
                                            style={styles.runnerRow}
                                            onPress={() => onNavigateToRunner(race.raceId, runner.id)}
                                          >
                                            <Text style={styles.priority}>{runner.sortPriority}.</Text>
                                            <Text testID={`industry-sp-item-name-${runner.id}`} style={styles.runnerName} numberOfLines={1}>
                                              {runner.name}
                                            </Text>
                                            {runner.isp != null && (
                                              <Text testID={`industry-sp-isp-${runner.id}`} style={styles.bspBadge}>
                                                ISP {formatIsp(runner, oddsMode)}
                                              </Text>
                                            )}
                                            {runner.isp != null && (
                                              <Text testID={`industry-sp-stake-${runner.id}`} style={styles.stakeBadge}>
                                                Bet {formatGbp(stakeToWin1(runner.isp))}
                                              </Text>
                                            )}
                                            {runnerPnl(runner) != null && (
                                              <Text
                                                testID={`industry-sp-pnl-item-${runner.id}`}
                                                style={[styles.runnerPnl, runnerPnl(runner)! >= 0 ? styles.pnlPos : styles.pnlNeg]}
                                              >
                                                {formatPnl(runnerPnl(runner)!)}
                                              </Text>
                                            )}
                                            {runner.trainer && (
                                              <TouchableOpacity
                                                onPress={(e) => { e.stopPropagation(); onNavigateToTrainer(runner.trainer!, toFormCategory(race.raceType)); }}
                                              >
                                                <Text testID={`industry-sp-item-trainer-${runner.id}`} style={styles.trainerBadge} numberOfLines={1}>
                                                  {runner.trainer}
                                                  {runner.trainerFormRuns != null && runner.trainerFormRuns > 0 && runner.trainerFormWinRate != null && (
                                                    <Text testID={`industry-sp-item-trainer-form-${runner.id}`} style={styles.trainerFormBadge}>
                                                      {` · ${runner.trainerFormWins}/${runner.trainerFormRuns} · ${runner.trainerFormWinRate.toFixed(0)}%`}
                                                    </Text>
                                                  )}
                                                </Text>
                                              </TouchableOpacity>
                                            )}
                                            {runner.modelWinProbability != null && (
                                              <Text testID={`industry-sp-item-model-${runner.id}`} style={styles.modelBadge}>
                                                Model {runner.modelWinProbability.toFixed(0)}%
                                                {runner.isp != null && runner.isp > 0 && (
                                                  <Text testID={`industry-sp-item-implied-sp-${runner.id}`} style={styles.impliedSpBadge}>
                                                    {` · SP ${impliedProbabilityPct(runner.isp).toFixed(0)}%`}
                                                  </Text>
                                                )}
                                              </Text>
                                            )}
                                            {modelBeatsSp(runner) && (
                                              <Text testID={`industry-sp-item-value-${runner.id}`} style={styles.valueBadge}>
                                                Value
                                              </Text>
                                            )}
                                            <View
                                              style={[
                                                styles.statusBadge,
                                                {
                                                  backgroundColor:
                                                    (statusPill[runner.status] ?? statusPill.HIDDEN).bg,
                                                },
                                              ]}
                                            >
                                              <Text
                                                style={[
                                                  styles.statusText,
                                                  { color: (statusPill[runner.status] ?? statusPill.HIDDEN).fg },
                                                ]}
                                              >
                                                {runner.status}
                                              </Text>
                                            </View>
                                          </TouchableOpacity>
                                        ))}
                                      </View>
                                    ))}
                                  </View>
                                );
                              })}
                            </View>
                          );
                        })}
                        {(() => {
                          // This month's own "Load more" — the same
                          // mechanism that loaded its first page
                          // (loadMonthPage), just requesting the next one.
                          // Independent of every other expanded month's
                          // own state.
                          const state = monthStates[month.key];
                          if (!state || state.total == null || state.races.length >= state.total) return null;
                          return (
                            <Button
                              testID={`industry-sp-month-load-more-${month.key}`}
                              mode="contained-tonal"
                              onPress={() => loadMonthPage(month.key)}
                              disabled={state.isLoading}
                              loading={state.isLoading}
                              style={styles.loadMoreButton}
                            >
                              Load more {month.label} ({state.total - state.races.length} remaining)
                            </Button>
                          );
                        })()}
                        </>
                        )}
                      </View>
                    );
                  })}
                  </>
                  )}
                </View>
              );
            })}
          </PageContainer>
          </ScrollView>
        )}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  toolbar: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  toolbarButton: {
    borderRadius: radii.sm,
  },
  toolbarButtonLabel: {
    fontSize: 12,
    fontWeight: "700",
  },
  toolbarButtonOutlined: {
    borderRadius: radii.sm,
    borderColor: colors.primary,
  },
  toolbarButtonOutlinedLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.primary,
  },
  body: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xxl,
    gap: spacing.md,
  },
  loadingText: {
    color: colors.textSecondary,
  },
  errorText: {
    color: colors.danger,
    fontSize: 16,
  },
  list: {
    flex: 1,
    ...({ overscrollBehavior: "contain" } as any),
  },
  emptyText: {
    padding: spacing.xl,
    color: colors.textTertiary,
    fontSize: 16,
    textAlign: "center",
  },
  yearHeader: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.text,
    gap: spacing.sm,
  },
  yearLabel: {
    fontSize: 16,
    fontWeight: "700",
    color: "#fff",
  },
  monthHeader: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md - 2,
    backgroundColor: colors.accent,
    gap: spacing.sm,
  },
  monthLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: "#fff",
  },
  dayHeader: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  dayLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.text,
  },
  groupChevron: {
    fontSize: 12,
    color: colors.textSecondary,
    width: 14,
  },
  groupChevronLight: {
    color: "rgba(255,255,255,0.8)",
  },
  groupCount: {
    fontSize: 11,
    color: colors.textTertiary,
    marginLeft: "auto",
  },
  groupCountLight: {
    color: "rgba(255,255,255,0.7)",
  },
  groupPnl: {
    fontSize: 11,
    fontWeight: "700",
    marginLeft: spacing.sm,
  },
  eventHeader: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md - 2,
    backgroundColor: colors.primaryLight,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  eventName: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.accent,
  },
  raceHeader: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    paddingHorizontal: spacing.lg,
    paddingVertical: 6,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  raceTime: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.text,
  },
  raceType: {
    fontSize: 11,
    color: colors.textSecondary,
    backgroundColor: colors.surface,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: radii.sm,
  },
  raceCount: {
    fontSize: 11,
    color: colors.textTertiary,
    marginLeft: "auto",
  },
  racePnl: {
    fontSize: 11,
    fontWeight: "700",
    marginLeft: spacing.sm,
  },
  runnerRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    rowGap: 4,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  priority: {
    fontSize: 12,
    color: colors.textTertiary,
    width: 22,
  },
  // Deliberately not flex:1 — in a flexWrap row, a flex-grow item gets
  // squeezed toward minWidth (effectively invisible) as more badges are
  // added to the same row, rather than wrapping itself; a fixed maxWidth
  // (matching trainerBadge's own cap) makes it wrap as a whole instead.
  // Deliberately not flex:1 — in a flexWrap row, a flex-grow item gets
  // squeezed toward minWidth (effectively invisible) as more badges are
  // added to the same row, rather than wrapping itself; a fixed maxWidth
  // (matching trainerBadge's own cap) makes it wrap as a whole instead.
  runnerName: {
    fontSize: 13,
    fontWeight: "500",
    color: colors.text,
    maxWidth: 160,
    marginRight: spacing.sm,
  },
  statusBadge: {
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  statusText: {
    fontSize: 10,
    fontWeight: "600",
  },
  loadMoreButton: {
    margin: spacing.lg,
    borderRadius: radii.md,
  },
  bspBadge: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.accent,
    backgroundColor: colors.primaryLight,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: radii.sm,
    marginRight: spacing.sm,
  },
  stakeBadge: {
    fontSize: 11,
    color: colors.textSecondary,
    backgroundColor: colors.background,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: radii.sm,
    marginRight: spacing.sm,
  },
  runnerPnl: {
    fontSize: 12,
    fontWeight: "700",
    marginRight: spacing.sm,
  },
  trainerBadge: {
    fontSize: 11,
    color: colors.textSecondary,
    marginRight: spacing.sm,
    maxWidth: 160,
  },
  trainerFormBadge: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.textTertiary,
  },
  modelBadge: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.accent,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: radii.sm,
    marginRight: spacing.sm,
  },
  impliedSpBadge: {
    fontWeight: "500",
    color: colors.textTertiary,
  },
  valueBadge: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.success,
    backgroundColor: colors.successLight,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: radii.sm,
    marginRight: spacing.sm,
  },
  pnlPos: {
    color: colors.pnlPositive,
  },
  pnlNeg: {
    color: colors.pnlNegative,
  },
});
