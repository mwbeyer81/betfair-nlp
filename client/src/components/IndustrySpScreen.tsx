import React, { useState, useEffect } from "react";
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
import { colors, radii, spacing } from "../theme";
import { formatGbp, formatPnl, formatPct } from "../utils/ispFormat";
import {
  urlIntParam,
  urlFloatParam,
  urlToRowParam,
  urlCountriesParam,
  updateUrlParams,
} from "../utils/ispUrlParams";

interface IndustrySpScreenProps {
  onNavigateToEvents: () => void;
  onViewRaces: () => void;
}

// Filter values are persisted to the URL query string (using the same param
// names the API itself uses) so a filtered view can be bookmarked, shared,
// carried over to the races screen, or survive a refresh. Only non-default
// values are written, so the URL stays clean (just "/isp") until the user
// actually changes something.
const FILTER_DEFAULTS = {
  minRunners: 1,
  maxRunners: 20,
  fromRow: 1,
  minIsp: 1,
  maxIsp: 1000,
  minInIspRange: 1,
  maxInIspRange: 30,
};

const FILTER_TOOLTIPS: Record<string, string> = {
  isp: "Only show races where the runner's official starting price (ISP) falls in this range.",
  runners: "Only show races with this many total runners taking part.",
  inIsp: "Only show races with this many runners priced inside the ISP range above, out of the full field.",
  race: "Restrict results to races numbered within this range, out of the total matching races.",
};

// This screen only needs the aggregate totals (totalRaces/totalRunners/
// pnlStats) for the PnL bar and the Race filter's bound hint — it no longer
// renders the race list itself, so there's no need to fetch a full page of
// race data on every filter change.
const AGGREGATE_ONLY_LIMIT = 1;

export const IndustrySpScreen: React.FC<IndustrySpScreenProps> = ({
  onNavigateToEvents,
  onViewRaces,
}) => {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draftMin, setDraftMin] = useState(() => String(urlIntParam("minRunners", FILTER_DEFAULTS.minRunners)));
  const [draftMax, setDraftMax] = useState(() => String(urlIntParam("maxRunners", FILTER_DEFAULTS.maxRunners)));
  const [fromRow, setFromRow] = useState(() => urlIntParam("fromRow", FILTER_DEFAULTS.fromRow));
  const [toRow, setToRow] = useState<number | null>(() => urlToRowParam());
  const [draftFrom, setDraftFrom] = useState(() => String(urlIntParam("fromRow", FILTER_DEFAULTS.fromRow)));
  const [draftTo, setDraftTo] = useState(() => {
    const t = urlToRowParam();
    return t != null ? String(t) : "0";
  });
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
  const [pnlStats, setPnlStats] = useState<PnlStats>({ staked: 0, returns: 0, pnl: 0 });
  const [filterBounds, setFilterBounds] = useState<IspFilterBounds | null>(null);
  const [filtersVisible, setFiltersVisible] = useState(true);
  const [openTooltip, setOpenTooltip] = useState<string | null>(null);

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
    setFetchTrigger(t => t + 1);
  }

  // Keep the URL query string in sync with the currently *applied* filters
  // (not draft/in-progress typing) so a filtered view can be bookmarked,
  // shared, carried over to the races screen, or survives a refresh. Only
  // fires on committed changes — Apply, a country chip click, or Reset —
  // since those are the only actions that update these particular state
  // variables.
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
    });
  }, [minRunners, maxRunners, fromRow, toRow, minIsp, maxIsp, minRunnersInRange, maxRunnersInRange, selectedCountries]);

  useEffect(() => {
    chatApi.getIspCountries().then(setAvailableCountries).catch(() => {});
    chatApi.getIspFilterBounds().then(setFilterBounds).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await chatApi.getIndustrySp(1, AGGREGATE_ONLY_LIMIT, minRunners, maxRunners, [...selectedCountries], minIsp, maxIsp, "asc", minRunnersInRange, maxRunnersInRange, fromRow, toRow ?? undefined);
        if (cancelled) return;
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
  }, [fetchTrigger]);

  const hasRowRange = fromRow > 1 || toRow != null;
  const effectiveToRow = toRow ?? totalRaces;
  const displayPnl = pnlStats;

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
          filterKey: "race",
          label: "Race",
          minValue: draftFrom,
          onMinChange: setDraftFrom,
          minTestId: "industry-sp-from-row",
          maxValue: draftTo,
          onMaxChange: setDraftTo,
          maxTestId: "industry-sp-to-row",
          keyboardType: "numeric",
          maxLength: 6,
          hint: totalRaces > 0 ? `/${totalRaces}` : null,
          hintTestId: "industry-sp-race-bound",
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

      <View>
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
          <View testID="industry-sp-view-races-card" style={styles.viewRacesCard}>
            <Text style={styles.viewRacesCount}>{totalRaces.toLocaleString()}</Text>
            <Text style={styles.viewRacesLabel}>races match your filters</Text>
            <Button
              testID="industry-sp-view-races-button"
              mode="contained"
              onPress={onViewRaces}
              style={styles.viewRacesButton}
              labelStyle={styles.viewRacesButtonLabel}
            >
              View Races →
            </Button>
          </View>
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
    backgroundColor: "#EEF2FF",
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
  viewRacesCard: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xxl,
    gap: 2,
  },
  viewRacesCount: {
    fontSize: 28,
    fontWeight: "800",
    color: colors.primaryDark,
  },
  viewRacesLabel: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  viewRacesButton: {
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
  },
  viewRacesButtonLabel: {
    fontSize: 15,
    fontWeight: "700",
    paddingVertical: 2,
  },
});
