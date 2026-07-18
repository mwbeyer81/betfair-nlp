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
import {
  Text,
  Appbar,
  Button,
  Chip,
  ActivityIndicator,
} from "react-native-paper";
import { chatApi, IspFilterBounds, PnlStats } from "../services/chatApi";
import { SplitDetailPanel } from "./SplitDetailPanel";
import { buildSplitsCacheKey, readSplitsCache, writeSplitsCache, CachedSplitsResult } from "../utils/ispSplitsCache";
import { colors, radii, spacing } from "../theme";
import { formatPnl, formatPct } from "../utils/ispFormat";
import {
  urlIntParam,
  urlFloatParam,
  urlToRowParam,
  urlCountriesParam,
  urlHasParam,
  updateUrlParams,
} from "../utils/ispUrlParams";

interface IndustrySpScreenProps {
  onNavigateToEvents: () => void;
  onViewRaces: (fromRow: number, toRow: number | null) => void;
}

// Filter values are persisted to the URL query string (using the same param
// names the API itself uses) so a filtered view can be bookmarked, shared,
// carried over to the races screen, or survive a refresh. Only non-default
// values are written, so the URL stays clean (just "/isp") until the user
// actually changes something.
const FILTER_DEFAULTS = {
  minRunners: 1,
  maxRunners: 20,
  minIsp: 1,
  maxIsp: 1000,
  minInIspRange: 1,
  maxInIspRange: 30,
};

const FILTER_TOOLTIPS: Record<string, string> = {
  isp: "Only show races where the runner's official starting price (ISP) falls in this range.",
  runners: "Only show races with this many total runners taking part.",
  inIsp: "Only show races with this many runners priced inside the ISP range above, out of the full field.",
  raceA: "The first split of races — defaults to the earlier half of the matching races, so you can test a filter combination here first.",
  raceB: "The second split — defaults to the later half. Check whether the same filters are still profitable here before trusting them.",
};

const EMPTY_PNL: PnlStats = { staked: 0, returns: 0, pnl: 0 };

