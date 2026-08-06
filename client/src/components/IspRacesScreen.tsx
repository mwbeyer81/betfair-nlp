import React, { useState, useEffect } from "react";
import { View, ScrollView, TouchableOpacity, StyleSheet, SafeAreaView } from "react-native";
import { Text, Button, ActivityIndicator } from "react-native-paper";
import { chatApi, IspRace, IspRunner, BrierStats } from "../services/chatApi";
import { colors, statusPill, radii, spacing } from "../theme";
import { PageContainer } from "./PageContainer";
import { AppHeader } from "./AppHeader";
import { BrierScore } from "./BrierScore";
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
  raceDayKey,
  raceMonthLabel,
  yearsInRange,
  monthsInRange,
  daysInRange,
  formatRaceDate,
  toFormCategory,
  OddsMode,
  modelBeatsSp,
  modelBeatsSpBy,
  modelProb,
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
import { buildHierarchy, collectHierarchyNodeKeys, YearNode, MonthNode, DayNode } from "../utils/raceHierarchy";

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
// immediately (see loadYearDefaultMonth), rather than only years the
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
// `knownStartMonth` (set once loadYearDefaultMonth's probe resolves —
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

// And once more, one level down: an expanded month renders a header for every
// day it could contain, not just the days whose races happen to have loaded.
// The day is the fetch unit (see dayStates/loadDayPage), so an untouched day
// needs a row of its own to be tappable at all — otherwise expanding a month
// would show only the single day its default fetch landed in, and the rest of
// the month would look like it didn't exist.
//
// `knownStartDay` (set once loadMonthDefaultDay's probe resolves — see
// monthDataStartDay) clips the lower bound the same way knownStartMonth does
// a year: a row range (Split A/B) doesn't necessarily start at the month's
// own 1st, so days strictly before the confirmed real start are provably
// impossible for this filter rather than merely unloaded, and shouldn't
// render a header implying they might have races.
function mergeDayPlaceholders(month: MonthNode<IspRace>, effectiveMinDate: string, effectiveMaxDate: string, order: "asc" | "desc", knownStartDay?: string): DayNode<IspRace>[] {
  const { from, to } = monthBounds(month.key, effectiveMinDate, effectiveMaxDate);
  const clippedFrom = knownStartDay && knownStartDay > from ? knownStartDay : from;
  const dayKeys = daysInRange(clippedFrom, to, order);
  const byKey = new Map(month.days.map(d => [d.key, d]));
  return dayKeys.map(key => byKey.get(key) ?? { key, label: formatRaceDate(`${key}T00:00:00`), items: [], meetings: [] });
}

// Loading state for one calendar day's own races — each expanded day
// paginates completely independently of every other day (see loadDayPage).
// Years and months are both pure rollup/grouping now, not independent fetch
// units — the same reasoning that moved the unit from year to month applies
// one level further down: a month-scoped "page 1" pulled ~20 races spread
// across whichever days happened to match first, so expanding one month
// fetched data for days the user never asked about and left every other day
// in that month indistinguishable from "doesn't exist". `total` is null
// until the first page for this day has actually been fetched (see
// dayCountLabel — that's what distinguishes "haven't checked yet" from
// "checked, and there are genuinely none").
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

