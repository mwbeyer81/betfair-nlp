import React, { useEffect, useMemo, useState } from "react";
import { View, StyleSheet, ScrollView, TouchableOpacity, TextInput as RNTextInput } from "react-native";
import { Text, Button, Surface, Divider, ActivityIndicator, Chip } from "react-native-paper";
import Svg, { Line as SvgLine, Circle } from "react-native-svg";
import { IspRace } from "../services/chatApi";
import { colors, radii, spacing } from "../theme";
import { computeRangePnl, computeModelFilteredPnl, formatPnl, formatPct, formatRaceDate } from "../utils/ispFormat";
import { DateRangePicker } from "./DateRangePicker";

// Colocated here for now since there's no backing API yet — once a real
// GET /api/model-versions endpoint exists, move these alongside a
// getModelVersions()/getModelVersionRaces(id) method in chatApi.ts (matching
// the PnlStats/RunnerConvergencePoint convention) and import them from there.
export interface ModelTrainingParams {
  nEstimators: number;
  learningRate: number;
  maxDepth: number;
  subsample: number;
  colsampleBytree: number;
  minChildWeight: number;
  randomState: number;
  earlyStoppingRounds: number;
}

export interface ModelRunMeta {
  featureCols: string[];
  trainRows: number;
  testRows: number;
  trainDateMax: string;
  testDateMin: string;
  bestIteration: number;
}

export interface CalibrationBucket {
  meanPredicted: number;
  actualWinRate: number;
  n: number;
}

export interface ModelPerformanceMetrics {
  aucRoc: number;
  logLoss: number;
  brierScore: number;
  calibrationTable: CalibrationBucket[];
}

export interface ModelVersion {
  id: string;
  runLabel: string;
  runAt: string;
  trainingParams: ModelTrainingParams;
  runMeta: ModelRunMeta;
  performanceMetrics: ModelPerformanceMetrics;
}

