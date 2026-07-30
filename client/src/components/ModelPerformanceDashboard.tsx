import React, { useEffect, useMemo, useState } from "react";
import { View, StyleSheet, ScrollView, TouchableOpacity, TextInput as RNTextInput } from "react-native";
import { Text, Button, Surface, Divider, ActivityIndicator, Chip } from "react-native-paper";
import Svg, { Line as SvgLine, Circle } from "react-native-svg";
import { IspRace, ModelVersion } from "../services/chatApi";
import { colors, radii, spacing } from "../theme";
import { computeRangePnl, computeModelFilteredPnl, formatPnl, formatPct, formatRaceDate } from "../utils/ispFormat";
import { DateRangePicker } from "./DateRangePicker";
import { useResponsive } from "../utils/responsive";

// Server-side filters for the currently-selected model version's race pool —
// mirrors a subset of chatApi.getIndustrySp's own params. Sent to the parent
// on Apply / date-range confirm / Reset so it can refetch from
// GET /api/industry-sp (scoped to modelVersionId) instead of re-slicing
// whatever races happen to already be loaded — see the "Touching
// IndustrySpScreen.tsx" AGENTS.md entry for why a client-side-only re-slice
// of a payload-size-capped batch can never reach the model's real test
// period. minModelWinProbability is deliberately NOT part of this: both the
// "without model" and "with model" P&L cards need the same underlying race
// pool, so that split stays a client-side computation (see withoutModelPnl/
// withModelPnl below).
export interface ModelPerformanceFilters {
  minDate?: string;
  maxDate?: string;
  countries?: string[];
  courses?: string[];
  goings?: string[];
  raceClasses?: string[];
  raceTypes?: string[];
  trainer?: string;
  jockey?: string;
}

interface ModelPerformanceDashboardProps {
  modelVersions: ModelVersion[];
  selectedModelVersionId: string;
  onSelectModelVersion: (id: string) => void;
  // Races the parent has fetched for the currently-selected model version,
  // already narrowed server-side by the most recently applied
  // ModelPerformanceFilters (see onApplyFilters below) — this component no
  // longer re-filters by date/chip here, only trims by trainer/jockey text
  // (see pnlRaces) and splits by min model win probability.
  races: IspRace[];
  loading: boolean;
  error: string | null;
  onClose: () => void;
  // Refetches `races` from the server with the given filters — see
  // IndustrySpScreen's loadRacesForModelVersion.
  onApplyFilters: (filters: ModelPerformanceFilters) => void;
  // The selected model version's real held-out test period start
  // (runMeta.testDateMin) — used as the default/reset lower date bound so
  // the panel opens on the model's genuine backtest window instead of
  // whatever races happen to sort first.
  defaultMinDate: string;
  // Every course/going/race-class/race-type/country value in the whole
  // dataset (not just the currently-loaded, filtered race pool) — reused
  // from the same source as the main Industry SP filter panel so chip
  // options don't shrink to only-what's-currently-loaded after a filter is
  // applied.
  availableCountries: string[];
  availableCourses: string[];
  availableGoings: string[];
  availableRaceClasses: string[];
  availableRaceTypes: string[];
}

const CHIP_FILTER_KEYS = ["country", "course", "going", "raceClass", "raceType"] as const;
type ChipFilterKey = (typeof CHIP_FILTER_KEYS)[number];

const CHIP_FILTER_LABELS: Record<ChipFilterKey, string> = {
  country: "Country",
  course: "Course",
  going: "Going",
  raceClass: "Race Class",
  raceType: "Race Type",
};