// One more level down — a single day clipped to the filter's effective
// range. Degenerate compared to yearBounds/monthBounds (a day's own span is
// just itself), but it keeps loadDayPage's call shape identical to the
// month-scoped fetch it replaced, and still honours a filter whose range
// starts or ends mid-day.
function dayBounds(dayKey: string, effectiveMinDate: string, effectiveMaxDate: string): { from: string; to: string } {
  return {
    from: dayKey > effectiveMinDate ? dayKey : effectiveMinDate,
    to: dayKey < effectiveMaxDate ? dayKey : effectiveMaxDate,
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
  // Every expanded *day* owns its own races/page/total, loaded via its own
  // small paginated request (see loadDayPage) — there is no single flat
  // "all loaded races" list or cursor anymore, and neither years nor months
  // have fetch state of their own (both are pure rollup/grouping now — see
  // yearCountLabel/monthCountLabel). The rendered race list (visibleRaces
  // below) is just the union of whatever days currently have state.
  //
  // The day is deliberately the smallest unit the filter can be sliced to:
  // expanding a month must not drag in the whole month's races (that made a
  // busy month a ~20-race fetch the user never asked for, and left every
  // other day in it looking non-existent). It fetches exactly one day — the
  // first one that actually has data — and leaves the rest tappable and
  // visibly unloaded. Same shape as the year->month change before it.
  const [dayStates, setDayStates] = useState<Record<string, RangeLoadState>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalRaces, setTotalRaces] = useState(0);
  const [brier, setBrier] = useState<BrierStats | undefined>(undefined);
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">(() => urlSortParam());
  const [oddsMode, setOddsMode] = useState<OddsMode>("fraction");
  // Every year header renders immediately from the filter's own date range
  // (see yearKeys below), long before any race data for most of them has
  // loaded — and every one of them starts *collapsed*, along with every
  // month/day/meeting under it. Nothing is expanded on load, so the screen
  // always lands as a short, scannable list of year headers rather than
  // dropping the user part-way into an already-opened tree.
  //
  // Membership here means "explicitly expanded"; a key that isn't present
  // is collapsed. That polarity (rather than the inverse "collapsedKeys"
  // this used to be) is what lets day/meeting nodes start closed too —
  // they only come into existence once a month's races land, so they can't
  // be enumerated into a collapsed-set up front.
  //
  // Data still loads on mount for whichever month each starting year
  // begins in (see the mount effect + expandYearDefaultMonth), purely so
  // those year headers can show a real race count and P&L immediately —
  // collapsed, not empty. Every other year/month stays unfetched until the
  // user taps it (or "Expand All"), which triggers loadDayPage.
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  // "Expand All" has to keep applying to nodes that don't exist yet: it
  // fires each year's own first-month fetch, and those months' day/meeting
  // nodes only appear once that data lands. While this is on, newly
  // discovered nodes get auto-expanded too (see the effect below); any
  // individual toggle hands control back to the user and turns it off.
  const [expandAllActive, setExpandAllActive] = useState(false);
  // Years whose default-first-month expansion has already run — makes
  // expandYearDefaultMonth idempotent, so re-collapsing/re-expanding a
  // year the user has already interacted with doesn't reset which
  // month(s) they'd already opened or refire that first fetch.
  const [initializedYears, setInitializedYears] = useState<Set<string>>(new Set());
  // Earliest month key ("YYYY-MM") each year's own row-ranged data has
  // actually been confirmed to start in, once loadYearDefaultMonth's
  // probe resolves — a row range (Split A/B) doesn't necessarily start
  // at a year's own January, so every month strictly before this one is
  // provably impossible for the current filter, not just unloaded (see
  // mergeMonthPlaceholders). Absent until the year has been probed at
  // least once, during which every month in the year still renders as a
  // placeholder — the generous default until the real bound is known.
  const [yearDataStartMonth, setYearDataStartMonth] = useState<Record<string, string>>({});
  // Exactly the two above, one level down: which months have already had
  // their default-first-day expansion run (idempotence for
  // expandMonthDefaultDay, so reopening a month doesn't refire its probe or
  // reset whichever days the user had opened by hand), and the earliest day
  // key ("YYYY-MM-DD") each month's data is confirmed to start on.
  const [initializedMonths, setInitializedMonths] = useState<Set<string>>(new Set());
  const [monthDataStartDay, setMonthDataStartDay] = useState<Record<string, string>>({});

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
  const minModelSpEdgePts = urlFloatParam("minModelSpEdgePts", 0);

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
      setDayStates({});
      setInitializedYears(new Set());
      setYearDataStartMonth({});
      setInitializedMonths(new Set());
      setMonthDataStartDay({});
      setExpandedKeys(new Set());
      setExpandAllActive(false);
      try {
        // A small, unscoped probe — page 1 of the row-ranged sequence with
        // no sub-date range — purely to learn the grand total (for the
        // header) and which year(s) real data actually starts in. A single
        // 20-race page usually lands entirely within one year, but not
        // always (a filter matching few races near a year boundary can
        // genuinely span two) — every year actually present gets its own
        // first month loaded, not just the first race's year, so no year
        // showing a header is left with a blank count/P&L that real loaded
        // data should have filled in. Not used
        // to seed any month's own races directly: yearKeys[0] can't be
        // trusted for this (see above), and this probe's own `total` is
        // the *grand* total across the whole row range, not any single
        // month's — the year(s) present still get their own default first
        // month loaded below, the same way every other year does when
        // tapped (see loadYearDefaultMonth) — deliberately NOT whichever
        // month this probe's data happens to fall in, since that's driven
        // by wherever the earliest *matching* race is, not the filter's
        // own literal start (e.g. a Jan-Dec 2024 filter whose earliest
        // qualifying race happens to be in July doesn't mean January isn't
        // still the natural place a user expects to land).
        const probe = await chatApi.getIndustrySp(1, PAGE_SIZE, minRunners, maxRunners, countries, minIsp, maxIsp, sortOrder, minRunnersInRange, maxRunnersInRange, fromRow, toRow ?? undefined, minDate || undefined, maxDate || undefined, courses, goings, raceClasses, raceTypes, trainer, jockey, trainerFormMinWinRate, minTrainerFormRunners, maxTrainerFormRunners, undefined, minModelWinProbability, onlyModelBeatsSp, undefined, undefined, undefined, minModelSpEdgePts);
        if (cancelled) return;
        setTotalRaces(probe.total);
        // Covers the WHOLE row range, not this one probe page: the Brier
        // branch of the aggregation runs over the row-ranged document stream
        // before the $facet's data branch pages it, so it is page-independent
        // exactly like `total` beside it. That is what makes it safe to set
        // once here and never touch again as the tree loads more days.
        setBrier(probe.brier);
        if (probe.data.length === 0) {
          setIsLoading(false);
          return;
        }
        const startYears = new Set(probe.data.map(r => raceYearKey(r.raceTime)));
        setIsLoading(false);
        // Loads each starting year's own first month so that year's header
        // can show a real race count and P&L straight away — but passes
        // expand=false, so none of it is opened. The tree stays fully
        // collapsed on load; this is a data fetch, not an expansion.
        for (const y of startYears) loadYearDefaultMonth(y);
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

  // Fetches the next page of exactly one calendar day's own races — scoped
  // via subMinDate/subMaxDate (see chatApi.getIndustrySp/the DAO) to (the
  // filter's row range) ∩ (this single day), so it pages independently of
  // every other day rather than needing to walk through them first. Called
  // for a day's very first page when it's tapped open (see toggleNode) and
  // again for each subsequent page via that day's own "Load more" button —
  // the exact same function either way, the same way expandMonthDefaultDay
  // uses it for whichever day a month starts on.
  async function loadDayPage(dayKey: string) {
    const state = dayStates[dayKey];
    if (state?.isLoading) return;
    if (state && state.total != null && state.races.length >= state.total) return;
    const nextPage = (state?.page ?? 0) + 1;
    setDayStates(prev => ({
      ...prev,
      [dayKey]: { races: prev[dayKey]?.races ?? [], page: prev[dayKey]?.page ?? 0, total: prev[dayKey]?.total ?? null, isLoading: true, error: false },
    }));
    try {
      const { from, to } = dayBounds(dayKey, effectiveMinDate, effectiveMaxDate);
      const result = await chatApi.getIndustrySp(nextPage, PAGE_SIZE, minRunners, maxRunners, countries, minIsp, maxIsp, sortOrder, minRunnersInRange, maxRunnersInRange, fromRow, toRow ?? undefined, minDate || undefined, maxDate || undefined, courses, goings, raceClasses, raceTypes, trainer, jockey, trainerFormMinWinRate, minTrainerFormRunners, maxTrainerFormRunners, undefined, minModelWinProbability, onlyModelBeatsSp, undefined, from, to, minModelSpEdgePts);
      setDayStates(prev => {
        const prevRaces = prev[dayKey]?.races ?? [];
        const seen = new Set(prevRaces.map(r => r.raceId));
        const newRaces = result.data.filter(r => !seen.has(r.raceId));
        return { ...prev, [dayKey]: { races: [...prevRaces, ...newRaces], page: nextPage, total: result.total, isLoading: false, error: false } };
      });
    } catch {
      setDayStates(prev => ({
        ...prev,
        [dayKey]: { races: prev[dayKey]?.races ?? [], page: prev[dayKey]?.page ?? 0, total: prev[dayKey]?.total ?? null, isLoading: false, error: true },
      }));
    }
  }

  // Loads (and, when `expand` is set, opens) whichever day(s) a month's own
  // row-ranged data actually starts on — the month-level twin of
  // expandYearDefaultMonth, and the thing that makes tapping a month cheap:
  // one probe plus one single-day fetch, rather than pulling a page of the
  // whole month. Every other day in the month is left untouched and renders
  // as a tappable "Not loaded yet" row (see mergeDayPlaceholders).
  //
  // Data-driven rather than "always the month's 1st" for the same reason its
  // year-level counterpart is: a row range (Split A/B) can start part-way
  // through a month, so the first day that genuinely has races is where the
  // user should land. Idempotent via initializedMonths.
  async function loadMonthDefaultDay(monthKey: string) {
    if (initializedMonths.has(monthKey)) return;
    setInitializedMonths(prev => new Set(prev).add(monthKey));
    const { from, to } = monthBounds(monthKey, effectiveMinDate, effectiveMaxDate);
    try {
      const probe = await chatApi.getIndustrySp(1, PAGE_SIZE, minRunners, maxRunners, countries, minIsp, maxIsp, sortOrder, minRunnersInRange, maxRunnersInRange, fromRow, toRow ?? undefined, minDate || undefined, maxDate || undefined, courses, goings, raceClasses, raceTypes, trainer, jockey, trainerFormMinWinRate, minTrainerFormRunners, maxTrainerFormRunners, undefined, minModelWinProbability, onlyModelBeatsSp, undefined, from, to, minModelSpEdgePts);
      if (probe.data.length === 0) return;
      const startDays = [...new Set(probe.data.map(r => raceDayKey(r.raceTime)))].sort();
      // Only the *first* day with data gets loaded, even when this probe's
      // page happened to span several — the rest stay unloaded until tapped,
      // which is the whole point of moving the fetch unit down to the day.
      const earliestStartDay = startDays[0];
      setMonthDataStartDay(prev => ({ ...prev, [monthKey]: earliestStartDay }));
      // Loaded, but deliberately NOT expanded. Nothing on this screen ever
      // auto-expands — the user's taps are the only thing that opens a row
      // (plus "Expand All"). So opening a month shows every day in it shut,
      // with this one carrying a real race count and P&L instead of "Not
      // loaded yet".
      loadDayPage(earliestStartDay);
    } catch {
      // Allow a retry on the next tap rather than leaving this month stuck
      // showing every day as unloaded.
      setInitializedMonths(prev => {
        const next = new Set(prev);
        next.delete(monthKey);
        return next;
      });
      setError("Failed to load races");
    }
  }

  // Loads (and, when `expand` is set, opens) whichever month(s) a year's
  // own row-ranged data actually starts in. The mount effect passes
  // expand=false — it wants the data for the year header's count/P&L
  // without opening anything, since nothing is expanded on load — while a
  // user tapping a year passes the default true.
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
  async function loadYearDefaultMonth(year: string) {
    if (initializedYears.has(year)) return;
    setInitializedYears(prev => new Set(prev).add(year));
    const { from, to } = yearBounds(year, effectiveMinDate, effectiveMaxDate);
    try {
      const probe = await chatApi.getIndustrySp(1, PAGE_SIZE, minRunners, maxRunners, countries, minIsp, maxIsp, sortOrder, minRunnersInRange, maxRunnersInRange, fromRow, toRow ?? undefined, minDate || undefined, maxDate || undefined, courses, goings, raceClasses, raceTypes, trainer, jockey, trainerFormMinWinRate, minTrainerFormRunners, maxTrainerFormRunners, undefined, minModelWinProbability, onlyModelBeatsSp, undefined, from, to, minModelSpEdgePts);
      if (probe.data.length === 0) return;
      const startMonths = new Set(probe.data.map(r => raceMonthKey(r.raceTime)));
      // Every month strictly before the earliest one actually present is
      // provably impossible for this row range, not just "not loaded
      // yet" — records this so mergeMonthPlaceholders can stop rendering
      // a header for it at all (see its own comment).
      const earliestStartMonth = [...startMonths].sort()[0];
      setYearDataStartMonth(prev => ({ ...prev, [year]: earliestStartMonth }));
      // Hands off to the month-level twin rather than fetching the month
      // wholesale: each starting month resolves its own first day with data
      // and loads just that one day. Nothing is expanded here — the months
      // stay shut, carrying real counts/P&L, and only a user tap opens them.
      for (const m of startMonths) loadMonthDefaultDay(m);
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
      // modelProb(), never r.modelWinProbability — the server matched these
      // races on MODEL_PROB_FIELD (the out-of-sample estimate), so re-filtering
      // its runners on the in-sample field selects a *different* set from the
      // one the race list was built from. Reported live via screenshot: the
      // same saved result read -25.8% on the Filters screen (server, honest
      // field) and +30.6% in this screen's year rollup (client, in-sample
      // field) — reproduced against prod as -11.2% vs +12.3% ROI over an
      // identical 100 races. See modelProb()'s own comment in ispFormat.ts.
      if (minModelWinProbability > 0 && !((modelProb(r) ?? -1) >= minModelWinProbability)) {
        return false;
      }
      if (onlyModelBeatsSp && !modelBeatsSp(r)) {
        return false;
      }
      if (minModelSpEdgePts > 0 && !modelBeatsSpBy(r, minModelSpEdgePts)) {
        return false;
      }
      return true;
    });
  }

  // The union of every day's own independently-loaded races — there's no
  // single flat list/cursor anymore (see dayStates/loadDayPage above).
  // Deduped by raceId globally (not just within a single day's own fetch —
  // loadDayPage's own dedup only ever sees that one day's prior races), a
  // defensive check against the backend ever returning a race under more
  // than one day's sub-date range (e.g. a timezone boundary case, or two
  // days' fetches racing when a single probe page spans midnight).
  const races = (() => {
    const seen = new Set<number>();
    const result: IspRace[] = [];
    for (const state of Object.values(dayStates)) {
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
    months: mergeMonthPlaceholders(year, effectiveMinDate, effectiveMaxDate, sortOrder, yearDataStartMonth[year.key]).map(month => ({
      ...month,
      // Day placeholders are built ONLY for months that are actually open.
      // An unbounded filter spans ~12 years x 12 months, and padding every
      // one of those out to its ~30 days would mean rebuilding ~4,300 day
      // nodes on every single render — plus feeding them all through
      // collectHierarchyNodeKeys and its joined signature below. That cost
      // is real and measurable (it took this screen's own story suite from
      // ~20s to ~190s), and it buys nothing: a collapsed month renders none
      // of its days. A closed month keeps just the days it has loaded races
      // for, which is all its count/P&L rollup needs.
      days: expandedKeys.has(`month:${month.key}`)
        ? mergeDayPlaceholders(month, effectiveMinDate, effectiveMaxDate, sortOrder, monthDataStartDay[month.key])
        : month.days,
    })),
  }));
  const allNodeKeys = collectHierarchyNodeKeys(hierarchy);
  const isAllCollapsed = allNodeKeys.length > 0 && allNodeKeys.every(k => !expandedKeys.has(k));

  // While "Expand All" is on, nodes that only come into existence later —
  // the day/meeting rows under a month whose fetch was still in flight when
  // the button was pressed — get expanded as they appear, so "Expand All"
  // genuinely means all of it rather than just whatever had happened to
  // load by the moment of the tap.
  const allNodeKeysSignature = allNodeKeys.join("|");
  useEffect(() => {
    if (!expandAllActive) return;
    setExpandedKeys(prev => {
      let changed = false;
      const next = new Set(prev);
      for (const key of allNodeKeys) {
        if (!next.has(key)) {
          next.add(key);
          changed = true;
        }
      }
      // Returning `prev` unchanged matters — this effect reruns on every
      // node-set change, and a fresh Set every time would re-render forever.
      return changed ? next : prev;
    });
    // allNodeKeys is rebuilt on every render; its joined signature is the
    // real "did the set of nodes actually change" trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandAllActive, allNodeKeysSignature]);

  function toggleNode(key: string) {
    const wasCollapsed = !expandedKeys.has(key);
    // An individual tap is the user taking over from "Expand All" — stop
    // auto-expanding whatever loads next.
    setExpandAllActive(false);
    setExpandedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
    if (key.startsWith("year:")) {
      // Opening a year for the first time resolves its own first month (and
      // that month's first day) — see loadYearDefaultMonth. Already a no-op
      // on repeat taps of an interacted-with year, via initializedYears, so
      // it never resets whichever months the user opened individually.
      if (wasCollapsed) loadYearDefaultMonth(key.slice("year:".length));
    } else if (key.startsWith("month:")) {
      // Same again one level down; loadMonthDefaultDay guards itself via
      // initializedMonths, so this needs no condition of its own beyond
      // "the user just opened it".
      if (wasCollapsed) loadMonthDefaultDay(key.slice("month:".length));
    } else if (key.startsWith("day:")) {
      const dayKey = key.slice("day:".length);
      const state = dayStates[dayKey];
      // Only fetch when this day has genuinely never been fetched, or when
      // the last attempt failed (a retry — otherwise a failed fetch would
      // need two taps, collapse then re-expand, before loadDayPage's own
      // guard let another through). Crucially NOT on every first open: the
      // day may already hold page 1 from its month's default load, and
      // firing loadDayPage there would silently pull page 2 as a side
      // effect of merely opening the row.
      if ((wasCollapsed && !state) || state?.error) {
        loadDayPage(dayKey);
      }
    }
  }

  // The "Tap to load" count on a year/month header is its own tap target,
  // separate from the row's expand toggle, and it does exactly what it says:
  // fetches, and leaves the row shut. Tapping the row itself still expands
  // (and loads) as before — this is only for the case the label advertises.
  // Reported live via screenshot: a 2024 with ten "Tap to load" months, where
  // tapping one to see its number opened it onto a wall of "Not loaded yet"
  // day rows, pushing every other month off-screen for a count the header
  // could have shown in place.
  // setExpandAllActive(false) for the same reason toggleNode does it: while
  // "Expand All" is armed, its effect opens every node that arrives, so
  // without this the rows this fetch discovers would spring open — the exact
  // thing the user tapped this target to avoid.
  function loadWithoutExpanding(load: () => void) {
    setExpandAllActive(false);
    load();
  }

  function toggleCollapseAll() {
    if (isAllCollapsed) {
      setExpandAllActive(true);
      setExpandedKeys(new Set(allNodeKeys));
      // Every not-yet-interacted-with year gets its own default first
      // month loaded — same as tapping each individually, just fired
      // together (a no-op for years already initialized, so months the
      // user already opened by hand are left exactly as they were).
      // Whatever those fetches turn up gets expanded by the
      // expandAllActive effect above as it arrives.
      for (const year of yearKeys) {
        loadYearDefaultMonth(year);
      }
    } else {
      setExpandAllActive(false);
      setExpandedKeys(new Set());
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

  // Neither years nor months have their own fetch state anymore — both are
  // pure rollups over the day states beneath them (the day is the only real
  // fetch unit, see dayStates/loadDayPage). Shared by both levels since the
  // logic is identical: "Tap to load" only while every day in range has
  // genuinely never been touched; if any is in flight, say so; once they've
  // all been checked with nothing to show, it's a real "0 races".
  // Deliberately keyed off "has this level been probed yet" (initializedYears
  // / initializedMonths) rather than scanning the day states underneath it.
  // A collapsed month doesn't build its day placeholders at all (see the
  // hierarchy above), so there is no complete day list to scan — and even
  // where there is, walking it at every level on every render is the exact
  // cost that padding-out was removed to avoid. `probed` answers the only
  // question the label actually needs: has anything gone and looked?
  // "loaded", not a bare count, because the P&L badge rendered immediately to
  // its right is a groupPnl() over exactly these races — and a group can only
  // ever roll up what has actually been fetched (days load one at a time, and
  // paginate within themselves). Reported live via screenshot: a year header
  // reading "2024 · 20 races · +£2.55 (+30.6%)" directly under a filter whose
  // own card said 675 races and -25.8%; the +30.6% was a true number over 20
  // races wearing the clothes of a year total. The exact per-level shortfall
  // isn't knowable cheaply (only days carry a server-side `total`, and a
  // collapsed month doesn't even build its day list — see the hierarchy
  // comment above for why that padding-out was removed), but "loaded" is
  // unconditionally true at every level and is the part that was missing.
  // The screen header's own `N/total races` supplies the magnitude.
  function rollupCountLabel(loadedRaces: number, probed: boolean, anyLoading: boolean): string {
    if (loadedRaces > 0) return `${loadedRaces} races loaded`;
    if (anyLoading) return "Loading…";
    if (!probed) return "Tap to load";
    return "0 races";
  }

  function yearCountLabel(year: YearNode<IspRace>): string {
    const probed = initializedYears.has(year.key);
    const anyLoading = year.months.some(m => m.days.some(d => dayStates[d.key]?.isLoading));
    return rollupCountLabel(year.items.length, probed, anyLoading);
  }

  function monthCountLabel(month: MonthNode<IspRace>): string {
    const probed = initializedMonths.has(month.key);
    const anyLoading = month.days.some(d => dayStates[d.key]?.isLoading);
    return rollupCountLabel(month.items.length, probed, anyLoading);
  }

  // A placeholder day (no races loaded for it yet) is ambiguous the way a
  // placeholder month used to be — it could mean "never tapped" or "checked,
  // and there's genuinely nothing here". Days are where the real fetch state
  // now lives, so this is the one level that reads it directly.
  function dayCountLabel(day: DayNode<IspRace>): string {
    const dayState = dayStates[day.key];
    if (day.items.length > 0) {
      // The one level that can say this precisely rather than just flagging
      // it (see rollupCountLabel): a day owns the server-side `total` for its
      // own sub-date range, so a day that has fetched every page of itself is
      // genuinely complete and its P&L badge needs no qualifier. Compared on
      // state.races (everything fetched) rather than day.items (what survives
      // the client-side qualifyingRunners narrowing) — total counts the
      // former, so anything else would read as permanently short.
      const complete = dayState?.total != null && dayState.races.length >= dayState.total;
      return complete ? `${day.items.length} races` : `${day.items.length} races loaded`;
    }
    const state = dayState;
    if (state?.isLoading) return "Loading…";
    // A failed fetch leaves state.total unset (see loadDayPage's catch) —
    // check error before the generic "state exists" fallback below, or a
    // failure reads as "confirmed zero races" instead of "tap to retry".
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

      {/*
        Scores the entire filtered row range, not the days currently expanded
        below — the same set the header's race/runner counts describe. Placed
        above the tree so it reads as a property of the filter, not of
        whichever year happens to be open.
      */}
      {!isLoading && !error && (
        <View testID="industry-sp-races-brier-row" style={styles.brierRow}>
          <BrierScore brier={brier} testID="industry-sp-races-brier" label="Brier (filtered)" />
        </View>
      )}

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
              const yearCollapsed = !expandedKeys.has(yearKey);
              const yearPnl = groupPnl(year.items);
              return (
                <View key={year.key} testID={`industry-sp-year-${year.key}`}>
                  <View style={styles.yearHeader}>
                    <TouchableOpacity
                      testID={`industry-sp-year-toggle-${year.key}`}
                      style={styles.groupHeaderMain}
                      onPress={() => toggleNode(yearKey)}
                      accessibilityRole="button"
                      accessibilityState={{ expanded: !yearCollapsed }}
                    >
                      <Text style={[styles.groupChevron, styles.groupChevronLight]}>{yearCollapsed ? "▸" : "▾"}</Text>
                      <Text style={styles.yearLabel}>{year.key}</Text>
                    </TouchableOpacity>
                    {initializedYears.has(year.key) ? (
                      <Text testID={`industry-sp-year-count-${year.key}`} style={[styles.groupCount, styles.groupCountLight]}>
                        {yearCountLabel(year)}
                      </Text>
                    ) : (
                      <TouchableOpacity
                        testID={`industry-sp-year-load-${year.key}`}
                        style={styles.groupCountButton}
                        onPress={() => loadWithoutExpanding(() => loadYearDefaultMonth(year.key))}
                        accessibilityRole="button"
                      >
                        <Text testID={`industry-sp-year-count-${year.key}`} style={[styles.groupCount, styles.groupCountLight, styles.groupCountInButton]}>
                          {yearCountLabel(year)}
                        </Text>
                      </TouchableOpacity>
                    )}
                    {yearPnl.staked > 0 && (
                      <Text testID={`industry-sp-year-pnl-${year.key}`} style={[styles.groupPnl, yearPnl.pnl >= 0 ? styles.pnlPos : styles.pnlNeg]}>
                        {formatPnl(yearPnl.pnl)} ({formatPct(yearPnl.pnl, yearPnl.staked)})
                      </Text>
                    )}
                  </View>

                  {!yearCollapsed && (
                  <>
                  {year.months.map(month => {
                    const monthKey = `month:${month.key}`;
                    const monthCollapsed = !expandedKeys.has(monthKey);
                    const monthPnl = groupPnl(month.items);
                    return (
                      <View key={month.key} testID={`industry-sp-month-${month.key}`}>
                        <View style={styles.monthHeader}>
                          <TouchableOpacity
                            testID={`industry-sp-month-toggle-${month.key}`}
                            style={styles.groupHeaderMain}
                            onPress={() => toggleNode(monthKey)}
                            accessibilityRole="button"
                            accessibilityState={{ expanded: !monthCollapsed }}
                          >
                            <Text style={[styles.groupChevron, styles.groupChevronLight]}>{monthCollapsed ? "▸" : "▾"}</Text>
                            <Text style={styles.monthLabel}>{month.label}</Text>
                          </TouchableOpacity>
                          {initializedMonths.has(month.key) ? (
                            <Text testID={`industry-sp-month-count-${month.key}`} style={[styles.groupCount, styles.groupCountLight]}>
                              {monthCountLabel(month)}
                            </Text>
                          ) : (
                            <TouchableOpacity
                              testID={`industry-sp-month-load-${month.key}`}
                              style={styles.groupCountButton}
                              onPress={() => loadWithoutExpanding(() => loadMonthDefaultDay(month.key))}
                              accessibilityRole="button"
                            >
                              <Text testID={`industry-sp-month-count-${month.key}`} style={[styles.groupCount, styles.groupCountLight, styles.groupCountInButton]}>
                                {monthCountLabel(month)}
                              </Text>
                            </TouchableOpacity>
                          )}
                          {monthPnl.staked > 0 && (
                            <Text testID={`industry-sp-month-pnl-${month.key}`} style={[styles.groupPnl, monthPnl.pnl >= 0 ? styles.pnlPos : styles.pnlNeg]}>
                              {formatPnl(monthPnl.pnl)} ({formatPct(monthPnl.pnl, monthPnl.staked)})
                            </Text>
                          )}
                        </View>

                        {!monthCollapsed && (
                        <>
                        {month.days.map(day => {
                          const dayKey = `day:${day.key}`;
                          const dayCollapsed = !expandedKeys.has(dayKey);
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
                                <Text testID={`industry-sp-day-count-${day.key}`} style={styles.groupCount}>{dayCountLabel(day)}</Text>
                                {dayPnl.staked > 0 && (
                                  <Text testID={`industry-sp-day-pnl-${day.key}`} style={[styles.groupPnl, dayPnl.pnl >= 0 ? styles.pnlPos : styles.pnlNeg]}>
                                    {formatPnl(dayPnl.pnl)} ({formatPct(dayPnl.pnl, dayPnl.staked)})
                                  </Text>
                                )}
                              </TouchableOpacity>

                              {!dayCollapsed && day.meetings.map(meeting => {
                                const meetingKey = `meeting:${meeting.meetingId}`;
                                const meetingCollapsed = !expandedKeys.has(meetingKey);
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
                                            {modelProb(runner) != null && (
                                              <Text testID={`industry-sp-item-model-${runner.id}`} style={styles.modelBadge}>
                                                Model {(modelProb(runner) as number).toFixed(0)}%
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
                              {!dayCollapsed && (() => {
                                // This day's own "Load more" — the same
                                // mechanism that loaded its first page
                                // (loadDayPage), just requesting the next
                                // one. Lives at day level now rather than
                                // month level, because the day is the unit
                                // that actually paginates; a single busy day
                                // can still exceed one page.
                                const state = dayStates[day.key];
                                if (!state || state.total == null || state.races.length >= state.total) return null;
                                return (
                                  <Button
                                    testID={`industry-sp-day-load-more-${day.key}`}
                                    mode="contained-tonal"
                                    onPress={() => loadDayPage(day.key)}
                                    disabled={state.isLoading}
                                    loading={state.isLoading}
                                    style={styles.loadMoreButton}
                                  >
                                    Load more {day.label} ({state.total - state.races.length} remaining)
                                  </Button>
                                );
                              })()}
                            </View>
                          );
                        })}
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
    borderRadius: radii.button,
  },
  toolbarButtonLabel: {
    fontSize: 12,
    fontWeight: "700",
  },
  toolbarButtonOutlined: {
    borderRadius: radii.button,
    borderColor: colors.primary,
  },
  toolbarButtonOutlinedLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.primary,
  },
  brierRow: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
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
  // The chevron + label half of a year/month header row: the part that still
  // toggles the row open. Split out of the header itself so the count beside
  // it can be its own load-only tap target (see loadWithoutExpanding) —
  // siblings rather than nested Touchables, so a tap on one can never also
  // fire the other the way a nested press bubbles to its parent on web.
  groupHeaderMain: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  groupCount: {
    fontSize: 11,
    color: colors.textTertiary,
    marginLeft: "auto",
  },
  // Carries the right-alignment groupCount would otherwise do itself, plus
  // enough padding to be a real finger target for 11px text. Padding only
  // leftward/vertically: the row's own vertical padding is taller than this,
  // so nothing grows, and the label stays flush right where it always was.
  groupCountButton: {
    marginLeft: "auto",
    paddingLeft: spacing.lg,
    paddingVertical: 4,
  },
  groupCountInButton: {
    marginLeft: 0,
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
    borderRadius: radii.button,
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
