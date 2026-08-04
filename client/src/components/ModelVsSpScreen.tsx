import React, { useState, useEffect, useRef } from "react";
import {
  View,
  ScrollView,
  TextInput as RNTextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  KeyboardTypeOptions,
} from "react-native";
import { Text, Button, Chip, ActivityIndicator } from "react-native-paper";
import { chatApi, ModelVsSpRow, ModelVsSpSort, ModelVsSpSummary } from "../services/chatApi";
import { DateRangePicker } from "./DateRangePicker";
import { PageContainer } from "./PageContainer";
import { PaginationControls } from "./PaginationControls";
import { AppHeader } from "./AppHeader";
import { BrierScore } from "./BrierScore";
import type { Route } from "../hooks/useRouter";
import { colors, radii, spacing, statusPill } from "../theme";
import { useResponsive } from "../utils/responsive";
import { formatEdgePts, formatRaceTime, yearsInRange, monthsInRange } from "../utils/ispFormat";
import { urlIntParam, urlFloatParam, urlStringParam, updateUrlParams, urlHasAnyModelVsSpParams } from "../utils/ispUrlParams";

interface ModelVsSpScreenProps {
  navigate: (to: Route, query?: string) => void;
  isAuthenticated: boolean;
  onLogout?: () => void;
  onBack?: () => void;
  onNavigateToRunner?: (raceId: number, runnerId: number) => void;
}

// The full span of model-scored data. Measured against production on 2026-07-30
// by scripts/prod-repro-model-vs-sp-coverage-2026-07-30.ts, which found
// 970,852 runners carrying BOTH a modelWinProbability and a real industry SP,
// spread across every year from 2015 to 2026 with no gap — so unlike the
// partial-coverage case the design anticipated, the model-scored window is the
// same as the ISP window and every year pill has real data behind it. Kept as a
// named constant with that provenance rather than reusing a bare
// ABSOLUTE_MIN_DATE, so a future reader can tell this was verified rather than
// assumed (a re-import that only scores recent races would move it).
const MODEL_COVERAGE_MIN_DATE = "2015-01-01";
const ABSOLUTE_MAX_DATE = "2026-12-31";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Deliberately a narrow window, same reasoning as IndustrySpScreen's own default:
// the backing cluster is an Atlas free tier, and a first paint over one month is
// fast where a first paint over eleven years is not. The date pills make widening
// it one tap away.
const DEFAULT_MIN_DATE = "2024-01-01";
const DEFAULT_MAX_DATE = "2024-01-31";
const DEFAULT_LIMIT = 50;

const FILTER_DEFAULTS = {
  minModelProb: 0,
  maxModelProb: 100,
  minImpliedProb: 0,
  maxImpliedProb: 100,
  minAbsEdge: 0,
  maxAbsEdge: 100,
  minDate: DEFAULT_MIN_DATE,
  maxDate: DEFAULT_MAX_DATE,
};

const FILTER_TOOLTIPS: Record<string, string> = {
  modelProb:
    "The model's own estimated win probability for the runner, as a percentage. Trained without the industry SP as an input, so it's an independent view rather than a rephrasing of the market's price.",
  impliedSp:
    "The win probability the runner's industry SP itself implies: 100 ÷ decimal odds. An SP of 4.0 implies 25%.",
  edge:
    "How far apart the model and the market are, in percentage points, ignoring which way round. A range of 10-20 finds runners the model rates 10-20 points above their SP AND ones it rates 10-20 points below — the question is the size of the disagreement, not its direction. Each row still shows the signed gap.",
};

// Mirrors IndustrySpScreen's one-calendar-year cap. The server enforces the same
// bound (it has to — the gap sort is a blocking in-memory sort with no index),
// but clamping here too means the user sees the window they'll actually get
// rather than silently asking for more.
function addOneYear(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

function lastDayOfMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split("-").map(n => parseInt(n, 10));
  // Day 0 of the next month is the last day of this one.
  const d = new Date(Date.UTC(y, m, 0));
  return d.toISOString().slice(0, 10);
}

