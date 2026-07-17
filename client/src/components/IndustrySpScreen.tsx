import React, { useState, useEffect } from "react";
import {
  View,
  ScrollView,
  TextInput as RNTextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
} from "react-native";
import {
  Text,
  Appbar,
  Button,
  Chip,
  ActivityIndicator,
} from "react-native-paper";
import { chatApi, IspRace, IspRunner, PnlStats, IspFilterBounds } from "../services/chatApi";
import { colors, statusPill, radii, spacing } from "../theme";
import {
  stakeToWin1,
  formatGbp,
  formatPnl,
  formatPct,
  formatIsp,
  computeRangePnl,
  runnerPnl,
  formatRaceTime,
  formatRaceDate,
  OddsMode,
} from "../utils/ispFormat";

interface IndustrySpScreenProps {
  onNavigateToEvents: () => void;
  onNavigateToMeeting: (meetingId: string) => void;
  onNavigateToRace: (raceId: number) => void;
}

// Filter values are persisted to the URL query string (using the same param
// names the API itself uses) so a filtered view can be bookmarked, shared, or
// survive a refresh. Only non-default values are written, so the URL stays
// clean (just "/isp") until the user actually changes something.
const FILTER_DEFAULTS = {
  minRunners: 1,
  maxRunners: 20,
  fromRow: 1,
  minIsp: 1,
  maxIsp: 1000,
  minInIspRange: 1,
  maxInIspRange: 30,
  sort: "asc" as const,
};

const FILTER_TOOLTIPS: Record<string, string> = {
  isp: "Only show races where the runner's official starting price (ISP) falls in this range.",
  runners: "Only show races with this many total runners taking part.",
  inIsp: "Only show races with this many runners priced inside the ISP range above, out of the full field.",
  race: "Restrict results to races numbered within this range, out of the total matching races.",
};

function getUrlSearchParams(): URLSearchParams | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search);
}