interface ModelPerformanceDashboardProps {
  modelVersions: ModelVersion[];
  selectedModelVersionId: string;
  onSelectModelVersion: (id: string) => void;
  // Races already "scored" for the currently-selected model version — the
  // parent swaps this array when selection changes, previewing how a future
  // GET /api/model-versions/:id/isp-races call would behave.
  races: IspRace[];
  loading: boolean;
  error: string | null;
  onClose: () => void;
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

function chipValue(race: IspRace, key: ChipFilterKey): string | null {
  switch (key) {
    case "country":
      return race.countryCode;
    case "course":
      return race.course;
    case "going":
      return race.going;
    case "raceClass":
      return race.raceClass;
    case "raceType":
      return race.raceType;
  }
}

function makeEmptyChipSelection(): Record<ChipFilterKey, Set<string>> {
  return { country: new Set(), course: new Set(), going: new Set(), raceClass: new Set(), raceType: new Set() };
}

function toYmd(iso: string): string {
  return iso.slice(0, 10);
}

function computeDateBounds(races: IspRace[]): { from: string; to: string } {
  if (races.length === 0) return { from: "2000-01-01", to: "2099-12-31" };
  let min = toYmd(races[0].raceTime);
  let max = min;
  for (const race of races) {
    const d = toYmd(race.raceTime);
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return { from: min, to: max };
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
}) => {
  const [draftChipSelected, setDraftChipSelected] = useState<Record<ChipFilterKey, Set<string>>>(makeEmptyChipSelection);
  const [appliedChipSelected, setAppliedChipSelected] = useState<Record<ChipFilterKey, Set<string>>>(makeEmptyChipSelection);
  const [draftTrainerText, setDraftTrainerText] = useState("");
  const [appliedTrainerText, setAppliedTrainerText] = useState("");
  const [draftJockeyText, setDraftJockeyText] = useState("");
  const [appliedJockeyText, setAppliedJockeyText] = useState("");
  const [draftMinModelWinProbability, setDraftMinModelWinProbability] = useState("0");
  const [appliedMinModelWinProbability, setAppliedMinModelWinProbability] = useState(0);
  const [appliedFromDate, setAppliedFromDate] = useState(() => computeDateBounds(races).from);
  const [appliedToDate, setAppliedToDate] = useState(() => computeDateBounds(races).to);

  // Switching model version swaps in a different `races` pool (a different
  // model may not have scored the same courses/date range) — stale filter
  // selections from the previous version could silently zero out the new
  // one's results, so a version switch resets filters back to defaults
  // rather than leaving them applied against a pool they weren't chosen for.
  useEffect(() => {
    const bounds = computeDateBounds(races);
    setDraftChipSelected(makeEmptyChipSelection());
    setAppliedChipSelected(makeEmptyChipSelection());
    setDraftTrainerText("");
    setAppliedTrainerText("");
    setDraftJockeyText("");
    setAppliedJockeyText("");
    setDraftMinModelWinProbability("0");
    setAppliedMinModelWinProbability(0);
    setAppliedFromDate(bounds.from);
    setAppliedToDate(bounds.to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [races]);

  const dateBounds = useMemo(() => computeDateBounds(races), [races]);

  const chipOptions = useMemo(() => {
    const options = {} as Record<ChipFilterKey, string[]>;
    for (const key of CHIP_FILTER_KEYS) {
      const values = new Set<string>();
      for (const race of races) {
        const value = chipValue(race, key);
        if (value != null) values.add(value);
      }
      options[key] = Array.from(values).sort();
    }
    return options;
  }, [races]);

  function toggleChip(key: ChipFilterKey, value: string) {
    setDraftChipSelected(prev => {
      const next = { ...prev, [key]: new Set(prev[key]) };
      if (next[key].has(value)) next[key].delete(value);
      else next[key].add(value);
      return next;
    });
  }

  function applyFilters() {
    setAppliedChipSelected(draftChipSelected);
    setAppliedTrainerText(draftTrainerText);
    setAppliedJockeyText(draftJockeyText);
    setAppliedMinModelWinProbability(Math.min(100, Math.max(0, parseFloat(draftMinModelWinProbability) || 0)));
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
    setAppliedFromDate(dateBounds.from);
    setAppliedToDate(dateBounds.to);
  }

  const filteredRaces = useMemo(() => {
    return races
      .filter(race => {
        for (const key of CHIP_FILTER_KEYS) {
          const applied = appliedChipSelected[key];
          if (applied.size > 0) {
            const value = chipValue(race, key);
            if (value == null || !applied.has(value)) return false;
          }
        }
        const raceYmd = toYmd(race.raceTime);
        if (raceYmd < appliedFromDate || raceYmd > appliedToDate) return false;
        return true;
      })
      .map(race => {
        if (!appliedTrainerText && !appliedJockeyText) return race;
        const runners = race.runners.filter(runner => {
          if (appliedTrainerText && !(runner.trainer ?? "").toLowerCase().includes(appliedTrainerText.toLowerCase())) return false;
          if (appliedJockeyText && !(runner.jockey ?? "").toLowerCase().includes(appliedJockeyText.toLowerCase())) return false;
          return true;
        });
        return { ...race, runners };
      })
      .filter(race => race.runners.length > 0);
  }, [races, appliedChipSelected, appliedFromDate, appliedToDate, appliedTrainerText, appliedJockeyText]);

  const withoutModelPnl = useMemo(() => computeRangePnl(filteredRaces), [filteredRaces]);
  const withModelPnl = useMemo(
    () => computeModelFilteredPnl(filteredRaces, appliedMinModelWinProbability),
    [filteredRaces, appliedMinModelWinProbability]
  );

  const selectedVersion = modelVersions.find(v => v.id === selectedModelVersionId) ?? modelVersions[0] ?? null;

  function renderParamRow(label: string, value: string | number) {
    return (
      <View key={label} style={styles.paramRow}>
        <Text style={styles.paramLabel}>{label}</Text>
        <Text style={styles.paramValue}>{value}</Text>
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
          {selectedVersion != null && (
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
          <ScrollView
            horizontal
            testID="model-performance-dashboard-version-list"
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.versionRow}
          >
            {modelVersions.map(version => {
              const isSelected = version.id === selectedVersion.id;
              return (
                <TouchableOpacity
                  key={version.id}
                  testID={`model-performance-dashboard-version-${version.id}`}
                  onPress={() => onSelectModelVersion(version.id)}
                  style={[styles.versionCard, isSelected && styles.versionCardSelected]}
                >
                  <Text style={styles.versionCardLabel}>{version.runLabel}</Text>
                  <Text style={styles.versionCardDate}>{formatRaceDate(version.runAt)}</Text>
                  <Text style={styles.versionCardAuc}>AUC {version.performanceMetrics.aucRoc.toFixed(3)}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

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
              <Text testID="model-performance-dashboard-auc" style={styles.metricValue}>
                AUC-ROC {selectedVersion.performanceMetrics.aucRoc.toFixed(3)}
              </Text>
              <Text testID="model-performance-dashboard-logloss" style={styles.metricValue}>
                LogLoss {selectedVersion.performanceMetrics.logLoss.toFixed(3)}
              </Text>
              <Text testID="model-performance-dashboard-brier" style={styles.metricValue}>
                Brier {selectedVersion.performanceMetrics.brierScore.toFixed(3)}
              </Text>
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
                minDate={dateBounds.from}
                maxDate={dateBounds.to}
                onChange={(from, to) => {
                  setAppliedFromDate(from);
                  setAppliedToDate(to);
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
              <Button testID="model-performance-dashboard-reset-button" mode="text" onPress={resetFilters}>
                Reset
              </Button>
              <Button
                testID="model-performance-dashboard-apply-button"
                mode="contained"
                buttonColor={colors.accent}
                onPress={applyFilters}
              >
                Apply
              </Button>
            </View>
          </Surface>

          {filteredRaces.length === 0 ? (
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
    borderRadius: radii.sm,
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
  versionRow: {
    gap: spacing.sm,
    paddingBottom: spacing.xs,
  },
  versionCard: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minWidth: 140,
  },
  versionCardSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.primaryLight,
  },
  versionCardLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.text,
  },
  versionCardDate: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  versionCardAuc: {
    fontSize: 12,
    color: colors.accent,
    fontWeight: "600",
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
  paramLabel: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  paramValue: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.text,
  },
  featureColsText: {
    marginTop: spacing.sm,
    fontSize: 11,
    color: colors.textTertiary,
  },
  metricRow: {
    flexDirection: "row",
    gap: spacing.lg,
    marginBottom: spacing.sm,
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