export const IndustrySpScreen: React.FC<IndustrySpScreenProps> = ({
  onNavigateToEvents,
  onViewRaces,
}) => {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draftMin, setDraftMin] = useState(() => String(urlIntParam("minRunners", FILTER_DEFAULTS.minRunners)));
  const [draftMax, setDraftMax] = useState(() => String(urlIntParam("maxRunners", FILTER_DEFAULTS.maxRunners)));
  const [draftMinIsp, setDraftMinIsp] = useState(() => String(urlFloatParam("minIsp", FILTER_DEFAULTS.minIsp)));
  const [draftMaxIsp, setDraftMaxIsp] = useState(() => String(urlFloatParam("maxIsp", FILTER_DEFAULTS.maxIsp)));
  const [draftMinRIR, setDraftMinRIR] = useState(() => String(urlIntParam("minInIspRange", FILTER_DEFAULTS.minInIspRange)));
  const [draftMaxRIR, setDraftMaxRIR] = useState(() => String(urlIntParam("maxInIspRange", FILTER_DEFAULTS.maxInIspRange)));
  const [minRunners, setMinRunners] = useState(() => urlIntParam("minRunners", FILTER_DEFAULTS.minRunners));
  const [maxRunners, setMaxRunners] = useState(() => urlIntParam("maxRunners", FILTER_DEFAULTS.maxRunners));
  const [minIsp, setMinIsp] = useState(() => urlFloatParam("minIsp", FILTER_DEFAULTS.minIsp));
  const [maxIsp, setMaxIsp] = useState(() => urlFloatParam("maxIsp", FILTER_DEFAULTS.maxIsp));
  const [minRunnersInRange, setMinRunnersInRange] = useState(() => urlIntParam("minInIspRange", FILTER_DEFAULTS.minInIspRange));
  const [maxRunnersInRange, setMaxRunnersInRange] = useState(() => urlIntParam("maxInIspRange", FILTER_DEFAULTS.maxInIspRange));
  const [selectedCountries, setSelectedCountries] = useState<Set<string>>(() => urlCountriesParam());
  const [availableCountries, setAvailableCountries] = useState<string[]>([]);
  const [fetchTrigger, setFetchTrigger] = useState(0);
  const [totalRaces, setTotalRaces] = useState(0);
  const [totalRunners, setTotalRunners] = useState(0);
  const [filterBounds, setFilterBounds] = useState<IspFilterBounds | null>(null);
  const [filtersVisible, setFiltersVisible] = useState(true);
  const [openTooltip, setOpenTooltip] = useState<string | null>(null);
  const [detailSplit, setDetailSplit] = useState<"a" | "b" | null>(null);

  // Two independent race-row splits, so a filter combination can be tested
  // on one half of the historical data and checked for profit on the other.
  // Until the user has applied an explicit split (or one arrived via a
  // bookmarked URL), the splits auto-compute to an even first-half/
  // second-half divide once the grand total is known.
  const splitsAreDefaultRef = useRef(!urlHasParam("fromRowA"));
  const [fromRowA, setFromRowA] = useState(() => urlIntParam("fromRowA", 1));
  const [toRowA, setToRowA] = useState<number | null>(() => urlToRowParam("toRowA"));
  const [draftFromA, setDraftFromA] = useState(() => String(urlIntParam("fromRowA", 1)));
  const [draftToA, setDraftToA] = useState(() => {
    const t = urlToRowParam("toRowA");
    return t != null ? String(t) : "0";
  });
  const [fromRowB, setFromRowB] = useState(() => urlIntParam("fromRowB", 1));
  const [toRowB, setToRowB] = useState<number | null>(() => urlToRowParam("toRowB"));
  const [draftFromB, setDraftFromB] = useState(() => String(urlIntParam("fromRowB", 1)));
  const [draftToB, setDraftToB] = useState(() => {
    const t = urlToRowParam("toRowB");
    return t != null ? String(t) : "0";
  });

  const [totalRacesA, setTotalRacesA] = useState(0);
  const [totalRunnersA, setTotalRunnersA] = useState(0);
  const [pnlStatsA, setPnlStatsA] = useState<PnlStats>(EMPTY_PNL);
  const [totalRacesB, setTotalRacesB] = useState(0);
  const [totalRunnersB, setTotalRunnersB] = useState(0);
  const [pnlStatsB, setPnlStatsB] = useState<PnlStats>(EMPTY_PNL);

  function applyFilter() {
    const maxRunnersLimit = filterBounds?.maxRunnersPerRace ?? 100;
    const maxIspLimit = filterBounds?.maxIsp ?? 100000;

    const min = Math.max(1, parseInt(draftMin) || 1);
    const max = Math.max(min, Math.min(maxRunnersLimit, parseInt(draftMax) || maxRunnersLimit));
    setDraftMin(String(min));
    setDraftMax(String(max));
    setMinRunners(min);
    setMaxRunners(max);

    const minI = Math.max(1, parseFloat(draftMinIsp) || 1);
    const maxI = Math.min(maxIspLimit, Math.max(minI, parseFloat(draftMaxIsp) || maxIspLimit));
    setDraftMinIsp(String(minI));
    setDraftMaxIsp(String(maxI));
    setMinIsp(minI);
    setMaxIsp(maxI);

    const minRIR = Math.max(1, parseInt(draftMinRIR) || 1);
    const maxRIR = Math.max(minRIR, Math.min(maxRunnersLimit, parseInt(draftMaxRIR) || maxRunnersLimit));
    setDraftMinRIR(String(minRIR));
    setDraftMaxRIR(String(maxRIR));
    setMinRunnersInRange(minRIR);
    setMaxRunnersInRange(maxRIR);

    // Once the user applies filters explicitly, the two race splits are no
    // longer auto-derived from the total — whatever's in the two Race boxes
    // (even if it's still the auto-filled 50/50 default) becomes the
    // committed split from here on.
    splitsAreDefaultRef.current = false;

    const fromA = Math.max(1, parseInt(draftFromA) || 1);
    const toARaw = Math.min(totalRaces || 1, Math.max(fromA, parseInt(draftToA) || totalRaces));
    const toA = toARaw >= totalRaces ? null : toARaw;
    setDraftFromA(String(fromA));
    setDraftToA(String(toA ?? totalRaces));
    setFromRowA(fromA);
    setToRowA(toA);

    const fromB = Math.max(1, parseInt(draftFromB) || 1);
    const toBRaw = Math.min(totalRaces || 1, Math.max(fromB, parseInt(draftToB) || totalRaces));
    const toB = toBRaw >= totalRaces ? null : toBRaw;
    setDraftFromB(String(fromB));
    setDraftToB(String(toB ?? totalRaces));
    setFromRowB(fromB);
    setToRowB(toB);

    setFetchTrigger(t => t + 1);
  }

  function resetFilters() {
    setMinRunners(FILTER_DEFAULTS.minRunners);
    setMaxRunners(FILTER_DEFAULTS.maxRunners);
    setDraftMin(String(FILTER_DEFAULTS.minRunners));
    setDraftMax(String(FILTER_DEFAULTS.maxRunners));
    setMinIsp(FILTER_DEFAULTS.minIsp);
    setMaxIsp(FILTER_DEFAULTS.maxIsp);
    setDraftMinIsp(String(FILTER_DEFAULTS.minIsp));
    setDraftMaxIsp(String(FILTER_DEFAULTS.maxIsp));
    setMinRunnersInRange(FILTER_DEFAULTS.minInIspRange);
    setMaxRunnersInRange(FILTER_DEFAULTS.maxInIspRange);
    setDraftMinRIR(String(FILTER_DEFAULTS.minInIspRange));
    setDraftMaxRIR(String(FILTER_DEFAULTS.maxInIspRange));
    setSelectedCountries(new Set());

    // Hand the two race splits back to auto (even first-half/second-half)
    // mode — the next fetch recomputes them from the fresh grand total.
    splitsAreDefaultRef.current = true;
    setFromRowA(1);
    setToRowA(null);
    setDraftFromA("1");
    setDraftToA("0");
    setFromRowB(1);
    setToRowB(null);
    setDraftFromB("1");
    setDraftToB("0");

    setFetchTrigger(t => t + 1);
  }

  useEffect(() => {
    let cancelled = false;

    function applyResult(result: CachedSplitsResult) {
      setTotalRaces(result.totalRaces);
      setTotalRunners(result.totalRunners);
      setFilterBounds(result.filterBounds);
      setAvailableCountries(result.countries);

      setFromRowA(result.splitA.fromRow);
      setToRowA(result.splitA.toRow);
      setFromRowB(result.splitB.fromRow);
      setToRowB(result.splitB.toRow);

      // Keep the draft boxes in sync with whatever range was actually
      // queried — including filling in an open-ended ("no cap") upper
      // bound with the grand total, so a box never shows a stale
      // placeholder value (e.g. when a bookmarked URL set fromRowA/
      // fromRowB explicitly but left the upper bound uncapped).
      setDraftFromA(String(result.splitA.fromRow));
      setDraftToA(String(result.splitA.toRow ?? result.totalRaces));
      setDraftFromB(String(result.splitB.fromRow));
      setDraftToB(String(result.splitB.toRow ?? result.totalRaces));

      setTotalRacesA(result.splitA.total);
      setTotalRunnersA(result.splitA.totalRunners);
      setPnlStatsA(result.splitA.pnlStats ?? EMPTY_PNL);
      setTotalRacesB(result.splitB.total);
      setTotalRunnersB(result.splitB.totalRunners);
      setPnlStatsB(result.splitB.pnlStats ?? EMPTY_PNL);
    }

    // Keeps the URL query string in sync with the currently *applied*
    // filters/split (not draft/in-progress typing) so a filtered view can
    // be bookmarked, shared, carried over to the races screen, or survive
    // a refresh. Called synchronously right after applyResult(), in the
    // same tick, rather than as its own reactive useEffect watching
    // fromRowA/toRowA/etc — those values change *as a result of* this
    // fetch, so a separate effect reacting to them lags by one extra
    // render/commit. That gap is enough for a fast click on "View Races"
    // (a real risk in an automated test, and in principle for a human too)
    // to read window.location.search before the split boundaries had
    // landed in it, silently dropping them for the return trip and
    // defeating the sessionStorage cache below (a differently-shaped
    // request — no fromRowA/toRowA — can't hit the same cache entry).
    function syncUrl(result: CachedSplitsResult, isDefault: boolean) {
      updateUrlParams({
        minRunners: minRunners !== FILTER_DEFAULTS.minRunners ? String(minRunners) : undefined,
        maxRunners: maxRunners !== FILTER_DEFAULTS.maxRunners ? String(maxRunners) : undefined,
        minIsp: minIsp !== FILTER_DEFAULTS.minIsp ? String(minIsp) : undefined,
        maxIsp: maxIsp !== FILTER_DEFAULTS.maxIsp ? String(maxIsp) : undefined,
        minInIspRange: minRunnersInRange !== FILTER_DEFAULTS.minInIspRange ? String(minRunnersInRange) : undefined,
        maxInIspRange: maxRunnersInRange !== FILTER_DEFAULTS.maxInIspRange ? String(maxRunnersInRange) : undefined,
        countries: selectedCountries.size > 0 ? [...selectedCountries].sort().join(",") : undefined,
        // Only write the split boundaries once the user has explicitly
        // applied a custom split — writing the auto-computed default here
        // too would make the *next* mount think a custom split was already
        // set (urlHasParam("fromRowA") would find it), silently switching
        // that mount from "ask the backend for the default" to "request
        // this exact fromRowA/toRowA": a differently shaped request that
        // couldn't reuse the sessionStorage cache, even though nothing had
        // actually changed since the previous visit.
        fromRowA: !isDefault ? String(result.splitA.fromRow) : undefined,
        toRowA: !isDefault && result.splitA.toRow != null ? String(result.splitA.toRow) : undefined,
        fromRowB: !isDefault ? String(result.splitB.fromRow) : undefined,
        toRowB: !isDefault && result.splitB.toRow != null ? String(result.splitB.toRow) : undefined,
      });
    }

    (async () => {
      setError(null);
      const isDefault = splitsAreDefaultRef.current;
      const cacheKey = buildSplitsCacheKey({
        minRunners, maxRunners, countries: [...selectedCountries], minIsp, maxIsp,
        minRunnersInRange, maxRunnersInRange, isDefault, fromRowA, toRowA, fromRowB, toRowB,
      });

      // fetchTrigger only ever increments via Apply/Reset — anything else
      // that re-runs this effect (fetchTrigger still 0) is a re-mount, not
      // a user asking for fresh data: navigating to /isp/races and back via
      // "← Filters", re-opening the split detail panel, etc. Reuse the last
      // known-good result for this exact filter/split combination instead
      // of re-fetching — this is what used to make "tap Filters" feel like
      // it reloaded from scratch even though nothing had changed.
      if (fetchTrigger === 0) {
        const cached = readSplitsCache(cacheKey);
        if (cached) {
          applyResult(cached);
          syncUrl(cached, isDefault);
          setIsLoading(false);
          return;
        }
      }

      setIsLoading(true);
      try {
        // One request for the grand total + both splits — see
        // chatApi.getIndustrySpSplits / the backend's getSplitStats for
        // why this used to be 3 separate concurrent requests (each risking
        // its own Lambda cold start / Atlas M0 connection contention) and
        // isn't anymore. Omitting fromRowA/toRowA/fromRowB/toRowB lets the
        // backend compute the even first-half/second-half default itself.
        const result = await chatApi.getIndustrySpSplits(
          minRunners, maxRunners, [...selectedCountries], minIsp, maxIsp, minRunnersInRange, maxRunnersInRange,
          isDefault ? undefined : fromRowA,
          isDefault ? undefined : (toRowA ?? undefined),
          isDefault ? undefined : fromRowB,
          isDefault ? undefined : (toRowB ?? undefined)
        );
        if (cancelled) return;
        applyResult(result);
        syncUrl(result, isDefault);
        writeSplitsCache(cacheKey, result);
      } catch {
        if (!cancelled) setError("Failed to load industry SP");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchTrigger]);

  function renderTooltipToggle(key: string) {
    return (
      <TouchableOpacity
        testID={`industry-sp-tooltip-toggle-${key}`}
        onPress={() => setOpenTooltip(t => (t === key ? null : key))}
        hitSlop={{ top: 13, bottom: 13, left: 13, right: 13 }}
        style={styles.tooltipToggle}
      >
        <Text style={styles.tooltipToggleText}>?</Text>
      </TouchableOpacity>
    );
  }

  function renderTooltipText(key: string) {
    if (openTooltip !== key) return null;
    return (
      <Text testID={`industry-sp-tooltip-text-${key}`} style={styles.tooltipText}>
        {FILTER_TOOLTIPS[key]}
      </Text>
    );
  }

  function renderFilterRow(opts: {
    filterKey: string;
    label: string;
    labelTestId?: string;
    minValue: string;
    onMinChange: (v: string) => void;
    minTestId: string;
    maxValue: string;
    onMaxChange: (v: string) => void;
    maxTestId: string;
    keyboardType: KeyboardTypeOptions;
    maxLength: number;
    hint?: string | null;
    hintTestId?: string;
  }) {
    const {
      filterKey, label, labelTestId,
      minValue, onMinChange, minTestId,
      maxValue, onMaxChange, maxTestId,
      keyboardType, maxLength, hint, hintTestId,
    } = opts;
    return (
      <View
        key={filterKey}
        testID={`industry-sp-filter-row-${filterKey}`}
        style={[styles.filterGridRow, openTooltip === filterKey && styles.filterGridRowElevated]}
      >
        <View style={styles.filterGridLabel}>
          <Text testID={labelTestId} style={styles.filterGridLabelText}>{label}</Text>
          {renderTooltipToggle(filterKey)}
        </View>
        <RNTextInput
          testID={minTestId}
          style={styles.gridInput}
          value={minValue}
          onChangeText={onMinChange}
          keyboardType={keyboardType}
          maxLength={maxLength}
        />
        <Text style={styles.filterGridDash}>–</Text>
        <RNTextInput
          testID={maxTestId}
          style={styles.gridInput}
          value={maxValue}
          onChangeText={onMaxChange}
          keyboardType={keyboardType}
          maxLength={maxLength}
        />
        <Text testID={hintTestId} style={styles.filterGridHint}>{hint ?? ""}</Text>
        {renderTooltipText(filterKey)}
      </View>
    );
  }

  function renderSplitCard(opts: {
    id: "a" | "b";
    label: string;
    fromRow: number;
    toRow: number | null;
    totalRaces: number;
    totalRunners: number;
    pnl: PnlStats;
  }) {
    const { id, label, fromRow, toRow, totalRaces: splitTotalRaces, totalRunners: splitTotalRunners, pnl } = opts;
    const effectiveTo = toRow ?? totalRaces;
    return (
      <View testID={`industry-sp-split-card-${id}`} style={styles.splitCard}>
        <Text style={styles.splitCardLabel}>
          {label} — races {fromRow}–{effectiveTo}
        </Text>
        {pnl.staked > 0 ? (
          <Text testID={`industry-sp-pnl-${id}`} style={[styles.pnlHeadline, pnl.pnl >= 0 ? styles.pnlPos : styles.pnlNeg]} numberOfLines={1}>
            {formatPnl(pnl.pnl)}{" "}
            <Text style={[styles.pnlPct, pnl.pnl >= 0 ? styles.pnlPos : styles.pnlNeg]}>
              ({formatPct(pnl.pnl, pnl.staked)})
            </Text>
          </Text>
        ) : (
          <Text testID={`industry-sp-split-empty-${id}`} style={styles.splitEmptyText}>
            {splitTotalRunners > 0 ? "No qualifying bets in this split." : "No races match this split."}
          </Text>
        )}
        <View style={styles.splitButtonRow}>
          <Button
            testID={`industry-sp-split-details-button-${id}`}
            mode="outlined"
            compact
            onPress={() => setDetailSplit(id)}
            style={styles.splitDetailsButton}
            labelStyle={styles.splitDetailsButtonLabel}
          >
            Details
          </Button>
          <Button
            testID={`industry-sp-view-races-button-${id}`}
            mode="contained"
            compact
            onPress={() => onViewRaces(fromRow, toRow)}
            style={styles.splitViewButton}
            labelStyle={styles.splitViewButtonLabel}
          >
            View {splitTotalRaces} Races →
          </Button>
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView testID="industry-sp-screen" style={styles.screen}>
      <Appbar.Header style={styles.appbar}>
        <Appbar.Content
          title="Industry Starting Price"
          subtitle={!isLoading ? `${totalRunners} runners · ${totalRaces} races` : undefined}
          titleStyle={styles.appbarTitle}
          subtitleStyle={styles.appbarSubtitle}
        />
        <Button
          testID="industry-sp-screen-events-button"
          mode="contained"
          compact
          buttonColor={colors.accent}
          onPress={onNavigateToEvents}
          style={styles.headerButton}
          labelStyle={styles.headerButtonLabel}
        >
          ← Events
        </Button>
      </Appbar.Header>

      {/*
        The document/body itself can never scroll on this app (see
        index.html — html/body are locked with position:fixed +
        overflow:hidden to stop iOS Safari's pinch-zoom/bounce-scroll from
        dragging the whole page around), so any content taller than the
        viewport MUST live inside a real RN ScrollView or it's simply
        unreachable — confirmed live on iOS: the second split card was
        cut off below the fold with no way to reach it. This ScrollView is
        that fix; the Appbar header stays outside it (fixed), and the
        SplitDetailPanel overlay below also stays outside it (full-screen
        regardless of scroll position).
      */}
      <ScrollView
        testID="industry-sp-scroll"
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
      >
      <View testID="industry-sp-toolbar" style={styles.toolbar}>
        <Button
          testID="industry-sp-filters-toggle"
          mode="outlined"
          compact
          onPress={() => setFiltersVisible(v => !v)}
          style={styles.toolbarButton}
          labelStyle={styles.toolbarButtonLabel}
        >
          {filtersVisible ? "Hide filters ▾" : "Show filters ▸"}
        </Button>
      </View>

      {/* Filter grid — kept as custom for tight column alignment */}
      {filtersVisible && (
      <View testID="industry-sp-filter-bar" style={[styles.filterGrid, openTooltip != null && styles.filterGridElevated]}>
        {renderFilterRow({
          filterKey: "isp",
          label: "ISP",
          minValue: draftMinIsp,
          onMinChange: setDraftMinIsp,
          minTestId: "industry-sp-min-isp",
          maxValue: draftMaxIsp,
          onMaxChange: setDraftMaxIsp,
          maxTestId: "industry-sp-max-isp",
          keyboardType: "decimal-pad",
          maxLength: 7,
          hint: filterBounds != null ? `(${filterBounds.minIsp.toFixed(1)}–${Math.ceil(filterBounds.maxIsp)})` : null,
          hintTestId: "industry-sp-sp-bound",
        })}
        {renderFilterRow({
          filterKey: "runners",
          label: "Runners",
          minValue: draftMin,
          onMinChange: setDraftMin,
          minTestId: "industry-sp-min-value",
          maxValue: draftMax,
          onMaxChange: setDraftMax,
          maxTestId: "industry-sp-max-value",
          keyboardType: "numeric",
          maxLength: 3,
          hint: filterBounds != null ? `/${filterBounds.maxRunnersPerRace}` : null,
          hintTestId: "industry-sp-max-bound",
        })}
        {renderFilterRow({
          filterKey: "inIsp",
          label: "# in ISP",
          labelTestId: "industry-sp-in-isp-label",
          minValue: draftMinRIR,
          onMinChange: setDraftMinRIR,
          minTestId: "industry-sp-min-rir-value",
          maxValue: draftMaxRIR,
          onMaxChange: setDraftMaxRIR,
          maxTestId: "industry-sp-max-rir-value",
          keyboardType: "numeric",
          maxLength: 3,
          hint: filterBounds != null ? `/${filterBounds.maxRunnersPerRace}` : null,
          hintTestId: "industry-sp-max-rir-bound",
        })}
        {renderFilterRow({
          filterKey: "raceA",
          label: "Race A",
          minValue: draftFromA,
          onMinChange: setDraftFromA,
          minTestId: "industry-sp-from-row-a",
          maxValue: draftToA,
          onMaxChange: setDraftToA,
          maxTestId: "industry-sp-to-row-a",
          keyboardType: "numeric",
          maxLength: 6,
          hint: totalRaces > 0 ? `/${totalRaces}` : null,
          hintTestId: "industry-sp-race-bound-a",
        })}
        {renderFilterRow({
          filterKey: "raceB",
          label: "Race B",
          minValue: draftFromB,
          onMinChange: setDraftFromB,
          minTestId: "industry-sp-from-row-b",
          maxValue: draftToB,
          onMaxChange: setDraftToB,
          maxTestId: "industry-sp-to-row-b",
          keyboardType: "numeric",
          maxLength: 6,
          hint: totalRaces > 0 ? `/${totalRaces}` : null,
          hintTestId: "industry-sp-race-bound-b",
        })}
        <View style={styles.filterActions}>
          <Button
            testID="industry-sp-filter-apply"
            mode="contained"
            compact
            onPress={applyFilter}
            style={styles.applyBtn}
            labelStyle={styles.applyBtnLabel}
          >
            Apply
          </Button>
          <Button
            testID="industry-sp-filter-reset"
            mode="outlined"
            compact
            onPress={resetFilters}
            style={styles.resetBtn}
            labelStyle={styles.resetBtnLabel}
          >
            Reset
          </Button>
        </View>
      </View>
      )}

      {!isLoading && availableCountries.length > 0 && (
        <ScrollView
          horizontal
          testID="industry-sp-country-bar"
          style={styles.countryBar}
          contentContainerStyle={styles.countryBarContent}
          showsHorizontalScrollIndicator={false}
        >
          {availableCountries.map(code => {
            const active = selectedCountries.has(code);
            return (
              <Chip
                key={code}
                testID={`industry-sp-country-${code}`}
                compact
                mode={active ? "flat" : "outlined"}
                selected={active}
                onPress={() => {
                  setSelectedCountries(prev => {
                    const next = new Set(prev);
                    if (next.has(code)) next.delete(code); else next.add(code);
                    return next;
                  });
                  const minRIR = Math.max(1, parseInt(draftMinRIR) || 1);
                  const maxRIR = Math.max(minRIR, Math.min(filterBounds?.maxRunnersPerRace ?? 100, parseInt(draftMaxRIR) || 100));
                  setDraftMinRIR(String(minRIR));
                  setDraftMaxRIR(String(maxRIR));
                  setMinRunnersInRange(minRIR);
                  setMaxRunnersInRange(maxRIR);
                  setFetchTrigger(t => t + 1);
                }}
                style={active ? styles.countryChipActive : styles.countryChip}
                textStyle={active ? styles.countryChipTextActive : styles.countryChipText}
              >
                {code}
              </Chip>
            );
          })}
        </ScrollView>
      )}

      <View testID="industry-sp-split-cards" style={styles.splitCards}>
        {isLoading && (
          <View testID="industry-sp-loading" style={styles.centered}>
            <ActivityIndicator size="large" animating color={colors.primary} />
            <Text variant="bodyMedium" style={styles.loadingText}>
              Loading industry SP…
            </Text>
          </View>
        )}

        {error && !isLoading && (
          <View testID="industry-sp-error" style={styles.centered}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {!isLoading && !error && (
          <>
            {renderSplitCard({
              id: "a",
              label: "Split A",
              fromRow: fromRowA,
              toRow: toRowA,
              totalRaces: totalRacesA,
              totalRunners: totalRunnersA,
              pnl: pnlStatsA,
            })}
            {renderSplitCard({
              id: "b",
              label: "Split B",
              fromRow: fromRowB,
              toRow: toRowB,
              totalRaces: totalRacesB,
              totalRunners: totalRunnersB,
              pnl: pnlStatsB,
            })}
          </>
        )}
      </View>
      </ScrollView>

      {detailSplit != null && (
        <SplitDetailPanel
          id={detailSplit}
          label={detailSplit === "a" ? "Split A" : "Split B"}
          fromRow={detailSplit === "a" ? fromRowA : fromRowB}
          toRow={(detailSplit === "a" ? toRowA : toRowB) ?? totalRaces}
          totalRaces={detailSplit === "a" ? totalRacesA : totalRacesB}
          totalRunners={detailSplit === "a" ? totalRunnersA : totalRunnersB}
          pnl={detailSplit === "a" ? pnlStatsA : pnlStatsB}
          onClose={() => setDetailSplit(null)}
          onViewRaces={() => {
            const fromRow = detailSplit === "a" ? fromRowA : fromRowB;
            const toRow = detailSplit === "a" ? toRowA : toRowB;
            setDetailSplit(null);
            onViewRaces(fromRow, toRow);
          }}
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  appbar: {
    backgroundColor: colors.primary,
    elevation: 4,
  },
  appbarTitle: {
    color: "white",
    fontSize: 18,
    fontWeight: "700",
  },
  appbarSubtitle: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 11,
  },
  headerButton: {
    marginHorizontal: 3,
    borderRadius: radii.md,
  },
  headerButtonLabel: {
    fontSize: 11,
    fontWeight: "600",
  },
  toolbar: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  toolbarButton: {
    borderRadius: radii.sm,
    borderColor: colors.primary,
  },
  toolbarButtonLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.primary,
  },
  filterGrid: {
    position: "relative",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.primaryLight,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  filterGridElevated: {
    zIndex: 40,
  },
  filterGridRow: {
    position: "relative",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
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
  filterGridLabelText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textSecondary,
    flexShrink: 1,
  },
  tooltipToggle: {
    width: 26,
    height: 26,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.textTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  tooltipToggleText: {
    fontSize: 12,
    lineHeight: 14,
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
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 4,
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
  filterGridDash: {
    fontSize: 16,
    color: colors.textSecondary,
  },
  filterGridHint: {
    fontSize: 11,
    color: colors.textTertiary,
    fontWeight: "500",
    flexShrink: 1,
  },
  filterActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  applyBtn: {
    borderRadius: radii.sm,
    flex: 1,
  },
  applyBtnLabel: {
    fontSize: 14,
    fontWeight: "700",
  },
  resetBtn: {
    borderRadius: radii.sm,
    borderColor: colors.primary,
  },
  resetBtnLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.primary,
  },
  countryBar: {
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    maxHeight: 38,
    ...({ overscrollBehavior: "contain" } as any),
  },
  countryBarContent: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    gap: 6,
  },
  countryChip: {
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  countryChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  countryChipText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textSecondary,
  },
  countryChipTextActive: {
    color: "#fff",
  },
  splitCards: {
    padding: spacing.md,
    gap: spacing.md,
  },
  splitCard: {
    backgroundColor: colors.text,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  splitCardLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "rgba(255,255,255,0.85)",
  },
  splitEmptyText: {
    fontSize: 12,
    color: "rgba(255,255,255,0.5)",
  },
  pnlHeadline: {
    fontSize: 18,
    fontWeight: "700",
  },
  pnlPct: {
    fontSize: 13,
    fontWeight: "400",
    opacity: 0.8,
  },
  pnlPos: {
    color: colors.pnlPositive,
  },
  pnlNeg: {
    color: colors.pnlNegative,
  },
  splitButtonRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  splitDetailsButton: {
    borderRadius: radii.sm,
    borderColor: "rgba(255,255,255,0.4)",
  },
  splitDetailsButtonLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: "#fff",
  },
  splitViewButton: {
    borderRadius: radii.sm,
    flex: 1,
  },
  splitViewButtonLabel: {
    fontSize: 13,
    fontWeight: "700",
  },
  centered: {
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
    gap: spacing.sm,
  },
  loadingText: {
    color: colors.textSecondary,
  },
  errorText: {
    color: colors.danger,
    fontSize: 16,
  },
});