function urlIntParam(name: string, fallback: number): number {
  const raw = getUrlSearchParams()?.get(name);
  if (raw == null) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function urlFloatParam(name: string, fallback: number): number {
  const raw = getUrlSearchParams()?.get(name);
  if (raw == null) return fallback;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

function urlToRowParam(): number | null {
  const raw = getUrlSearchParams()?.get("toRow");
  if (raw == null) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

function urlCountriesParam(): Set<string> {
  const raw = getUrlSearchParams()?.get("countries");
  if (!raw) return new Set();
  return new Set(raw.split(",").filter(Boolean));
}

function urlSortParam(): "asc" | "desc" {
  return getUrlSearchParams()?.get("sort") === "desc" ? "desc" : "asc";
}

function updateUrlParams(params: Record<string, string | undefined>) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  Object.entries(params).forEach(([key, value]) => {
    if (value == null || value === "") url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  });
  window.history.replaceState({}, "", url.pathname + url.search);
}

export const IndustrySpScreen: React.FC<IndustrySpScreenProps> = ({
  onNavigateToEvents,
  onNavigateToMeeting,
  onNavigateToRace,
}) => {
  const [races, setRaces] = useState<IspRace[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [minRunners, setMinRunners] = useState(() => urlIntParam("minRunners", FILTER_DEFAULTS.minRunners));
  const [maxRunners, setMaxRunners] = useState(() => urlIntParam("maxRunners", FILTER_DEFAULTS.maxRunners));
  const [draftMin, setDraftMin] = useState(() => String(urlIntParam("minRunners", FILTER_DEFAULTS.minRunners)));
  const [draftMax, setDraftMax] = useState(() => String(urlIntParam("maxRunners", FILTER_DEFAULTS.maxRunners)));
  const [fromRow, setFromRow] = useState(() => urlIntParam("fromRow", FILTER_DEFAULTS.fromRow));
  const [toRow, setToRow] = useState<number | null>(() => urlToRowParam());
  const [draftFrom, setDraftFrom] = useState(() => String(urlIntParam("fromRow", FILTER_DEFAULTS.fromRow)));
  const [draftTo, setDraftTo] = useState(() => {
    const t = urlToRowParam();
    return t != null ? String(t) : "0";
  });
  const [minIsp, setMinIsp] = useState(() => urlFloatParam("minIsp", FILTER_DEFAULTS.minIsp));
  const [maxIsp, setMaxIsp] = useState(() => urlFloatParam("maxIsp", FILTER_DEFAULTS.maxIsp));
  const [draftMinIsp, setDraftMinIsp] = useState(() => String(urlFloatParam("minIsp", FILTER_DEFAULTS.minIsp)));
  const [draftMaxIsp, setDraftMaxIsp] = useState(() => String(urlFloatParam("maxIsp", FILTER_DEFAULTS.maxIsp)));
  const [minRunnersInRange, setMinRunnersInRange] = useState(() => urlIntParam("minInIspRange", FILTER_DEFAULTS.minInIspRange));
  const [maxRunnersInRange, setMaxRunnersInRange] = useState(() => urlIntParam("maxInIspRange", FILTER_DEFAULTS.maxInIspRange));
  const [draftMinRIR, setDraftMinRIR] = useState(() => String(urlIntParam("minInIspRange", FILTER_DEFAULTS.minInIspRange)));
  const [draftMaxRIR, setDraftMaxRIR] = useState(() => String(urlIntParam("maxInIspRange", FILTER_DEFAULTS.maxInIspRange)));
  const [selectedCountries, setSelectedCountries] = useState<Set<string>>(() => urlCountriesParam());
  const [availableCountries, setAvailableCountries] = useState<string[]>([]);
  const [fetchTrigger, setFetchTrigger] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalRaces, setTotalRaces] = useState(0);
  const [totalRunners, setTotalRunners] = useState(0);
  const [pnlStats, setPnlStats] = useState<PnlStats>({ staked: 0, returns: 0, pnl: 0 });
  const [filterBounds, setFilterBounds] = useState<IspFilterBounds | null>(null);
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">(() => urlSortParam());
  const [oddsMode, setOddsMode] = useState<OddsMode>("fraction");
  const [filtersVisible, setFiltersVisible] = useState(true);
  const [openTooltip, setOpenTooltip] = useState<string | null>(null);
  const PAGE_SIZE = 20;

  function applyFilter() {
    const maxRunnersLimit = filterBounds?.maxRunnersPerRace ?? 100;
    const maxIspLimit = filterBounds?.maxIsp ?? 100000;

    const min = Math.max(1, parseInt(draftMin) || 1);
    const max = Math.max(min, Math.min(maxRunnersLimit, parseInt(draftMax) || maxRunnersLimit));
    setDraftMin(String(min));
    setDraftMax(String(max));
    setMinRunners(min);
    setMaxRunners(max);

    const from = Math.max(1, parseInt(draftFrom) || 1);
    const toRaw = Math.min(totalRaces, Math.max(from, parseInt(draftTo) || totalRaces));
    const to = toRaw >= totalRaces ? null : toRaw;
    setDraftFrom(String(from));
    setDraftTo(String(to ?? totalRaces));
    setFromRow(from);
    setToRow(to);

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

    setFetchTrigger(t => t + 1);
  }

  function resetFilters() {
    setMinRunners(FILTER_DEFAULTS.minRunners);
    setMaxRunners(FILTER_DEFAULTS.maxRunners);
    setDraftMin(String(FILTER_DEFAULTS.minRunners));
    setDraftMax(String(FILTER_DEFAULTS.maxRunners));
    setFromRow(FILTER_DEFAULTS.fromRow);
    setToRow(null);
    setDraftFrom(String(FILTER_DEFAULTS.fromRow));
    setDraftTo("0");
    setMinIsp(FILTER_DEFAULTS.minIsp);
    setMaxIsp(FILTER_DEFAULTS.maxIsp);
    setDraftMinIsp(String(FILTER_DEFAULTS.minIsp));
    setDraftMaxIsp(String(FILTER_DEFAULTS.maxIsp));
    setMinRunnersInRange(FILTER_DEFAULTS.minInIspRange);
    setMaxRunnersInRange(FILTER_DEFAULTS.maxInIspRange);
    setDraftMinRIR(String(FILTER_DEFAULTS.minInIspRange));
    setDraftMaxRIR(String(FILTER_DEFAULTS.maxInIspRange));
    setSelectedCountries(new Set());
    setSortOrder(FILTER_DEFAULTS.sort);
    setFetchTrigger(t => t + 1);
  }

  // Keep the URL query string in sync with the currently *applied* filters
  // (not draft/in-progress typing) so a filtered view can be bookmarked,
  // shared, or survives a refresh. Only fires on committed changes — Apply,
  // a country chip click, the sort toggle, or Reset — since those are the
  // only actions that update these particular state variables.
  useEffect(() => {
    updateUrlParams({
      minRunners: minRunners !== FILTER_DEFAULTS.minRunners ? String(minRunners) : undefined,
      maxRunners: maxRunners !== FILTER_DEFAULTS.maxRunners ? String(maxRunners) : undefined,
      fromRow: fromRow !== FILTER_DEFAULTS.fromRow ? String(fromRow) : undefined,
      toRow: toRow != null ? String(toRow) : undefined,
      minIsp: minIsp !== FILTER_DEFAULTS.minIsp ? String(minIsp) : undefined,
      maxIsp: maxIsp !== FILTER_DEFAULTS.maxIsp ? String(maxIsp) : undefined,
      minInIspRange: minRunnersInRange !== FILTER_DEFAULTS.minInIspRange ? String(minRunnersInRange) : undefined,
      maxInIspRange: maxRunnersInRange !== FILTER_DEFAULTS.maxInIspRange ? String(maxRunnersInRange) : undefined,
      countries: selectedCountries.size > 0 ? [...selectedCountries].sort().join(",") : undefined,
      sort: sortOrder !== FILTER_DEFAULTS.sort ? sortOrder : undefined,
    });
  }, [minRunners, maxRunners, fromRow, toRow, minIsp, maxIsp, minRunnersInRange, maxRunnersInRange, selectedCountries, sortOrder]);

  useEffect(() => {
    chatApi.getIspCountries().then(setAvailableCountries).catch(() => {});
    chatApi.getIspFilterBounds().then(setFilterBounds).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setError(null);
      setRaces([]);
      try {
        const result = await chatApi.getIndustrySp(1, PAGE_SIZE, minRunners, maxRunners, [...selectedCountries], minIsp, maxIsp, sortOrder, minRunnersInRange, maxRunnersInRange, fromRow, toRow ?? undefined);
        if (cancelled) return;
        setRaces(result.data);
        setPage(1);
        setTotalPages(result.totalPages);
        setTotalRaces(result.total);
        setTotalRunners(result.totalRunners);
        setPnlStats(result.pnlStats ?? { staked: 0, returns: 0, pnl: 0 });
        if (toRow == null) setDraftTo(String(result.total));
      } catch {
        if (!cancelled) setError("Failed to load industry SP");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchTrigger, sortOrder]);

  async function loadMore() {
    if (isLoadingMore || page >= totalPages) return;
    setIsLoadingMore(true);
    try {
      const next = page + 1;
      const result = await chatApi.getIndustrySp(next, PAGE_SIZE, minRunners, maxRunners, [...selectedCountries], minIsp, maxIsp, sortOrder, minRunnersInRange, maxRunnersInRange, fromRow, toRow ?? undefined);
      setRaces(prev => [...prev, ...result.data]);
      setPage(next);
      setTotalPages(result.totalPages);
    } catch {
      // silently ignore
    } finally {
      setIsLoadingMore(false);
    }
  }

  const visibleRaces = races.filter(race => race.runners.length > 0);
  const visibleRunners = visibleRaces.reduce((sum, r) => sum + r.runners.length, 0);

  const hasRowRange = fromRow > 1 || toRow != null;
  const effectiveToRow = toRow ?? totalRaces;
  const displayRaces = visibleRaces;
  const displayPnl = pnlStats;

  const byMeeting = displayRaces.reduce<Record<string, { meetingName: string; races: IspRace[] }>>(
    (acc, race) => {
      if (!acc[race.meetingId]) {
        acc[race.meetingId] = { meetingName: race.meetingName, races: [] };
      }
      acc[race.meetingId].races.push(race);
      return acc;
    },
    {}
  );

  function renderTooltipToggle(key: string) {
    return (
      <TouchableOpacity
        testID={`industry-sp-tooltip-toggle-${key}`}
        onPress={() => setOpenTooltip(t => (t === key ? null : key))}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
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

  return (
    <SafeAreaView testID="industry-sp-screen" style={styles.screen}>
      <Appbar.Header style={styles.appbar}>
        <Appbar.Content
          title="Industry Starting Price"
          subtitle={!isLoading ? `${visibleRunners}/${totalRunners} runners · ${displayRaces.length}/${totalRaces} races` : undefined}
          titleStyle={styles.appbarTitle}
          subtitleStyle={styles.appbarSubtitle}
        />
        <Button
          testID="industry-sp-sort-toggle"
          mode="contained-tonal"
          compact
          onPress={() => setSortOrder(o => o === "asc" ? "desc" : "asc")}
          style={styles.headerButton}
          labelStyle={styles.headerButtonLabel}
        >
          {sortOrder === "asc" ? "First → Last" : "Last → First"}
        </Button>
        <Button
          testID="industry-sp-screen-events-button"
          mode="contained"
          compact
          buttonColor={colors.primaryDark}
          onPress={onNavigateToEvents}
          style={styles.headerButton}
          labelStyle={styles.headerButtonLabel}
        >
          ← Events
        </Button>
      </Appbar.Header>

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
        <Button
          testID="industry-sp-odds-mode-toggle"
          mode="outlined"
          compact
          onPress={() => setOddsMode(m => (m === "fraction" ? "decimal" : "fraction"))}
          style={styles.toolbarButton}
          labelStyle={styles.toolbarButtonLabel}
        >
          {oddsMode === "fraction" ? "Odds: Fraction" : "Odds: Decimal"}
        </Button>
      </View>

      {/* Filter bar — kept as custom for density */}
      {filtersVisible && (
      <View testID="industry-sp-filter-bar" style={styles.filterBar}>
        <View style={styles.filterStepper}>
          <Text style={styles.filterStepperLabel}>ISP</Text>
          {renderTooltipToggle("isp")}
          <RNTextInput
            testID="industry-sp-min-isp"
            style={styles.priceInput}
            value={draftMinIsp}
            onChangeText={setDraftMinIsp}
            keyboardType="decimal-pad"
            maxLength={7}
          />
          <Text style={styles.filterStepperLabel}>–</Text>
          <RNTextInput
            testID="industry-sp-max-isp"
            style={styles.priceInput}
            value={draftMaxIsp}
            onChangeText={setDraftMaxIsp}
            keyboardType="decimal-pad"
            maxLength={7}
          />
          {filterBounds != null && (
            <Text testID="industry-sp-sp-bound" style={styles.boundsHint}>
              ({filterBounds.minIsp.toFixed(1)}–{Math.ceil(filterBounds.maxIsp)})
            </Text>
          )}
          {renderTooltipText("isp")}
        </View>
        <View style={styles.filterDivider} />
        <View style={styles.filterStepper}>
          <Text style={styles.filterStepperLabel}>Runners</Text>
          {renderTooltipToggle("runners")}
          <TouchableOpacity
            testID="industry-sp-min-dec"
            style={[styles.stepBtn, (parseInt(draftMin) || 1) <= 1 && styles.stepBtnDisabled]}
            disabled={(parseInt(draftMin) || 1) <= 1}
            onPress={() => setDraftMin(v => String(Math.max(1, (parseInt(v) || 1) - 1)))}
          >
            <Text style={styles.stepBtnText}>-</Text>
          </TouchableOpacity>
          <RNTextInput
            testID="industry-sp-min-value"
            style={styles.stepInput}
            value={draftMin}
            onChangeText={setDraftMin}
            keyboardType="numeric"
            maxLength={3}
          />
          <TouchableOpacity
            testID="industry-sp-min-inc"
            style={styles.stepBtn}
            onPress={() => setDraftMin(v => String((parseInt(v) || 1) + 1))}
          >
            <Text style={styles.stepBtnText}>+</Text>
          </TouchableOpacity>
          <Text style={styles.filterStepperLabel}>to</Text>
          <TouchableOpacity
            testID="industry-sp-max-dec"
            style={styles.stepBtn}
            onPress={() => setDraftMax(v => String(Math.max(1, (parseInt(v) || 20) - 1)))}
          >
            <Text style={styles.stepBtnText}>-</Text>
          </TouchableOpacity>
          <RNTextInput
            testID="industry-sp-max-value"
            style={styles.stepInput}
            value={draftMax}
            onChangeText={setDraftMax}
            keyboardType="numeric"
            maxLength={3}
          />
          <TouchableOpacity
            testID="industry-sp-max-inc"
            style={[styles.stepBtn, filterBounds != null && (parseInt(draftMax) || 0) >= filterBounds.maxRunnersPerRace && styles.stepBtnDisabled]}
            disabled={filterBounds != null && (parseInt(draftMax) || 0) >= filterBounds.maxRunnersPerRace}
            onPress={() => setDraftMax(v => String(Math.min(filterBounds?.maxRunnersPerRace ?? 100, (parseInt(v) || 20) + 1)))}
          >
            <Text style={styles.stepBtnText}>+</Text>
          </TouchableOpacity>
          {filterBounds != null && (
            <Text testID="industry-sp-max-bound" style={styles.boundsHint}>of {filterBounds.maxRunnersPerRace}</Text>
          )}
          {renderTooltipText("runners")}
        </View>
        <View style={styles.filterDivider} />
        <View style={styles.filterStepper}>
          <Text testID="industry-sp-in-isp-label" style={styles.filterStepperLabel}># in ISP</Text>
          {renderTooltipToggle("inIsp")}
          <TouchableOpacity
            testID="industry-sp-min-rir-dec"
            style={styles.stepBtn}
            onPress={() => setDraftMinRIR(v => String(Math.max(1, (parseInt(v) || 1) - 1)))}
          >
            <Text style={styles.stepBtnText}>-</Text>
          </TouchableOpacity>
          <RNTextInput
            testID="industry-sp-min-rir-value"
            style={styles.stepInput}
            value={draftMinRIR}
            onChangeText={setDraftMinRIR}
            keyboardType="numeric"
            maxLength={2}
          />
          <TouchableOpacity
            testID="industry-sp-min-rir-inc"
            style={styles.stepBtn}
            onPress={() => setDraftMinRIR(v => String((parseInt(v) || 1) + 1))}
          >
            <Text style={styles.stepBtnText}>+</Text>
          </TouchableOpacity>
          <Text style={styles.filterStepperLabel}>to</Text>
          <TouchableOpacity
            testID="industry-sp-max-rir-dec"
            style={styles.stepBtn}
            onPress={() => setDraftMaxRIR(v => String(Math.max(1, (parseInt(v) || 30) - 1)))}
          >
            <Text style={styles.stepBtnText}>-</Text>
          </TouchableOpacity>
          <RNTextInput
            testID="industry-sp-max-rir-value"
            style={styles.stepInput}
            value={draftMaxRIR}
            onChangeText={setDraftMaxRIR}
            keyboardType="numeric"
            maxLength={2}
          />
          <TouchableOpacity
            testID="industry-sp-max-rir-inc"
            style={[styles.stepBtn, filterBounds != null && (parseInt(draftMaxRIR) || 0) >= filterBounds.maxRunnersPerRace && styles.stepBtnDisabled]}
            disabled={filterBounds != null && (parseInt(draftMaxRIR) || 0) >= filterBounds.maxRunnersPerRace}
            onPress={() => setDraftMaxRIR(v => String(Math.min(filterBounds?.maxRunnersPerRace ?? 100, (parseInt(v) || 30) + 1)))}
          >
            <Text style={styles.stepBtnText}>+</Text>
          </TouchableOpacity>
          {filterBounds != null && (
            <Text testID="industry-sp-max-rir-bound" style={styles.boundsHint}>of {filterBounds.maxRunnersPerRace}</Text>
          )}
          {renderTooltipText("inIsp")}
        </View>
        <View style={styles.filterDivider} />
        <View style={styles.filterStepper}>
          <Text style={styles.filterStepperLabel}>Race</Text>
          {renderTooltipToggle("race")}
          <RNTextInput
            testID="industry-sp-from-row"
            style={styles.raceInput}
            value={draftFrom}
            onChangeText={setDraftFrom}
            keyboardType="numeric"
            maxLength={6}
          />
          <Text style={styles.filterStepperLabel}>–</Text>
          <RNTextInput
            testID="industry-sp-to-row"
            style={styles.raceInput}
            value={draftTo}
            onChangeText={setDraftTo}
            keyboardType="numeric"
            maxLength={6}
          />
          {totalRaces > 0 && (
            <Text testID="industry-sp-race-bound" style={[styles.boundsHint, styles.raceBoundsHint]}>/{totalRaces}</Text>
          )}
          {renderTooltipText("race")}
        </View>
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

      {!isLoading && displayPnl.staked > 0 && (
        <View testID="industry-sp-pnl-bar" style={styles.pnlBar}>
          <Text style={styles.pnlLabel}>
            {hasRowRange ? `races ${fromRow}–${effectiveToRow}` : "Stake to win £1 per runner"}
          </Text>
          <View style={styles.pnlStats}>
            <Text testID="industry-sp-pnl-races" style={styles.pnlStat}>
              <Text style={styles.pnlStatLabel}>Races </Text>{totalRaces}
            </Text>
            {displayPnl.count != null && (
              <Text testID="industry-sp-pnl-count" style={styles.pnlStat}>
                <Text style={styles.pnlStatLabel}>Horses </Text>{displayPnl.count}
              </Text>
            )}
            <Text style={styles.pnlStat}>
              <Text style={styles.pnlStatLabel}>Staked </Text>{formatGbp(displayPnl.staked)}
            </Text>
            <Text style={styles.pnlStat}>
              <Text style={styles.pnlStatLabel}>Return </Text>{formatGbp(displayPnl.returns)}
            </Text>
            <Text testID="industry-sp-pnl" style={[styles.pnlValue, displayPnl.pnl >= 0 ? styles.pnlPos : styles.pnlNeg]}>
              {formatPnl(displayPnl.pnl)}{" "}
              <Text style={[styles.pnlPct, displayPnl.pnl >= 0 ? styles.pnlPos : styles.pnlNeg]}>
                ({formatPct(displayPnl.pnl, displayPnl.staked)})
              </Text>
            </Text>
          </View>
        </View>
      )}

      <View style={styles.body}>
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
          <ScrollView testID="industry-sp-list" style={styles.list}>
            {displayRaces.length === 0 && (
              <Text style={styles.emptyText}>No races found.</Text>
            )}
            {Object.entries(byMeeting).map(([meetingId, { meetingName, races: meetingRaces }]) => (
              <View key={meetingId} testID={`industry-sp-meeting-${meetingId}`}>
                <TouchableOpacity
                  testID={`industry-sp-meeting-link-${meetingId}`}
                  style={styles.eventHeader}
                  onPress={() => onNavigateToMeeting(meetingId)}
                >
                  <Text style={styles.eventName}>{meetingName}</Text>
                </TouchableOpacity>
                {meetingRaces.map(race => (
                  <View key={race.raceId}>
                    <TouchableOpacity
                      testID={`industry-sp-race-${race.raceId}`}
                      style={styles.raceHeader}
                      onPress={() => onNavigateToRace(race.raceId)}
                    >
                      <Text style={styles.raceTime}>{formatRaceTime(race.raceTime)}</Text>
                      <Text style={styles.raceDate}>{formatRaceDate(race.raceTime)}</Text>
                      <Text style={styles.raceType}>{race.raceType}</Text>
                      <Text style={styles.raceCount}>{race.runners.length} runners</Text>
                      {(() => {
                        const rp = computeRangePnl([race]);
                        if (rp.staked === 0) return null;
                        return (
                          <Text style={[styles.racePnl, rp.pnl >= 0 ? styles.pnlPos : styles.pnlNeg]}>
                            {formatPnl(rp.pnl)} ({formatPct(rp.pnl, rp.staked)})
                          </Text>
                        );
                      })()}
                    </TouchableOpacity>
                    {race.runners.map((runner: IspRunner) => (
                      <View
                        key={runner.id}
                        testID={`industry-sp-item-${runner.id}`}
                        style={styles.runnerRow}
                      >
                        <Text style={styles.priority}>{runner.sortPriority}.</Text>
                        <Text style={styles.runnerName} numberOfLines={1}>
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
                      </View>
                    ))}
                  </View>
                ))}
              </View>
            ))}
            {page < totalPages && (
              <Button
                testID="industry-sp-load-more"
                mode="contained-tonal"
                onPress={loadMore}
                disabled={isLoadingMore}
                loading={isLoadingMore}
                style={styles.loadMoreButton}
              >
                Load more ({totalRaces - races.length} remaining)
              </Button>
            )}
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
    paddingVertical: spacing.sm,
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
  filterBar: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: "#EEF2FF",
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tooltipToggle: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.textTertiary,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 2,
  },
  tooltipToggleText: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: "700",
    color: colors.textSecondary,
  },
  tooltipText: {
    width: "100%",
    fontSize: 11,
    fontStyle: "italic",
    color: colors.textSecondary,
    marginTop: 4,
    paddingRight: 4,
  },
  filterStepper: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    flexShrink: 1,
    minWidth: 0,
    rowGap: 4,
    gap: 6,
  },
  filterStepperLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    marginRight: 2,
  },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  stepBtnDisabled: {
    backgroundColor: "#C7D2FE",
    opacity: 0.6,
  },
  boundsHint: {
    fontSize: 10,
    color: colors.textTertiary,
    marginLeft: 3,
    fontWeight: "500",
  },
  stepBtnText: {
    color: "#fff",
    fontSize: 16,
    lineHeight: 20,
    fontWeight: "700",
  },
  stepInput: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.text,
    width: 36,
    textAlign: "center",
    borderBottomWidth: 1,
    borderBottomColor: colors.textTertiary,
    paddingVertical: 2,
  },
  raceInput: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.text,
    width: 68,
    textAlign: "center",
    borderBottomWidth: 1,
    borderBottomColor: colors.textTertiary,
    paddingVertical: 2,
    paddingHorizontal: 2,
  },
  raceBoundsHint: {
    marginLeft: 6,
  },
  priceInput: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.text,
    width: 60,
    textAlign: "center",
    borderBottomWidth: 1,
    borderBottomColor: colors.textTertiary,
    paddingVertical: 2,
    paddingHorizontal: 2,
  },
  applyBtn: {
    borderRadius: radii.sm,
    marginLeft: 6,
  },
  applyBtnLabel: {
    fontSize: 13,
    fontWeight: "700",
  },
  resetBtn: {
    borderRadius: radii.sm,
    marginLeft: 6,
    borderColor: colors.primary,
  },
  resetBtnLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.primary,
  },
  countryBar: {
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    maxHeight: 44,
    ...({ overscrollBehavior: "contain" } as any),
  },
  countryBarContent: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
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
  filterDivider: {
    width: 1,
    height: 20,
    backgroundColor: colors.border,
    marginHorizontal: 6,
  },
  pnlBar: {
    backgroundColor: colors.text,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 4,
  },
  pnlLabel: {
    fontSize: 11,
    color: "rgba(255,255,255,0.5)",
    marginRight: spacing.sm,
  },
  pnlStats: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    flexShrink: 1,
    minWidth: 0,
    gap: 10,
  },
  pnlStat: {
    fontSize: 12,
    color: "rgba(255,255,255,0.75)",
  },
  pnlStatLabel: {
    color: "rgba(255,255,255,0.4)",
  },
  pnlValue: {
    fontSize: 14,
    fontWeight: "700",
  },
  pnlPct: {
    fontSize: 12,
    fontWeight: "400",
    opacity: 0.8,
  },
  pnlPos: {
    color: "#4ADE80",
  },
  pnlNeg: {
    color: "#F87171",
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
    // overscrollBehavior is a web-only CSS property (not in RN's ViewStyle type)
    // that react-native-web passes through as-is; spread via `any` to bypass
    // the excess-property check without an unreliable @ts-expect-error line.
    ...({ overscrollBehavior: "contain" } as any),
  },
  emptyText: {
    padding: spacing.xl,
    color: colors.textTertiary,
    fontSize: 16,
    textAlign: "center",
  },
  eventHeader: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md - 2,
    backgroundColor: "#EEF2FF",
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  eventName: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.primaryDark,
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
  raceDate: {
    fontSize: 11,
    color: colors.textSecondary,
    marginLeft: 4,
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
  runnerName: {
    fontSize: 13,
    fontWeight: "500",
    color: colors.text,
    flex: 1,
    minWidth: 0,
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
    color: colors.primaryDark,
    backgroundColor: "#EEF2FF",
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
});
