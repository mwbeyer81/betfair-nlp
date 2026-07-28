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
  yearsInRange,
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
import { buildHierarchy, collectHierarchyNodeKeys, YearNode } from "../utils/raceHierarchy";

const PAGE_SIZE = 20;

// The largest single batch ensureYearLoaded's doubling walk will ever
// request — see its own comment for why: past this, a single request's
// $facet-packed result risks exceeding MongoDB's 16MB document limit.
// Comfortably under the ~2400-2560 failure threshold measured live, and
// under the router's own defensive 2000 clamp on `limit`.
const MAX_WALK_BATCH = 1000;

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
// immediately (see ensureYearLoaded), rather than only years reachable by
// however far the paginated cursor happens to have advanced.
function mergeYearPlaceholders(hierarchy: YearNode<IspRace>[], yearKeys: string[]): YearNode<IspRace>[] {
  const byKey = new Map(hierarchy.map(y => [y.key, y]));
  return yearKeys.map(key => byKey.get(key) ?? { key, items: [], months: [] });
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
  const [races, setRaces] = useState<IspRace[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  // Which year a background "keep paging until we reach it" walk is
  // currently chasing (see ensureYearLoaded) — null when idle. Distinct
  // from isLoadingMore so the two loading affordances (the manual "Load
  // more" button vs. a year header you just tapped) don't fight over the
  // same in-flight guard.
  const [isJumpingToYear, setIsJumpingToYear] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalRaces, setTotalRaces] = useState(0);
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">(() => urlSortParam());
  const [oddsMode, setOddsMode] = useState<OddsMode>("fraction");
  // Every year header renders immediately from the filter's own date range
  // (see yearKeys below), long before any race data for most of them has
  // loaded — only whichever year(s) page 1 actually landed in start
  // expanded (set once that fetch resolves, see the mount/sortOrder effect
  // below — NOT statically computed from yearKeys[0] here, since with an
  // unbounded filter yearKeys starts at ABSOLUTE_MIN_DATE's year, which for
  // real data is typically nowhere near where the real results actually
  // are). Every other year starts collapsed until the user taps it (or
  // "Expand All"), which triggers ensureYearLoaded to page forward until
  // real data for it arrives.
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(new Set());

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
      setRaces([]);
      try {
        const result = await chatApi.getIndustrySp(1, PAGE_SIZE, minRunners, maxRunners, countries, minIsp, maxIsp, sortOrder, minRunnersInRange, maxRunnersInRange, fromRow, toRow ?? undefined, minDate || undefined, maxDate || undefined, courses, goings, raceClasses, raceTypes, trainer, jockey, trainerFormMinWinRate, minTrainerFormRunners, maxTrainerFormRunners, undefined, minModelWinProbability, onlyModelBeatsSp);
        if (cancelled) return;
        setRaces(result.data);
        setPage(1);
        setTotalPages(result.totalPages);
        setTotalRaces(result.total);
        // Expand whichever year(s) page 1 actually landed in (typically
        // just one) — collapse every other placeholder year in range. Set
        // from the real fetched data, not yearKeys[0], since with an
        // unbounded filter yearKeys starts at ABSOLUTE_MIN_DATE's year,
        // which is usually nowhere near where real results actually are.
        const loadedYears = new Set(result.data.map(r => raceYearKey(r.raceTime)));
        setCollapsedKeys(new Set(yearKeys.filter(y => !loadedYears.has(y)).map(y => `year:${y}`)));
      } catch {
        if (!cancelled) setError("Failed to load races");
      } finally {
        if (!cancelled) setIsLoading(false);
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

  // A walk (ensureYearLoaded) that stops mid-way can leave `races.length`
  // not perfectly aligned to a PAGE_SIZE boundary, since its own batches
  // double in size rather than staying fixed at 20 — deduping by raceId
  // on every append (here and in ensureYearLoaded) means a subsequent
  // fetch that re-covers a few already-loaded rows at that boundary just
  // no-ops on the overlap instead of rendering the same race twice.
  function appendRaces(prev: IspRace[], fetched: IspRace[]): IspRace[] {
    const seen = new Set(prev.map(r => r.raceId));
    return [...prev, ...fetched.filter(r => !seen.has(r.raceId))];
  }

  async function loadMore() {
    if (isLoadingMore || isJumpingToYear || races.length >= totalRaces) return;
    setIsLoadingMore(true);
    try {
      const next = page + 1;
      const result = await chatApi.getIndustrySp(next, PAGE_SIZE, minRunners, maxRunners, countries, minIsp, maxIsp, sortOrder, minRunnersInRange, maxRunnersInRange, fromRow, toRow ?? undefined, minDate || undefined, maxDate || undefined, courses, goings, raceClasses, raceTypes, trainer, jockey, trainerFormMinWinRate, minTrainerFormRunners, maxTrainerFormRunners, undefined, minModelWinProbability, onlyModelBeatsSp);
      setRaces(prev => appendRaces(prev, result.data));
      setPage(next);
      setTotalPages(result.totalPages);
    } catch {
      // silently ignore
    } finally {
      setIsLoadingMore(false);
    }
  }

  // Races arrive in a single date-ordered, row-ranged sequence (fromRow/
  // toRow — see the Split A/B feature on IndustrySpScreen — is a row-index
  // slice of *that whole ordered sequence*, not something that can be
  // independently intersected with a per-year date bound without changing
  // what the row numbers mean) — so "jump to year Y" can't be a targeted,
  // differently-scoped query. It has to walk the exact same paginated
  // cursor loadMore() advances, just automatically and repeatedly, until a
  // race actually in year Y appears. Any intervening year gets loaded as a
  // side effect of passing through it, which is why toggleCollapseAll only
  // ever needs to chase the *last* year, not every year individually.
  async function ensureYearLoaded(year: string) {
    if (isLoadingMore || isJumpingToYear) return;
    if (races.some(r => raceYearKey(r.raceTime) === year)) return;
    if (races.length === 0 || races.length >= totalRaces) return;
    setIsJumpingToYear(year);
    // Collapse every other year while this walks — the doubling batches
    // (20 -> 40 -> ... -> thousands) almost always land in whichever year
    // is already expanded (typically the default first year), and with
    // it expanded, each append forces React to reconcile/lay out its
    // entire, ever-growing race list. Confirmed live: with ~9500 races in
    // range and no other filters narrowing them, the fetches alone
    // resolved in ~9 requests / ~12s, but the last one still took ~8s
    // *after* its response arrived before the UI reflected it — pure
    // render cost, not network. Collapsing the source year means
    // buildRaceHierarchy still processes every loaded race each render
    // (cheap — plain array grouping), but the expensive part (rendering
    // thousands of nested race/runner rows) never happens until the user
    // actually re-expands that year afterward.
    setCollapsedKeys(prev => {
      const next = new Set(prev);
      for (const y of yearKeys) {
        if (y !== year) next.add(`year:${y}`);
      }
      return next;
    });
    try {
      let loaded = races.length;
      let found = false;
      while (loaded < totalRaces && !found) {
        // getIndustrySp(page, limit, ...) skips (page-1)*limit rows —
        // requesting page=2 at limit=`loaded` skips exactly the rows
        // already loaded and takes that many more, doubling the loaded set
        // each round trip (there's no dedicated "fetch from offset N"
        // endpoint, so this repurposes the existing page/limit pair rather
        // than adding one). Turns an O(totalRaces / 20) walk — one request
        // per 20 races, confirmed to need ~250 requests and still not
        // finish within 90s on a ~4900-race gap in the
        // isp-lazy-year-slow-walk prod-repro script — into an
        // O(log2(totalRaces / 20)) one, ~8-12 requests for the same gap.
        //
        // Capped at MAX_WALK_BATCH: getAllRacesByRace's $facet packs the
        // "data" page plus total/totalRunners/pnlStats into a single BSON
        // document, so an uncapped doubling limit eventually exceeds
        // MongoDB's 16MB single-document limit — confirmed live against
        // production data, a ~2560-race batch failed with
        // `BSONObjectTooLarge` (~20.5MB), 2400 succeeded. Once the desired
        // batch size would exceed the cap, `limit` pins at MAX_WALK_BATCH
        // instead of `loaded`, which decouples skip=(page-1)*limit from
        // `loaded` — `page` is chosen as the largest integer that keeps
        // skip <= loaded (never skipping/missing a race), and the small
        // resulting overlap with already-loaded races is trimmed off the
        // front of the response before appending.
        const batchLimit = Math.min(loaded, MAX_WALK_BATCH);
        const page = Math.floor(loaded / batchLimit) + 1;
        const skip = (page - 1) * batchLimit;
        const overlap = loaded - skip;
        const result = await chatApi.getIndustrySp(page, batchLimit, minRunners, maxRunners, countries, minIsp, maxIsp, sortOrder, minRunnersInRange, maxRunnersInRange, fromRow, toRow ?? undefined, minDate || undefined, maxDate || undefined, courses, goings, raceClasses, raceTypes, trainer, jockey, trainerFormMinWinRate, minTrainerFormRunners, maxTrainerFormRunners, undefined, minModelWinProbability, onlyModelBeatsSp);
        const newRaces = result.data.slice(overlap);
        if (newRaces.length === 0) break;
        setRaces(prev => appendRaces(prev, newRaces));
        loaded += newRaces.length;
        found = newRaces.some(r => raceYearKey(r.raceTime) === year);
      }
      // result.totalPages (above) is relative to whatever `limit` that
      // specific request used, which changes every iteration here — not
      // the fixed PAGE_SIZE the flat "Load more" cursor assumes. Compute
      // page/totalPages directly from real counts instead, so a manual
      // "Load more" click after a walk continues cleanly from here.
      setPage(Math.max(1, Math.floor(loaded / PAGE_SIZE)));
      setTotalPages(Math.max(1, Math.ceil(totalRaces / PAGE_SIZE)));
    } catch {
      setError("Failed to load races");
    } finally {
      setIsJumpingToYear(null);
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

  const visibleRaces = races.filter(race => qualifyingRunners(race).length > 0);
  const visibleRunners = visibleRaces.reduce((sum, r) => sum + qualifyingRunners(r).length, 0);

  // yearKeys (the filter's full possible year range) always wins over
  // whatever years happen to already have loaded data — a year with zero
  // races loaded so far still gets a header, just an empty/placeholder one
  // (see mergeYearPlaceholders), so the user can see and tap it instead of
  // it silently not existing until the pagination cursor happens to reach it.
  const hierarchy = mergeYearPlaceholders(buildRaceHierarchy(visibleRaces), yearKeys);
  const allNodeKeys = collectHierarchyNodeKeys(hierarchy);
  const isAllCollapsed = allNodeKeys.length > 0 && allNodeKeys.every(k => collapsedKeys.has(k));

  function toggleNode(key: string) {
    const wasCollapsed = collapsedKeys.has(key);
    setCollapsedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
    if (wasCollapsed && key.startsWith("year:")) {
      ensureYearLoaded(key.slice("year:".length));
    }
  }

  function toggleCollapseAll() {
    if (isAllCollapsed) {
      setCollapsedKeys(new Set());
      // Walking forward to the last year passes through (and so loads)
      // every year in between — no need to chase each one individually.
      const lastYear = yearKeys[yearKeys.length - 1];
      if (lastYear) ensureYearLoaded(lastYear);
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

  // A year header with zero loaded races is ambiguous on its own — it
  // could mean "confirmed no races here" or "just hasn't been reached by
  // the pagination cursor yet" (see ensureYearLoaded). Distinguishing them
  // is what makes the placeholder years worth rendering at all.
  function yearCountLabel(year: YearNode<IspRace>): string {
    if (year.items.length > 0) return `${year.items.length} races`;
    if (isJumpingToYear === year.key) return "Loading…";
    if (races.length >= totalRaces) return "0 races";
    return "Tap to load";
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

                  {!yearCollapsed && year.months.map(month => {
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
                          <Text style={[styles.groupCount, styles.groupCountLight]}>{month.items.length} races</Text>
                          {monthPnl.staked > 0 && (
                            <Text testID={`industry-sp-month-pnl-${month.key}`} style={[styles.groupPnl, monthPnl.pnl >= 0 ? styles.pnlPos : styles.pnlNeg]}>
                              {formatPnl(monthPnl.pnl)} ({formatPct(monthPnl.pnl, monthPnl.staked)})
                            </Text>
                          )}
                        </TouchableOpacity>

                        {!monthCollapsed && month.days.map(day => {
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
                      </View>
                    );
                  })}
                </View>
              );
            })}
            {races.length < totalRaces && (
              <Button
                testID="industry-sp-load-more"
                mode="contained-tonal"
                onPress={loadMore}
                disabled={isLoadingMore || isJumpingToYear !== null}
                loading={isLoadingMore}
                style={styles.loadMoreButton}
              >
                Load more ({totalRaces - races.length} remaining)
              </Button>
            )}
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