// Plain-English explanations for the XGBoost training params and metrics
// shown in the detail view — these are the exact terms ml/train_and_predict.py
// uses, meaningless to anyone who isn't already familiar with gradient-
// boosted trees. Keyed by the same label strings passed to renderParamRow
// below, plus the three metric keys.
const PROPERTY_TOOLTIPS: Record<string, string> = {
  n_estimators:
    "How many individual decision trees the model built and combined to make its predictions. More trees can capture more detail, but take longer to train and eventually stop helping.",
  learning_rate:
    "How big a step the model takes when learning from each new tree. Smaller steps learn more cautiously and usually need more trees (n_estimators) to reach the same accuracy, but tend to generalize better to new races.",
  max_depth:
    "How many yes/no questions deep each individual tree is allowed to go. Deeper trees can capture more complex patterns, but risk memorizing quirks in the training data instead of learning general trends.",
  subsample:
    "The fraction of training races randomly used to build each individual tree (0.8 = 80%). Using less than 100% adds randomness that helps stop the model from over-fitting to the exact training data.",
  colsample_bytree:
    "The fraction of input factors (course, going, trainer form, etc.) randomly considered when building each tree. Same idea as subsample — more randomness, less over-fitting.",
  min_child_weight:
    "The minimum amount of data a split in a tree needs before it's allowed. A safeguard against the model inventing overly specific rules based on just a handful of races.",
  random_state:
    "A fixed number that seeds all of the model's random choices, so training again on the same data with this same number reproduces an identical model.",
  early_stopping_rounds:
    "Training stops automatically once the model hasn't improved on a held-back sample of races for this many rounds in a row — avoids wasting time, or over-fitting, once more training stops helping.",
  train_rows: "How many individual runner entries the model actually learned from.",
  test_rows:
    "How many runner entries were held back and never shown to the model during training — used afterwards to check its performance honestly, on races it couldn't have memorized.",
  best_iteration:
    "Out of every round of training, which one produced the best-performing model on the held-back data — that's the version that got kept.",
  train_date_max: "The most recent race date included in the training data.",
  test_date_min:
    "The earliest race date in the held-back test data — always after the training cut-off, so the model is only ever judged on races it couldn't have seen coming.",
  aucRoc:
    "How well the model ranks winners above losers, from 0.5 (no better than a coin flip) to 1.0 (perfect). 0.70–0.75 is a realistically solid score for horse racing — nobody predicts every winner.",
  logLoss:
    "How confident and correct the model's predictions were, race by race — being confidently right is rewarded, being confidently wrong is punished harder than being unsure. Lower is better; 0 would be a perfect, fully-confident model.",
  brierScore:
    "The average squared gap between the model's predicted win probability and what actually happened (1 for a win, 0 for a loss). Lower is better; 0 would mean perfect predictions.",
};

function makeEmptyChipSelection(): Record<ChipFilterKey, Set<string>> {
  return { country: new Set(), course: new Set(), going: new Set(), raceClass: new Set(), raceType: new Set() };
}

// Calendar lower bound is a fixed constant (not derived from whatever's
// currently loaded) so the date picker always lets the user pick any date
// in the dataset's history, not just within the currently-filtered batch.
const CALENDAR_MIN_DATE = "2000-01-01";

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

const CAL_CHART_WIDTH = 320;
const CAL_CHART_HEIGHT = 320;
const CAL_CHART_PADDING = 24;
const CAL_PLOT_SIZE = CAL_CHART_WIDTH - CAL_CHART_PADDING * 2;

function calXFor(meanPredicted: number): number {
  return CAL_CHART_PADDING + (meanPredicted / 100) * CAL_PLOT_SIZE;
}

function calYFor(actualWinRate: number): number {
  return CAL_CHART_PADDING + CAL_PLOT_SIZE - (actualWinRate / 100) * CAL_PLOT_SIZE;
}