function formatRaceDateShort(raceDate: string): string {
  const [, m, d] = raceDate.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${parseInt(d, 10)} ${months[parseInt(m, 10) - 1] ?? m}`;
}

function parseNumericInput(raw: string, fallback: number): number {
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const ModelVsSpScreen: React.FC<ModelVsSpScreenProps> = ({
  navigate,
  isAuthenticated,
  onLogout,
  onBack,
  onNavigateToRunner,
}) => {
  // Phone-width layout switch. The filter grid is a fixed-width label + two
  // fixed-width number inputs + an inline hint; below ~460px of viewport that
  // no longer fits inside the card's padding, and the hint (the longest of
  // them, "pts apart, ± ignored") spilled past the card's right border rather
  // than wrapping — the document itself never scrolled horizontally, which is
  // why the existing 375px overflow test never saw it.
  const { isNarrow } = useResponsive();

  // Applied (committed) filter state — what the last fetch actually used, and
  // what the URL reflects.
  const [minModelProb, setMinModelProb] = useState(() => urlFloatParam("minModelProb", FILTER_DEFAULTS.minModelProb));
  const [maxModelProb, setMaxModelProb] = useState(() => urlFloatParam("maxModelProb", FILTER_DEFAULTS.maxModelProb));
  const [minImpliedProb, setMinImpliedProb] = useState(() => urlFloatParam("minImpliedProb", FILTER_DEFAULTS.minImpliedProb));
  const [maxImpliedProb, setMaxImpliedProb] = useState(() => urlFloatParam("maxImpliedProb", FILTER_DEFAULTS.maxImpliedProb));
  const [minAbsEdge, setMinAbsEdge] = useState(() => urlFloatParam("minAbsEdge", FILTER_DEFAULTS.minAbsEdge));
  const [maxAbsEdge, setMaxAbsEdge] = useState(() => urlFloatParam("maxAbsEdge", FILTER_DEFAULTS.maxAbsEdge));
  const [minDate, setMinDate] = useState(() => urlStringParam("minDate", FILTER_DEFAULTS.minDate));
  const [maxDate, setMaxDate] = useState(() => urlStringParam("maxDate", FILTER_DEFAULTS.maxDate));

  // Draft state — bound to the inputs, committed by Apply. Same draft-vs-applied
  // split IndustrySpScreen uses, for the same reason: every Apply is a fresh
  // paged query against a free-tier cluster, so keystrokes must not trigger one.
  const [draftMinModelProb, setDraftMinModelProb] = useState(String(minModelProb));
  const [draftMaxModelProb, setDraftMaxModelProb] = useState(String(maxModelProb));
  const [draftMinImpliedProb, setDraftMinImpliedProb] = useState(String(minImpliedProb));
  const [draftMaxImpliedProb, setDraftMaxImpliedProb] = useState(String(maxImpliedProb));
  const [draftMinAbsEdge, setDraftMinAbsEdge] = useState(String(minAbsEdge));
  const [draftMaxAbsEdge, setDraftMaxAbsEdge] = useState(String(maxAbsEdge));
  const [draftMinDate, setDraftMinDate] = useState(minDate);
  const [draftMaxDate, setDraftMaxDate] = useState(maxDate);

  // These three change ordering/windowing but not the matched set, so they apply
  // immediately rather than waiting for Apply — a sort toggle or a page step that
  // needed a second click would be indefensible.
  const [sort, setSort] = useState<ModelVsSpSort>(() => {
    const raw = urlStringParam("sort", "date_desc");
    return raw === "date_asc" || raw === "edge_desc" || raw === "edge_asc" ? raw : "date_desc";
  });
  const [page, setPage] = useState(() => Math.max(1, urlIntParam("page", 1)));
  const [limit, setLimit] = useState(() => Math.max(1, urlIntParam("limit", DEFAULT_LIMIT)));

  const [rows, setRows] = useState<ModelVsSpRow[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [summary, setSummary] = useState<ModelVsSpSummary | null>(null);
  const [totalPages, setTotalPages] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);
  const [showFilters, setShowFilters] = useState(true);
  const [openTooltip, setOpenTooltip] = useState<string | null>(null);

  // The single fetch trigger — the effect below depends on this and nothing else,
  // so no filter/sort/page state change can accidentally fire a request without
  // going through a handler that meant to. Same pattern as IndustrySpScreen.
  const [fetchTrigger, setFetchTrigger] = useState(0);

  // Identifies the filter+sort+limit combination the current `total` was counted
  // for. A pure page step within the same combination reuses it and skips the
  // count query; anything else re-counts. Held in a ref (not state) because the
  // fetch effect reads it while deciding what to request.
  const countedSignatureRef = useRef<string | null>(null);

  function filterSignature(): string {
    return JSON.stringify([minModelProb, maxModelProb, minImpliedProb, maxImpliedProb, minAbsEdge, maxAbsEdge, minDate, maxDate, limit, sort]);
  }

  // Fetches on mount either way — unlike /isp, which waits for Apply because its
  // default query is far heavier. The initial state above was already read from
  // the URL, so a shared/bookmarked link and a bare visit take the same path;
  // urlHasAnyModelVsSpParams is only consulted to decide whether to trust a
  // stored page number (a bare visit always starts at page 1).
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!urlHasAnyModelVsSpParams()) setPage(1);
    setFetchTrigger(t => t + 1);
  }, []);

  useEffect(() => {
    if (fetchTrigger === 0) return;
    let cancelled = false;

    const signature = filterSignature();
    // Only a page step within an already-counted combination may skip the count.
    const includeTotal = countedSignatureRef.current !== signature;

    setIsLoading(true);
    setError(null);

    chatApi
      .getModelVsSp({
        page,
        limit,
        sort,
        minDate,
        maxDate,
        minModelProb,
        maxModelProb,
        minImpliedProb,
        maxImpliedProb,
        minAbsEdge,
        maxAbsEdge,
        includeTotal,
      })
      .then(response => {
        if (cancelled) return;
        setRows(response.data);
        // A null total means "not counted this request" — keep showing the one we
        // already have rather than flashing "0 runners" on every page step.
        if (response.total != null) {
          setTotal(response.total);
          setTotalPages(response.totalPages);
          // Arrives on the same requests the total does, and is kept on screen
          // across page steps for the same reason.
          setSummary(response.summary);
          countedSignatureRef.current = signature;
        }
        // The server clamps an over-wide span and defaults a malformed one, and
        // echoes back what it actually queried — adopt that so the pills, the
        // picker and the URL all agree with the rows on screen.
        if (response.minDate !== minDate) setMinDate(response.minDate);
        if (response.maxDate !== maxDate) setMaxDate(response.maxDate);
        setHasFetched(true);
      })
      .catch(() => {
        if (cancelled) return;
        setError("Failed to load Model vs SP data");
        setRows([]);
        setHasFetched(true);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchTrigger]);

  // Written with replaceState (see updateUrlParams) so a filtered/paged view can
  // be bookmarked or shared. Only non-default values are written, so a bare
  // /model-vs-sp stays bare.
  useEffect(() => {
    if (!hasFetched) return;
    updateUrlParams({
      page: page !== 1 ? String(page) : null,
      limit: limit !== DEFAULT_LIMIT ? String(limit) : null,
      sort: sort !== "date_desc" ? sort : null,
      minDate: minDate !== FILTER_DEFAULTS.minDate ? minDate : null,
      maxDate: maxDate !== FILTER_DEFAULTS.maxDate ? maxDate : null,
      minModelProb: minModelProb !== FILTER_DEFAULTS.minModelProb ? String(minModelProb) : null,
      maxModelProb: maxModelProb !== FILTER_DEFAULTS.maxModelProb ? String(maxModelProb) : null,
      minImpliedProb: minImpliedProb !== FILTER_DEFAULTS.minImpliedProb ? String(minImpliedProb) : null,
      maxImpliedProb: maxImpliedProb !== FILTER_DEFAULTS.maxImpliedProb ? String(maxImpliedProb) : null,
      minAbsEdge: minAbsEdge !== FILTER_DEFAULTS.minAbsEdge ? String(minAbsEdge) : null,
      maxAbsEdge: maxAbsEdge !== FILTER_DEFAULTS.maxAbsEdge ? String(maxAbsEdge) : null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasFetched, page, limit, sort, minDate, maxDate, minModelProb, maxModelProb, minImpliedProb, maxImpliedProb, minAbsEdge, maxAbsEdge]);

  function applyFilters() {
    const nextMinModel = Math.min(100, Math.max(0, parseNumericInput(draftMinModelProb, FILTER_DEFAULTS.minModelProb)));
    const nextMaxModel = Math.min(100, Math.max(0, parseNumericInput(draftMaxModelProb, FILTER_DEFAULTS.maxModelProb)));
    const nextMinImplied = Math.min(100, Math.max(0, parseNumericInput(draftMinImpliedProb, FILTER_DEFAULTS.minImpliedProb)));
    const nextMaxImplied = Math.min(100, Math.max(0, parseNumericInput(draftMaxImpliedProb, FILTER_DEFAULTS.maxImpliedProb)));
    // 0-100, not ±100: this is the SIZE of the gap, which can't be negative.
    const nextMinAbsEdge = Math.min(100, Math.max(0, parseNumericInput(draftMinAbsEdge, FILTER_DEFAULTS.minAbsEdge)));
    const nextMaxAbsEdge = Math.min(100, Math.max(0, parseNumericInput(draftMaxAbsEdge, FILTER_DEFAULTS.maxAbsEdge)));

    let nextMinDate = DATE_RE.test(draftMinDate) ? draftMinDate : FILTER_DEFAULTS.minDate;
    let nextMaxDate = DATE_RE.test(draftMaxDate) ? draftMaxDate : FILTER_DEFAULTS.maxDate;
    if (nextMaxDate < nextMinDate) {
      const swap = nextMinDate;
      nextMinDate = nextMaxDate;
      nextMaxDate = swap;
    }
    const cap = addOneYear(nextMinDate);
    if (nextMaxDate > cap) nextMaxDate = cap;

    setMinModelProb(nextMinModel);
    setMaxModelProb(nextMaxModel);
    setMinImpliedProb(nextMinImplied);
    setMaxImpliedProb(nextMaxImplied);
    setMinAbsEdge(nextMinAbsEdge);
    setMaxAbsEdge(nextMaxAbsEdge);
    setMinDate(nextMinDate);
    setMaxDate(nextMaxDate);

    // Reflect any clamping back into the inputs, so the form shows what was
    // actually applied rather than what was typed.
    setDraftMinModelProb(String(nextMinModel));
    setDraftMaxModelProb(String(nextMaxModel));
    setDraftMinImpliedProb(String(nextMinImplied));
    setDraftMaxImpliedProb(String(nextMaxImplied));
    setDraftMinAbsEdge(String(nextMinAbsEdge));
    setDraftMaxAbsEdge(String(nextMaxAbsEdge));
    setDraftMinDate(nextMinDate);
    setDraftMaxDate(nextMaxDate);

    // A narrower filter usually makes the current page number meaningless.
    setPage(1);
    setFetchTrigger(t => t + 1);
  }

  function resetFilters() {
    setMinModelProb(FILTER_DEFAULTS.minModelProb);
    setMaxModelProb(FILTER_DEFAULTS.maxModelProb);
    setMinImpliedProb(FILTER_DEFAULTS.minImpliedProb);
    setMaxImpliedProb(FILTER_DEFAULTS.maxImpliedProb);
    setMinAbsEdge(FILTER_DEFAULTS.minAbsEdge);
    setMaxAbsEdge(FILTER_DEFAULTS.maxAbsEdge);
    setMinDate(FILTER_DEFAULTS.minDate);
    setMaxDate(FILTER_DEFAULTS.maxDate);
    setDraftMinModelProb(String(FILTER_DEFAULTS.minModelProb));
    setDraftMaxModelProb(String(FILTER_DEFAULTS.maxModelProb));
    setDraftMinImpliedProb(String(FILTER_DEFAULTS.minImpliedProb));
    setDraftMaxImpliedProb(String(FILTER_DEFAULTS.maxImpliedProb));
    setDraftMinAbsEdge(String(FILTER_DEFAULTS.minAbsEdge));
    setDraftMaxAbsEdge(String(FILTER_DEFAULTS.maxAbsEdge));
    setDraftMinDate(FILTER_DEFAULTS.minDate);
    setDraftMaxDate(FILTER_DEFAULTS.maxDate);
    setSort("date_desc");
    setPage(1);
    setLimit(DEFAULT_LIMIT);
    setFetchTrigger(t => t + 1);
  }

  // Pills set the applied date range directly and refetch — they bypass Apply on
  // purpose. A shortcut that still needed a second click would be slower than the
  // calendar it's shortcutting.
  function applyDateRange(nextMin: string, nextMax: string) {
    setMinDate(nextMin);
    setMaxDate(nextMax);
    setDraftMinDate(nextMin);
    setDraftMaxDate(nextMax);
    setPage(1);
    setFetchTrigger(t => t + 1);
  }

  function changePage(nextPage: number) {
    setPage(nextPage);
    setFetchTrigger(t => t + 1);
  }

  function changeLimit(nextLimit: number) {
    setLimit(nextLimit);
    setPage(1);
    setFetchTrigger(t => t + 1);
  }

  function toggleSort(dimension: "date" | "edge") {
    setSort(current => {
      if (dimension === "date") return current === "date_desc" ? "date_asc" : "date_desc";
      return current === "edge_desc" ? "edge_asc" : "edge_desc";
    });
    setPage(1);
    setFetchTrigger(t => t + 1);
  }

  // Derived, never stored: an exact whole-year or whole-month applied range lights
  // the matching pill, and any other range lights none. That keeps pill state from
  // being a second source of truth that could disagree with the date picker.
  const selectedYear =
    minDate.endsWith("-01-01") && maxDate.endsWith("-12-31") && minDate.slice(0, 4) === maxDate.slice(0, 4)
      ? minDate.slice(0, 4)
      : null;
  const selectedMonth =
    minDate.slice(0, 7) === maxDate.slice(0, 7) && minDate.endsWith("-01") && maxDate === lastDayOfMonth(minDate.slice(0, 7))
      ? minDate.slice(0, 7)
      : null;

  const years = yearsInRange(MODEL_COVERAGE_MIN_DATE, ABSOLUTE_MAX_DATE, "desc");
  // Only ever the twelve months of one year, so the pill row stays scannable.
  const pillYear = selectedYear ?? minDate.slice(0, 4);
  const months = monthsInRange(`${pillYear}-01-01`, `${pillYear}-12-31`, "asc");

  const firstRowOnPage = (page - 1) * limit + 1;
  const lastRowOnPage = (page - 1) * limit + rows.length;

  function renderTooltipToggle(key: string) {
    return (
      <TouchableOpacity
        testID={`model-vs-sp-tooltip-toggle-${key}`}
        onPress={() => setOpenTooltip(t => (t === key ? null : key))}
        hitSlop={{ top: 17, bottom: 17, left: 17, right: 17 }}
        style={styles.tooltipToggle}
      >
        <Text style={styles.tooltipToggleText}>?</Text>
      </TouchableOpacity>
    );
  }

  function renderTooltipText(key: string) {
    if (openTooltip !== key) return null;
    return (
      <Text testID={`model-vs-sp-tooltip-text-${key}`} style={styles.tooltipText}>
        {FILTER_TOOLTIPS[key]}
      </Text>
    );
  }

  // A local copy of IndustrySpScreen's renderFilterRow rather than a shared
  // import: that one closes over its own component's `openTooltip` state and
  // `styles`, the same reason ispFormat.ts documents duplicating
  // IspRacesScreen's qualifyingRunners as a pure function instead of importing
  // the closure. Extracting a shared FilterRow component is now clearly worth
  // doing (this is the third copy of the pattern), but as its own change — doing
  // it here would mean a diff across IndustrySpScreen's 2,300 lines and
  // re-verifying its ~20 stories for zero behaviour change.
  function renderFilterRow(opts: {
    filterKey: string;
    label: string;
    minValue: string;
    onMinChange: (v: string) => void;
    minTestId: string;
    maxValue: string;
    onMaxChange: (v: string) => void;
    maxTestId: string;
    keyboardType?: KeyboardTypeOptions;
    hint?: string;
  }) {
    return (
      <View
        key={opts.filterKey}
        testID={`model-vs-sp-filter-row-${opts.filterKey}`}
        style={[
          styles.filterGridRow,
          isNarrow && styles.filterGridRowNarrow,
          openTooltip === opts.filterKey && styles.filterGridRowElevated,
        ]}
      >
        <View style={[styles.filterGridLabel, isNarrow && styles.filterGridLabelNarrow]}>
          <Text style={styles.filterGridLabelText}>{opts.label}</Text>
          {renderTooltipToggle(opts.filterKey)}
        </View>
        <RNTextInput
          testID={opts.minTestId}
          style={[styles.gridInput, isNarrow && styles.gridInputNarrow]}
          value={opts.minValue}
          onChangeText={opts.onMinChange}
          keyboardType={opts.keyboardType ?? "numeric"}
          maxLength={7}
        />
        <Text style={styles.filterGridDash}>–</Text>
        <RNTextInput
          testID={opts.maxTestId}
          style={[styles.gridInput, isNarrow && styles.gridInputNarrow]}
          value={opts.maxValue}
          onChangeText={opts.onMaxChange}
          keyboardType={opts.keyboardType ?? "numeric"}
          maxLength={7}
        />
        {/* Own testID so the layout tests can assert on where this actually
            lands: inline beside the inputs on a wide viewport, on its own
            full-width line beneath them on a phone. */}
        <Text
          testID={`model-vs-sp-filter-hint-${opts.filterKey}`}
          style={[styles.filterGridHint, isNarrow && styles.filterGridHintNarrow]}
        >
          {opts.hint ?? ""}
        </Text>
        {renderTooltipText(opts.filterKey)}
      </View>
    );
  }

  function renderRow(row: ModelVsSpRow) {
    const key = `${row.raceId}-${row.runnerId}`;
    const pill = statusPill[row.status] ?? statusPill.HIDDEN;
    const edgeStyle = row.edge > 0 ? styles.edgePositive : row.edge < 0 ? styles.edgeNegative : styles.edgeNeutral;
    return (
      <TouchableOpacity
        key={key}
        testID={`model-vs-sp-row-${key}`}
        style={styles.row}
        activeOpacity={onNavigateToRunner ? 0.6 : 1}
        disabled={!onNavigateToRunner}
        onPress={() => onNavigateToRunner?.(row.raceId, row.runnerId)}
      >
        <View style={styles.rowTop}>
          <Text testID={`model-vs-sp-date-${key}`} style={styles.rowDate}>
            {formatRaceDateShort(row.raceDate)}
          </Text>
          <Text testID={`model-vs-sp-race-time-${key}`} style={styles.rowTime}>
            {formatRaceTime(row.raceTime)}
          </Text>
          <Text testID={`model-vs-sp-course-${key}`} style={styles.rowCourse} numberOfLines={1}>
            {row.course}
          </Text>
          <Text testID={`model-vs-sp-runner-${key}`} style={styles.rowRunner} numberOfLines={1}>
            {row.runnerName}
          </Text>
        </View>
        <View style={styles.rowBottom}>
          <Text testID={`model-vs-sp-isp-${key}`} style={styles.ispBadge}>
            {`SP ${row.ispFraction ?? row.isp.toFixed(2)}`}
          </Text>
          <Text testID={`model-vs-sp-model-${key}`} style={styles.modelBadge}>
            {`Model ${row.modelWinProbability.toFixed(1)}%`}
          </Text>
          <Text testID={`model-vs-sp-sp-${key}`} style={styles.impliedBadge}>
            {`SP ${row.impliedSpProbability.toFixed(1)}%`}
          </Text>
          <Text testID={`model-vs-sp-edge-${key}`} style={[styles.edgeBadge, edgeStyle]}>
            {formatEdgePts(row.edge)}
          </Text>
          <Text
            testID={`model-vs-sp-status-${key}`}
            style={[styles.statusBadge, { backgroundColor: pill.bg, color: pill.fg }]}
          >
            {row.status}
          </Text>
        </View>
      </TouchableOpacity>
    );
  }

  const dateSortActive = sort === "date_desc" || sort === "date_asc";
  const edgeSortActive = sort === "edge_desc" || sort === "edge_asc";

  return (
    <SafeAreaView testID="model-vs-sp-screen" style={styles.container}>
      <AppHeader
        navigate={navigate}
        isAuthenticated={isAuthenticated}
        onLogout={onLogout}
        onBack={onBack}
        testIdPrefix="model-vs-sp"
        subtitle={
          total != null
            ? `${total.toLocaleString()} runners${totalPages != null ? ` · page ${page} of ${totalPages}` : ""}`
            : undefined
        }
        extraActions={wrap => (
          <Button
            testID="model-vs-sp-filters-toggle"
            mode="outlined"
            compact
            onPress={wrap(() => setShowFilters(v => !v))}
          >
            {showFilters ? "Hide filters" : "Show filters"}
          </Button>
        )}
      />

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <PageContainer maxWidth={900}>
          {showFilters && (
            <View testID="model-vs-sp-filter-bar" style={styles.filterBar}>
              {renderFilterRow({
                filterKey: "modelProb",
                label: "Model %",
                minValue: draftMinModelProb,
                onMinChange: setDraftMinModelProb,
                minTestId: "model-vs-sp-min-model-prob",
                maxValue: draftMaxModelProb,
                onMaxChange: setDraftMaxModelProb,
                maxTestId: "model-vs-sp-max-model-prob",
                hint: "0–100",
              })}
              {renderFilterRow({
                filterKey: "impliedSp",
                label: "SP %",
                minValue: draftMinImpliedProb,
                onMinChange: setDraftMinImpliedProb,
                minTestId: "model-vs-sp-min-implied-sp",
                maxValue: draftMaxImpliedProb,
                onMaxChange: setDraftMaxImpliedProb,
                maxTestId: "model-vs-sp-max-implied-sp",
                hint: "0–100",
              })}
              {renderFilterRow({
                filterKey: "edge",
                label: "Difference",
                minValue: draftMinAbsEdge,
                onMinChange: setDraftMinAbsEdge,
                minTestId: "model-vs-sp-min-edge",
                maxValue: draftMaxAbsEdge,
                onMaxChange: setDraftMaxAbsEdge,
                maxTestId: "model-vs-sp-max-edge",
                hint: "pts apart, ± ignored",
              })}

              <View
                testID="model-vs-sp-filter-row-date"
                style={[styles.filterGridRow, isNarrow && styles.filterGridRowNarrow]}
              >
                <View style={[styles.filterGridLabel, isNarrow && styles.filterGridLabelNarrow]}>
                  <Text style={styles.filterGridLabelText}>Dates</Text>
                </View>
                <DateRangePicker
                  testID="model-vs-sp-date-picker"
                  fromDate={draftMinDate}
                  toDate={draftMaxDate}
                  minDate={MODEL_COVERAGE_MIN_DATE}
                  maxDate={ABSOLUTE_MAX_DATE}
                  onChange={(from, to) => {
                    setDraftMinDate(from);
                    setDraftMaxDate(to);
                  }}
                />
              </View>

              <View testID="model-vs-sp-year-pills" style={[styles.pillRow, isNarrow && styles.pillRowNarrow]}>
                <Text style={[styles.pillRowLabel, isNarrow && styles.pillRowLabelNarrow]}>Year</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  // Without an explicit flex the scroller sizes itself to its
                  // content and pushes its right edge past the card's border,
                  // so the strip appeared to bleed out of the card instead of
                  // scrolling inside it.
                  style={[styles.pillScrollView, isNarrow && styles.pillScrollViewNarrow]}
                  contentContainerStyle={styles.pillScroll}
                >
                  {years.map(year => {
                    const active = selectedYear === year;
                    return (
                      <Chip
                        key={year}
                        testID={`model-vs-sp-year-pill-${year}`}
                        compact
                        mode={active ? "flat" : "outlined"}
                        selected={active}
                        // React Native Paper renders a Chip as role="button", and
                        // React Native Web only maps accessibilityState.selected to
                        // aria-selected for roles that support it — so a selected
                        // chip emits no aria-selected at all. The label carries the
                        // state instead, which both announces correctly to a screen
                        // reader and gives the tests something real to assert on.
                        accessibilityLabel={`${year}${active ? " (selected)" : ""}`}
                        onPress={() => applyDateRange(`${year}-01-01`, `${year}-12-31`)}
                        style={active ? styles.pillActive : styles.pill}
                        textStyle={active ? styles.pillTextActive : styles.pillText}
                      >
                        {year}
                      </Chip>
                    );
                  })}
                </ScrollView>
              </View>

              <View testID="model-vs-sp-month-pills" style={[styles.pillRow, isNarrow && styles.pillRowNarrow]}>
                <Text style={[styles.pillRowLabel, isNarrow && styles.pillRowLabelNarrow]}>
                  {`Month (${pillYear})`}
                </Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  // See the year row above.
                  style={[styles.pillScrollView, isNarrow && styles.pillScrollViewNarrow]}
                  contentContainerStyle={styles.pillScroll}
                >
                  {months.map(month => {
                    const active = selectedMonth === month;
                    return (
                      <Chip
                        key={month}
                        testID={`model-vs-sp-month-pill-${month}`}
                        compact
                        mode={active ? "flat" : "outlined"}
                        selected={active}
                        // See the year pill above for why the state lives in the
                        // label rather than accessibilityState.
                        accessibilityLabel={`${month}${active ? " (selected)" : ""}`}
                        onPress={() => applyDateRange(`${month}-01`, lastDayOfMonth(month))}
                        style={active ? styles.pillActive : styles.pill}
                        textStyle={active ? styles.pillTextActive : styles.pillText}
                      >
                        {month.slice(5)}
                      </Chip>
                    );
                  })}
                </ScrollView>
              </View>

              <View style={styles.filterActions}>
                <Button
                  testID="model-vs-sp-apply-button"
                  mode="contained"
                  compact
                  buttonColor={colors.accent}
                  onPress={applyFilters}
                >
                  Apply
                </Button>
                <Button testID="model-vs-sp-reset-button" mode="outlined" compact onPress={resetFilters}>
                  Reset
                </Button>
              </View>
            </View>
          )}

          <View style={styles.toolbar}>
            <Button
              testID="model-vs-sp-sort-date"
              mode={dateSortActive ? "contained" : "outlined"}
              compact
              buttonColor={dateSortActive ? colors.accent : undefined}
              accessibilityState={{ selected: dateSortActive }}
              onPress={() => toggleSort("date")}
            >
              {sort === "date_asc" ? "Date: Oldest first" : "Date: Newest first"}
            </Button>
            <Button
              testID="model-vs-sp-sort-edge"
              mode={edgeSortActive ? "contained" : "outlined"}
              compact
              buttonColor={edgeSortActive ? colors.accent : undefined}
              accessibilityState={{ selected: edgeSortActive }}
              onPress={() => toggleSort("edge")}
            >
              {sort === "edge_asc" ? "Gap: Smallest first" : "Gap: Biggest first"}
            </Button>
          </View>

          {summary != null && summary.allRunners > 0 && (
            <View testID="model-vs-sp-summary" style={styles.summaryCard}>
              <Text style={styles.summaryTitle}>How close is the model to the market?</Text>
              <Text testID="model-vs-sp-summary-headline" style={styles.summaryHeadline}>
                {`Across all ${summary.allRunners.toLocaleString()} runners in this window, the average gap is ` +
                  `${summary.meanAbsEdge.toFixed(1)} pts.`}
              </Text>

              {/* Cumulative shares, which is the question actually being asked —
                  "what percentage of runners is the model within ±N of?" — rather
                  than each band in isolation. */}
              <View style={styles.summaryBands}>
                {summary.bands.map(band => {
                  const key = band.maxAbs == null ? "beyond" : String(band.maxAbs);
                  const share = band.cumulativePercent ?? band.percent;
                  return (
                    <View key={key} testID={`model-vs-sp-summary-band-${key}`} style={styles.summaryBandRow}>
                      <Text style={styles.summaryBandLabel}>
                        {band.maxAbs == null ? band.label : `within ±${band.maxAbs} pts`}
                      </Text>
                      <View style={styles.summaryBarTrack}>
                        <View
                          style={[
                            styles.summaryBarFill,
                            // Width is the share itself, so the bars read as a
                            // proportion of the whole population at a glance.
                            { width: `${Math.max(0, Math.min(100, share))}%` },
                            band.maxAbs == null && styles.summaryBarFillTail,
                          ]}
                        />
                      </View>
                      <Text testID={`model-vs-sp-summary-percent-${key}`} style={styles.summaryBandPercent}>
                        {`${share.toFixed(1)}%`}
                      </Text>
                      <Text testID={`model-vs-sp-summary-count-${key}`} style={styles.summaryBandCount}>
                        {band.count.toLocaleString()}
                      </Text>
                    </View>
                  );
                })}
              </View>

              {/* The gap the bands measure is "how far apart are the two", which
                  says nothing about WHICH of them is right. This does: over the
                  runners the difference filter actually selects, whose
                  probabilities were closer to what happened. A wide mean gap
                  paired with a model Brier ABOVE the market's is the signature
                  of a filter that has found disagreement rather than an edge —
                  and that combination is easy to produce here by accident. */}
              <View testID="model-vs-sp-summary-brier" style={styles.summaryBrier}>
                <BrierScore brier={summary.brier} testID="model-vs-sp-brier" label="Brier (selected)" />
              </View>

              {/* Only meaningful once the difference filter is actually narrowing
                  something — at the full 0-100 default it would just restate the
                  total as 100%. */}
              {(minAbsEdge > FILTER_DEFAULTS.minAbsEdge || maxAbsEdge < FILTER_DEFAULTS.maxAbsEdge) && (
                <Text testID="model-vs-sp-summary-selection" style={styles.summarySelection}>
                  {`Your difference filter (${minAbsEdge}–${maxAbsEdge} pts) selects ` +
                    `${summary.matchedRunners.toLocaleString()} of them — ${summary.matchedPercent.toFixed(1)}%.`}
                </Text>
              )}
            </View>
          )}

          <View style={styles.countHeader}>
            <Text testID="model-vs-sp-result-count" style={styles.countText}>
              {total != null ? `${total.toLocaleString()} runners` : "Counting…"}
            </Text>
            {rows.length > 0 && (
              <Text testID="model-vs-sp-page-range" style={styles.pageRangeText}>
                {`Showing ${firstRowOnPage.toLocaleString()}–${lastRowOnPage.toLocaleString()}` +
                  (total != null ? ` of ${total.toLocaleString()}` : "") +
                  (totalPages != null ? ` · page ${page} of ${totalPages}` : "")}
              </Text>
            )}
          </View>

          <PaginationControls
            testIdPrefix="model-vs-sp-pagination-top"
            page={page}
            totalPages={totalPages}
            total={total}
            limit={limit}
            disabled={isLoading}
            onPageChange={changePage}
            onLimitChange={changeLimit}
          />

          {isLoading && (
            <View testID="model-vs-sp-loading" style={styles.stateBlock}>
              <ActivityIndicator animating color={colors.accent} />
              <Text style={styles.stateText}>Loading runners…</Text>
            </View>
          )}

          {!isLoading && error && (
            <View testID="model-vs-sp-error" style={styles.stateBlock}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {!isLoading && !error && rows.length === 0 && hasFetched && (
            <View testID="model-vs-sp-empty" style={styles.stateBlock}>
              {/* Says WHY, not just "no results" — the rows require both a model
                  score and a real industry SP, and a filter combination that
                  can't be satisfied looks identical to a data gap otherwise. */}
              <Text style={styles.stateText}>
                No runners in this window match those filters. Every row needs both a model score and a real industry
                SP — try widening the difference range or the dates.
              </Text>
            </View>
          )}

          {!isLoading && !error && rows.length > 0 && (
            <View testID="model-vs-sp-list" style={styles.list}>
              {rows.map(renderRow)}
            </View>
          )}

          {rows.length > 0 && (
            <PaginationControls
              testIdPrefix="model-vs-sp-pagination-bottom"
              page={page}
              totalPages={totalPages}
              total={total}
              limit={limit}
              disabled={isLoading}
              onPageChange={changePage}
              onLimitChange={changeLimit}
            />
          )}
        </PageContainer>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  // The document body must never scroll — this ScrollView owns all vertical
  // movement (same constraint IndustrySpScreen documents).
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  filterBar: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  filterGridRow: {
    position: "relative",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  // Phone width: the hint drops onto its own line (it carries width:"100%",
  // which can never share a flex line), and the inputs take the space the hint
  // gave up instead of staying pinned at 84px each.
  filterGridRowNarrow: {
    flexWrap: "wrap",
    rowGap: 2,
  },
  filterGridRowElevated: {
    zIndex: 30,
  },
  filterGridLabel: {
    width: 92,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  // 84, not less: "Model %" plus its 18px tooltip toggle needs it to stay on
  // one line, and a label wrapping to two lines makes the rows unequal heights.
  filterGridLabelNarrow: {
    width: 84,
  },
  filterGridLabelText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textSecondary,
    flexShrink: 1,
  },
  gridInput: {
    width: 84,
    height: 40,
    fontSize: 16,
    fontWeight: "700",
    color: colors.text,
    textAlign: "center",
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: 4,
  },
  gridInputNarrow: {
    width: "auto",
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 56,
  },
  filterGridDash: {
    fontSize: 16,
    color: colors.textSecondary,
  },
  filterGridHint: {
    fontSize: 11,
    color: colors.textTertiary,
    flexShrink: 1,
  },
  filterGridHintNarrow: {
    width: "100%",
    // flexShrink:0 as well as width:100% — a shrinkable item could otherwise be
    // squeezed back onto the inputs' line instead of starting a new one.
    flexShrink: 0,
    textAlign: "right",
  },
  tooltipToggle: {
    width: 18,
    height: 18,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.textTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  tooltipToggleText: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: "700",
    color: colors.textSecondary,
  },
  tooltipText: {
    position: "absolute",
    top: "100%",
    left: 0,
    marginTop: 6,
    zIndex: 30,
    maxWidth: 280,
    fontSize: 12,
    lineHeight: 16,
    color: "#fff",
    backgroundColor: colors.text,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: radii.sm,
  },
  pillRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  // Phone width: a 92px label beside the strip costs a third of the row, and
  // "Month (2024)" wrapped onto two lines inside it. Stacked, the strip gets
  // the card's full width.
  pillRowNarrow: {
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 2,
  },
  pillRowLabel: {
    width: 92,
    fontSize: 13,
    fontWeight: "600",
    color: colors.textSecondary,
  },
  pillRowLabelNarrow: {
    width: "auto",
  },
  pillScrollView: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
  },
  // The stacked row is a column, so main-axis flex here would size the
  // strip's HEIGHT (a flexBasis of 0 would collapse it entirely) — the
  // narrow variant only needs the full width of its parent.
  pillScrollViewNarrow: {
    flexGrow: 0,
    flexShrink: 1,
    flexBasis: "auto",
    width: "100%",
  },
  pillScroll: {
    gap: spacing.xs,
    paddingRight: spacing.md,
  },
  pill: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  pillActive: {
    backgroundColor: colors.accent,
  },
  pillText: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  pillTextActive: {
    fontSize: 11,
    color: "#fff",
  },
  filterActions: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  toolbar: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  summaryCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  summaryTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.text,
  },
  summaryHeadline: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  summaryBrier: {
    marginTop: spacing.sm,
  },
  summaryBands: {
    gap: 4,
  },
  summaryBandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  summaryBandLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    width: 108,
  },
  summaryBarTrack: {
    flex: 1,
    height: 10,
    minWidth: 40,
    backgroundColor: colors.background,
    borderRadius: radii.pill,
    overflow: "hidden",
  },
  summaryBarFill: {
    height: "100%",
    backgroundColor: colors.accent,
    borderRadius: radii.pill,
  },
  summaryBarFillTail: {
    backgroundColor: colors.textTertiary,
  },
  summaryBandPercent: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.text,
    width: 48,
    textAlign: "right",
  },
  summaryBandCount: {
    fontSize: 10,
    color: colors.textTertiary,
    width: 56,
    textAlign: "right",
  },
  summarySelection: {
    fontSize: 12,
    color: colors.accent,
    fontWeight: "600",
  },
  countHeader: {
    gap: 2,
    marginBottom: spacing.xs,
  },
  countText: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.text,
  },
  pageRangeText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  stateBlock: {
    paddingVertical: spacing.xl,
    alignItems: "center",
    gap: spacing.sm,
  },
  stateText: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: "center",
    maxWidth: 420,
  },
  errorText: {
    fontSize: 13,
    color: colors.danger,
    textAlign: "center",
  },
  list: {
    gap: spacing.xs,
  },
  row: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  rowTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  rowDate: {
    fontSize: 12,
    color: colors.textSecondary,
    width: 52,
  },
  rowTime: {
    fontSize: 12,
    color: colors.textSecondary,
    width: 44,
  },
  rowCourse: {
    fontSize: 12,
    color: colors.textSecondary,
    maxWidth: 110,
  },
  rowRunner: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.text,
    flexShrink: 1,
    flexGrow: 1,
  },
  rowBottom: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  ispBadge: {
    fontSize: 11,
    color: colors.textSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
    overflow: "hidden",
  },
  modelBadge: {
    fontSize: 11,
    color: colors.accent,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: radii.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
    overflow: "hidden",
  },
  impliedBadge: {
    fontSize: 11,
    color: colors.textSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
    overflow: "hidden",
  },
  edgeBadge: {
    fontSize: 11,
    fontWeight: "700",
    borderRadius: radii.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
    overflow: "hidden",
  },
  edgePositive: {
    color: colors.success,
    backgroundColor: colors.successLight,
  },
  edgeNegative: {
    color: colors.danger,
    backgroundColor: "#FEE2E2",
  },
  edgeNeutral: {
    color: colors.textSecondary,
    backgroundColor: "#F1F5F9",
  },
  statusBadge: {
    fontSize: 10,
    fontWeight: "700",
    borderRadius: radii.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
    overflow: "hidden",
  },
});