export const ModelPerformanceDashboard: React.FC<ModelPerformanceDashboardProps> = ({
  modelVersions,
  selectedModelVersionId,
  onSelectModelVersion,
  races,
  loading,
  error,
  onClose,
  onApplyFilters,
  defaultMinDate,
  availableCountries,
  availableCourses,
  availableGoings,
  availableRaceClasses,
  availableRaceTypes,
}) => {
  const [draftChipSelected, setDraftChipSelected] = useState<Record<ChipFilterKey, Set<string>>>(makeEmptyChipSelection);
  const [appliedChipSelected, setAppliedChipSelected] = useState<Record<ChipFilterKey, Set<string>>>(makeEmptyChipSelection);
  const [draftTrainerText, setDraftTrainerText] = useState("");
  const [appliedTrainerText, setAppliedTrainerText] = useState("");
  const [draftJockeyText, setDraftJockeyText] = useState("");
  const [appliedJockeyText, setAppliedJockeyText] = useState("");
  const [draftMinModelWinProbability, setDraftMinModelWinProbability] = useState("0");
  const [appliedMinModelWinProbability, setAppliedMinModelWinProbability] = useState(0);
  const [appliedFromDate, setAppliedFromDate] = useState(defaultMinDate);
  const [appliedToDate, setAppliedToDate] = useState(() => todayYmd());
  // "table" lists every model version as a row; tapping one drills into
  // "detail" (training params/metrics/filters/P&L for just that version).
  // Deliberately not touched by the races-reset effect below — that effect
  // only clears stale filters, switching screens is purely a nav action
  // driven by row taps / the back button.
  const [screen, setScreen] = useState<"table" | "detail">("table");
  const { isTablet } = useResponsive();
  // Which model was trained more recently — defaults to newest first, the
  // usual way to browse a list of versions.
  const [sortOrder, setSortOrder] = useState<"desc" | "asc">("desc");
  // Which single tooltip (if any) is currently expanded, keyed by the same
  // strings as PROPERTY_TOOLTIPS — only one open at a time, same pattern as
  // IndustrySpScreen's filter tooltips.
  const [openTooltip, setOpenTooltip] = useState<string | null>(null);

  // Switching model version means a different real test period (a different
  // model's runMeta.testDateMin) and possibly a different scored pool
  // entirely — stale filter selections from the previous version could
  // silently zero out the new one's results, so a version switch resets
  // filters back to that version's own defaults (not the previous version's
  // loaded races) rather than leaving them applied against a pool they
  // weren't chosen for.
  useEffect(() => {
    setDraftChipSelected(makeEmptyChipSelection());
    setAppliedChipSelected(makeEmptyChipSelection());
    setDraftTrainerText("");
    setAppliedTrainerText("");
    setDraftJockeyText("");
    setAppliedJockeyText("");
    setDraftMinModelWinProbability("0");
    setAppliedMinModelWinProbability(0);
    setAppliedFromDate(defaultMinDate);
    setAppliedToDate(todayYmd());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedModelVersionId, defaultMinDate]);

  // Every value a chip can offer, sourced from the whole dataset (not the
  // currently-loaded/filtered `races`) so picking a value in one category
  // doesn't make other values in the same category disappear from the menu
  // — see the ModelPerformanceFilters prop comment above.
  const chipOptions: Record<ChipFilterKey, string[]> = {
    country: availableCountries,
    course: availableCourses,
    going: availableGoings,
    raceClass: availableRaceClasses,
    raceType: availableRaceTypes,
  };

  function toggleChip(key: ChipFilterKey, value: string) {
    setDraftChipSelected(prev => {
      const next = { ...prev, [key]: new Set(prev[key]) };
      if (next[key].has(value)) next[key].delete(value);
      else next[key].add(value);
      return next;
    });
  }

  function buildFilters(
    chips: Record<ChipFilterKey, Set<string>>,
    trainer: string,
    jockey: string,
    fromDate: string,
    toDate: string
  ): ModelPerformanceFilters {
    return {
      minDate: fromDate,
      maxDate: toDate,
      countries: Array.from(chips.country),
      courses: Array.from(chips.course),
      goings: Array.from(chips.going),
      raceClasses: Array.from(chips.raceClass),
      raceTypes: Array.from(chips.raceType),
      trainer: trainer || undefined,
      jockey: jockey || undefined,
    };
  }

  function applyFilters() {
    setAppliedChipSelected(draftChipSelected);
    setAppliedTrainerText(draftTrainerText);
    setAppliedJockeyText(draftJockeyText);
    setAppliedMinModelWinProbability(Math.min(100, Math.max(0, parseFloat(draftMinModelWinProbability) || 0)));
    onApplyFilters(buildFilters(draftChipSelected, draftTrainerText, draftJockeyText, appliedFromDate, appliedToDate));
  }

  function resetFilters() {
    setDraftChipSelected(makeEmptyChipSelection());
    setAppliedChipSelected(makeEmptyChipSelection());
    setDraftTrainerText("");
    setAppliedTrainerText("");
    setDraftJockeyText("");
    setAppliedJockeyText("");
    setDraftMinModelWinProbability("0");
    setAppliedMinModelWinProbability(0);
    setAppliedFromDate(defaultMinDate);
    setAppliedToDate(todayYmd());
    onApplyFilters(buildFilters(makeEmptyChipSelection(), "", "", defaultMinDate, todayYmd()));
  }

  // Server has already narrowed `races` by chips/date/trainer/jockey (see
  // onApplyFilters) — the one thing still needed client-side is trimming
  // each race's runners down to just the trainer/jockey match, since the
  // server's $elemMatch confirms a race has a matching runner without
  // dropping the race's other runners (see AGENTS.md entry above).
  const pnlRaces = useMemo(() => {
    if (!appliedTrainerText && !appliedJockeyText) return races;
    return races
      .map(race => {
        const runners = race.runners.filter(runner => {
          if (appliedTrainerText && !(runner.trainer ?? "").toLowerCase().includes(appliedTrainerText.toLowerCase())) return false;
          if (appliedJockeyText && !(runner.jockey ?? "").toLowerCase().includes(appliedJockeyText.toLowerCase())) return false;
          return true;
        });
        return { ...race, runners };
      })
      .filter(race => race.runners.length > 0);
  }, [races, appliedTrainerText, appliedJockeyText]);

  const withoutModelPnl = useMemo(() => computeRangePnl(pnlRaces), [pnlRaces]);
  const withModelPnl = useMemo(
    () => computeModelFilteredPnl(pnlRaces, appliedMinModelWinProbability),
    [pnlRaces, appliedMinModelWinProbability]
  );

  const selectedVersion = modelVersions.find(v => v.id === selectedModelVersionId) ?? modelVersions[0] ?? null;

  const sortedVersions = useMemo(() => {
    const copy = [...modelVersions];
    copy.sort((a, b) => (sortOrder === "desc" ? b.runAt.localeCompare(a.runAt) : a.runAt.localeCompare(b.runAt)));
    return copy;
  }, [modelVersions, sortOrder]);

  function openDetail(id: string) {
    onSelectModelVersion(id);
    setScreen("detail");
  }

  function backToTable() {
    setScreen("table");
  }

  function toggleSortOrder() {
    setSortOrder(prev => (prev === "desc" ? "asc" : "desc"));
  }

  function renderTooltipToggle(key: string) {
    return (
      <TouchableOpacity
        testID={`model-performance-dashboard-tooltip-toggle-${key}`}
        onPress={() => setOpenTooltip(t => (t === key ? null : key))}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        style={styles.tooltipToggle}
      >
        <Text style={styles.tooltipToggleText}>?</Text>
      </TouchableOpacity>
    );
  }

  function renderTooltipText(key: string) {
    if (openTooltip !== key) return null;
    return (
      <Text testID={`model-performance-dashboard-tooltip-text-${key}`} style={styles.tooltipText}>
        {PROPERTY_TOOLTIPS[key]}
      </Text>
    );
  }

  function renderParamRow(key: string, value: string | number) {
    return (
      <View key={key} style={styles.paramRow}>
        <View style={styles.paramLabelRow}>
          <Text style={styles.paramLabel}>{key}</Text>
          {renderTooltipToggle(key)}
        </View>
        <Text style={styles.paramValue}>{value}</Text>
        {renderTooltipText(key)}
      </View>
    );
  }

  function renderChipRow(key: ChipFilterKey) {
    const values = chipOptions[key];
    const draftSelected = draftChipSelected[key];
    const appliedSelected = appliedChipSelected[key];
    return (
      <View key={key} testID={`model-performance-dashboard-filter-row-${key}`} style={styles.chipFilterRow}>
        <Text style={styles.chipFilterLabel}>{CHIP_FILTER_LABELS[key]}</Text>
        {values.length === 0 ? (
          <Text style={styles.chipFilterEmptyText}>No values in this data set</Text>
        ) : (
          <ScrollView
            horizontal
            testID={`model-performance-dashboard-chip-${key}`}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRowContent}
          >
            {values.map(value => {
              const inDraft = draftSelected.has(value);
              const applied = inDraft && appliedSelected.has(value);
              const pending = inDraft && !applied;
              return (
                <Chip
                  key={value}
                  testID={`model-performance-dashboard-chip-${key}-${value}`}
                  compact
                  mode={inDraft ? "flat" : "outlined"}
                  selected={inDraft}
                  onPress={() => toggleChip(key, value)}
                  style={[styles.chip, applied && styles.chipApplied, pending && styles.chipPending]}
                  textStyle={applied ? styles.chipTextApplied : undefined}
                >
                  {pending ? `${value} •` : value}
                </Chip>
              );
            })}
          </ScrollView>
        )}
      </View>
    );
  }

  return (
    <Surface testID="model-performance-dashboard-panel" style={styles.panel} elevation={3}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text variant="titleMedium" style={styles.title}>
            Model Performance
          </Text>
          {screen === "detail" && selectedVersion != null && (
            <Text style={styles.subtitle}>
              {selectedVersion.runLabel} · {formatRaceDate(selectedVersion.runAt)}
            </Text>
          )}
        </View>
        <Button
          testID="model-performance-dashboard-panel-close"
          mode="contained"
          compact
          buttonColor={colors.accent}
          onPress={onClose}
          style={styles.closeButton}
          labelStyle={styles.closeButtonLabel}
        >
          Close
        </Button>
      </View>

      <Divider />

      {loading ? (
        <View testID="model-performance-dashboard-loading" style={styles.centerRow}>
          <ActivityIndicator size="small" color={colors.accent} />
          <Text style={styles.stateText}>Loading model performance…</Text>
        </View>
      ) : error ? (
        <Text testID="model-performance-dashboard-error" style={styles.errorText}>
          {error}
        </Text>
      ) : modelVersions.length === 0 || selectedVersion == null ? (
        <Text testID="model-performance-dashboard-empty" style={styles.stateText}>
          No model versions available yet.
        </Text>
      ) : (
        <ScrollView testID="model-performance-dashboard-list" contentContainerStyle={styles.body}>
          {screen === "table" ? (
            <View testID="model-performance-dashboard-table" style={styles.tableContainer}>
              <TouchableOpacity
                testID="model-performance-dashboard-sort-toggle"
                onPress={toggleSortOrder}
                style={styles.sortToggle}
              >
                <Text style={styles.sortToggleText}>
                  Trained: {sortOrder === "desc" ? "Newest first" : "Oldest first"} {sortOrder === "desc" ? "↓" : "↑"}
                </Text>
              </TouchableOpacity>
              {isTablet ? (
                <View testID="model-performance-dashboard-table-header" style={styles.tableHeaderRow}>
                  <Text style={[styles.tableHeaderCell, styles.tableColModel]}>Model</Text>
                  <Text style={[styles.tableHeaderCell, styles.tableColDate]}>Trained</Text>
                  <View style={[styles.tableHeaderMetricCell, styles.tableColMetric]}>
                    <Text style={styles.tableHeaderCell}>AUC-ROC</Text>
                    {renderTooltipToggle("aucRoc")}
                  </View>
                  <View style={[styles.tableHeaderMetricCell, styles.tableColMetric]}>
                    <Text style={styles.tableHeaderCell}>LogLoss</Text>
                    {renderTooltipToggle("logLoss")}
                  </View>
                  <View style={[styles.tableHeaderMetricCell, styles.tableColMetric]}>
                    <Text style={styles.tableHeaderCell}>Brier</Text>
                    {renderTooltipToggle("brierScore")}
                  </View>
                  <View style={styles.tableColChevron} />
                </View>
              ) : (
                // Narrow layout has no header row (each metric is shown
                // inline per card instead) — this legend is the only place
                // a lay person can get an explanation of AUC-ROC/LogLoss/
                // Brier without tapping into a specific model's detail view.
                <View testID="model-performance-dashboard-metrics-legend" style={styles.metricsLegendRow}>
                  <Text style={styles.metricsLegendLabel}>AUC-ROC</Text>
                  {renderTooltipToggle("aucRoc")}
                  <Text style={styles.metricsLegendLabel}>LogLoss</Text>
                  {renderTooltipToggle("logLoss")}
                  <Text style={styles.metricsLegendLabel}>Brier</Text>
                  {renderTooltipToggle("brierScore")}
                </View>
              )}
              {(renderTooltipText("aucRoc") || renderTooltipText("logLoss") || renderTooltipText("brierScore")) && (
                <View style={styles.tableHeaderTooltipRow}>
                  {renderTooltipText("aucRoc")}
                  {renderTooltipText("logLoss")}
                  {renderTooltipText("brierScore")}
                </View>
              )}
              {sortedVersions.map(version => (
                <TouchableOpacity
                  key={version.id}
                  testID={`model-performance-dashboard-table-row-${version.id}`}
                  onPress={() => openDetail(version.id)}
                  style={[styles.tableRow, isTablet ? styles.tableRowWide : styles.tableRowNarrow]}
                >
                  {isTablet ? (
                    <>
                      <Text style={[styles.tableCellStrong, styles.tableColModel]}>{version.runLabel}</Text>
                      <Text style={[styles.tableCell, styles.tableColDate]}>{formatRaceDate(version.runAt)}</Text>
                      <Text style={[styles.tableCell, styles.tableColMetric]}>
                        {version.performanceMetrics.aucRoc.toFixed(3)}
                      </Text>
                      <Text style={[styles.tableCell, styles.tableColMetric]}>
                        {version.performanceMetrics.logLoss.toFixed(3)}
                      </Text>
                      <Text style={[styles.tableCell, styles.tableColMetric]}>
                        {version.performanceMetrics.brierScore.toFixed(3)}
                      </Text>
                      <Text style={[styles.tableCell, styles.tableColChevron]}>›</Text>
                    </>
                  ) : (
                    <>
                      <View style={styles.tableRowNarrowTop}>
                        <Text style={styles.tableCellStrong}>{version.runLabel}</Text>
                        <Text style={styles.tableChevronNarrow}>›</Text>
                      </View>
                      <Text style={styles.tableRowNarrowDate}>{formatRaceDate(version.runAt)}</Text>
                      <View style={styles.tableRowNarrowMetrics}>
                        <Text style={styles.tableRowNarrowMetric}>AUC {version.performanceMetrics.aucRoc.toFixed(3)}</Text>
                        <Text style={styles.tableRowNarrowMetric}>LogLoss {version.performanceMetrics.logLoss.toFixed(3)}</Text>
                        <Text style={styles.tableRowNarrowMetric}>Brier {version.performanceMetrics.brierScore.toFixed(3)}</Text>
                      </View>
                    </>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          ) : (
          <>
          <Button
            testID="model-performance-dashboard-back-to-table"
            mode="text"
            onPress={backToTable}
            style={styles.backButton}
          >
            ← Models
          </Button>

          <Surface testID="model-performance-dashboard-training-params" style={styles.panelCard} elevation={1}>
            <Text variant="titleSmall" style={styles.sectionTitle}>
              Training parameters
            </Text>
            <View style={styles.paramGrid}>
              {renderParamRow("n_estimators", selectedVersion.trainingParams.nEstimators)}
              {renderParamRow("learning_rate", selectedVersion.trainingParams.learningRate)}
              {renderParamRow("max_depth", selectedVersion.trainingParams.maxDepth)}
              {renderParamRow("subsample", selectedVersion.trainingParams.subsample)}
              {renderParamRow("colsample_bytree", selectedVersion.trainingParams.colsampleBytree)}
              {renderParamRow("min_child_weight", selectedVersion.trainingParams.minChildWeight)}
              {renderParamRow("random_state", selectedVersion.trainingParams.randomState)}
              {renderParamRow("early_stopping_rounds", selectedVersion.trainingParams.earlyStoppingRounds)}
              {renderParamRow("train_rows", selectedVersion.runMeta.trainRows)}
              {renderParamRow("test_rows", selectedVersion.runMeta.testRows)}
              {renderParamRow("best_iteration", selectedVersion.runMeta.bestIteration)}
              {renderParamRow("train_date_max", selectedVersion.runMeta.trainDateMax)}
              {renderParamRow("test_date_min", selectedVersion.runMeta.testDateMin)}
            </View>
            <Text style={styles.featureColsText}>Features: {selectedVersion.runMeta.featureCols.join(", ")}</Text>
          </Surface>

          <Surface testID="model-performance-dashboard-metrics" style={styles.panelCard} elevation={1}>
            <Text variant="titleSmall" style={styles.sectionTitle}>
              Performance metrics
            </Text>
            <View style={styles.metricRow}>
              <View testID="model-performance-dashboard-auc" style={styles.metricStat}>
                <View style={styles.paramLabelRow}>
                  <Text style={styles.metricValue}>AUC-ROC {selectedVersion.performanceMetrics.aucRoc.toFixed(3)}</Text>
                  {renderTooltipToggle("aucRoc")}
                </View>
                {renderTooltipText("aucRoc")}
              </View>
              <View testID="model-performance-dashboard-logloss" style={styles.metricStat}>
                <View style={styles.paramLabelRow}>
                  <Text style={styles.metricValue}>LogLoss {selectedVersion.performanceMetrics.logLoss.toFixed(3)}</Text>
                  {renderTooltipToggle("logLoss")}
                </View>
                {renderTooltipText("logLoss")}
              </View>
              <View testID="model-performance-dashboard-brier" style={styles.metricStat}>
                <View style={styles.paramLabelRow}>
                  <Text style={styles.metricValue}>Brier {selectedVersion.performanceMetrics.brierScore.toFixed(3)}</Text>
                  {renderTooltipToggle("brierScore")}
                </View>
                {renderTooltipText("brierScore")}
              </View>
            </View>
            <View testID="model-performance-dashboard-calibration-chart" style={styles.chartContainer}>
              <Svg width="100%" height={CAL_CHART_HEIGHT} viewBox={`0 0 ${CAL_CHART_WIDTH} ${CAL_CHART_HEIGHT}`}>
                <SvgLine
                  x1={calXFor(0)}
                  y1={calYFor(0)}
                  x2={calXFor(100)}
                  y2={calYFor(100)}
                  stroke={colors.textTertiary}
                  strokeDasharray="4,4"
                  strokeWidth={1}
                />
                {selectedVersion.performanceMetrics.calibrationTable.map((bucket, i) => (
                  <Circle key={i} cx={calXFor(bucket.meanPredicted)} cy={calYFor(bucket.actualWinRate)} r={5} fill={colors.accent} />
                ))}
              </Svg>
            </View>
            <Text style={styles.axisCaption}>X: predicted win% · Y: actual win% (dashed = perfect calibration)</Text>
          </Surface>

          <Surface testID="model-performance-dashboard-filters" style={styles.panelCard} elevation={1}>
            <Text variant="titleSmall" style={styles.sectionTitle}>
              Filters
            </Text>
            {CHIP_FILTER_KEYS.map(key => renderChipRow(key))}

            <View testID="model-performance-dashboard-filter-row-dateRange" style={styles.chipFilterRow}>
              <Text style={styles.chipFilterLabel}>Date range</Text>
              <DateRangePicker
                testID="model-performance-dashboard-date-range-picker"
                fromDate={appliedFromDate}
                toDate={appliedToDate}
                minDate={CALENDAR_MIN_DATE}
                maxDate={todayYmd()}
                onChange={(from, to) => {
                  setAppliedFromDate(from);
                  setAppliedToDate(to);
                  // The date picker has its own internal Apply/confirm step,
                  // so (unlike chips/trainer/jockey/min-prob) a date change
                  // refetches immediately rather than waiting on the
                  // outer Apply button — matches its pre-existing
                  // apply-immediately behaviour, now against the server
                  // instead of the client-side race pool.
                  onApplyFilters(buildFilters(appliedChipSelected, appliedTrainerText, appliedJockeyText, from, to));
                }}
              />
            </View>

            <View testID="model-performance-dashboard-filter-row-trainer" style={styles.chipFilterRow}>
              <Text style={styles.chipFilterLabel}>Trainer</Text>
              <RNTextInput
                testID="model-performance-dashboard-trainer-input"
                style={styles.textFilterInput}
                value={draftTrainerText}
                onChangeText={setDraftTrainerText}
                placeholder="Any trainer"
                placeholderTextColor={colors.textTertiary}
              />
            </View>

            <View testID="model-performance-dashboard-filter-row-jockey" style={styles.chipFilterRow}>
              <Text style={styles.chipFilterLabel}>Jockey</Text>
              <RNTextInput
                testID="model-performance-dashboard-jockey-input"
                style={styles.textFilterInput}
                value={draftJockeyText}
                onChangeText={setDraftJockeyText}
                placeholder="Any jockey"
                placeholderTextColor={colors.textTertiary}
              />
            </View>

            <View testID="model-performance-dashboard-filter-row-minModelWinProbability" style={styles.chipFilterRow}>
              <Text style={styles.chipFilterLabel}>Min model win probability (%)</Text>
              <RNTextInput
                testID="model-performance-dashboard-min-model-prob-input"
                style={styles.numericInput}
                value={draftMinModelWinProbability}
                onChangeText={setDraftMinModelWinProbability}
                keyboardType="numeric"
                maxLength={5}
              />
            </View>

            <View style={styles.filterActionsRow}>
              <Button
                testID="model-performance-dashboard-reset-button"
                mode="text"
                onPress={resetFilters}
                style={{ borderRadius: radii.button }}
              >
                Reset
              </Button>
              <Button
                testID="model-performance-dashboard-apply-button"
                mode="contained"
                buttonColor={colors.accent}
                onPress={applyFilters}
                style={{ borderRadius: radii.button }}
              >
                Apply
              </Button>
            </View>
          </Surface>

          {pnlRaces.length === 0 ? (
            <Text testID="model-performance-dashboard-pnl-empty" style={styles.stateText}>
              No qualifying runners for this filter set.
            </Text>
          ) : (
            <View style={styles.pnlRow}>
              <Surface testID="model-performance-dashboard-pnl-without" style={styles.pnlCard} elevation={1}>
                <Text style={styles.pnlCardTitle}>Without model</Text>
                <Text style={[styles.pnlCardValue, withoutModelPnl.pnl >= 0 ? styles.pnlPos : styles.pnlNeg]}>
                  {formatPnl(withoutModelPnl.pnl)} {formatPct(withoutModelPnl.pnl, withoutModelPnl.staked)}
                </Text>
                <Text style={styles.pnlCardMeta}>{withoutModelPnl.count} runners staked</Text>
              </Surface>
              <Surface testID="model-performance-dashboard-pnl-with" style={styles.pnlCard} elevation={1}>
                <Text style={styles.pnlCardTitle}>With model</Text>
                <Text style={[styles.pnlCardValue, withModelPnl.pnl >= 0 ? styles.pnlPos : styles.pnlNeg]}>
                  {formatPnl(withModelPnl.pnl)} {formatPct(withModelPnl.pnl, withModelPnl.staked)}
                </Text>
                <Text style={styles.pnlCardMeta}>{withModelPnl.count} runners staked</Text>
              </Surface>
            </View>
          )}
          </>
          )}
        </ScrollView>
      )}
    </Surface>
  );
};

const styles = StyleSheet.create({
  panel: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    zIndex: 100,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.sm,
    backgroundColor: colors.primary,
  },
  headerText: {
    flex: 1,
  },
  title: {
    color: "white",
    fontWeight: "700",
  },
  subtitle: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 12,
  },
  closeButton: {
    borderRadius: radii.button,
  },
  closeButtonLabel: {
    fontSize: 11,
    fontWeight: "600",
  },
  centerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    justifyContent: "center",
    paddingVertical: spacing.xl,
  },
  stateText: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: "center",
    paddingVertical: spacing.xl,
  },
  errorText: {
    fontSize: 14,
    color: colors.danger,
    textAlign: "center",
    paddingVertical: spacing.xl,
  },
  body: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  tableContainer: {
    gap: spacing.sm,
  },
  sortToggle: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  sortToggleText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.text,
  },
  tableHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xs,
  },
  tableHeaderCell: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.textSecondary,
    textTransform: "uppercase",
  },
  tableHeaderMetricCell: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 4,
  },
  tableHeaderTooltipRow: {
    paddingHorizontal: spacing.md,
  },
  metricsLegendRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  metricsLegendLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.textSecondary,
    textTransform: "uppercase",
    marginLeft: spacing.sm,
  },
  tableColModel: {
    flex: 2,
  },
  tableColDate: {
    flex: 1.3,
  },
  tableColMetric: {
    flex: 1,
    textAlign: "right",
  },
  tableColChevron: {
    width: 20,
    textAlign: "right",
  },
  tableRow: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  tableRowWide: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  tableRowNarrow: {
    padding: spacing.md,
    gap: spacing.xs,
  },
  tableCell: {
    fontSize: 13,
    color: colors.text,
  },
  tableCellStrong: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.text,
  },
  tableRowNarrowTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  tableChevronNarrow: {
    fontSize: 18,
    color: colors.textTertiary,
  },
  tableRowNarrowDate: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  tableRowNarrowMetrics: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  tableRowNarrowMetric: {
    fontSize: 12,
    color: colors.accent,
    fontWeight: "600",
  },
  backButton: {
    alignSelf: "flex-start",
    borderRadius: radii.button,
  },
  panelCard: {
    borderRadius: radii.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sectionTitle: {
    fontWeight: "700",
    color: colors.text,
    marginBottom: spacing.sm,
  },
  paramGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  paramRow: {
    minWidth: 140,
  },
  paramLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  paramLabel: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  paramValue: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.text,
  },
  tooltipToggle: {
    width: 16,
    height: 16,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.textTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  tooltipToggleText: {
    fontSize: 9,
    lineHeight: 11,
    fontWeight: "700",
    color: colors.textSecondary,
  },
  tooltipText: {
    marginTop: spacing.xs,
    maxWidth: 260,
    fontSize: 11,
    lineHeight: 15,
    color: "#fff",
    backgroundColor: colors.text,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.sm,
  },
  featureColsText: {
    marginTop: spacing.sm,
    fontSize: 11,
    color: colors.textTertiary,
  },
  metricRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.lg,
    marginBottom: spacing.sm,
  },
  metricStat: {
    minWidth: 140,
  },
  metricValue: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.text,
  },
  chartContainer: {
    width: "100%",
    alignItems: "center",
  },
  axisCaption: {
    fontSize: 11,
    color: colors.textTertiary,
    textAlign: "center",
    marginTop: spacing.xs,
  },
  chipFilterRow: {
    marginBottom: spacing.sm,
  },
  chipFilterLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  chipFilterEmptyText: {
    fontSize: 12,
    color: colors.textTertiary,
    fontStyle: "italic",
  },
  chipRowContent: {
    gap: spacing.xs,
  },
  chip: {
    borderColor: colors.border,
  },
  chipApplied: {
    backgroundColor: colors.accent,
  },
  chipPending: {
    backgroundColor: colors.primaryMuted,
  },
  chipTextApplied: {
    color: "white",
  },
  textFilterInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    fontSize: 13,
    color: colors.text,
  },
  numericInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    fontSize: 13,
    color: colors.text,
    width: 80,
  },
  filterActionsRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  pnlRow: {
    flexDirection: "row",
    gap: spacing.md,
  },
  pnlCard: {
    flex: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  pnlCardTitle: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  pnlCardValue: {
    fontSize: 18,
    fontWeight: "700",
  },
  pnlCardMeta: {
    fontSize: 11,
    color: colors.textTertiary,
    marginTop: spacing.xs,
  },
  pnlPos: {
    color: colors.pnlPositive,
  },
  pnlNeg: {
    color: colors.pnlNegative,
  },
});
