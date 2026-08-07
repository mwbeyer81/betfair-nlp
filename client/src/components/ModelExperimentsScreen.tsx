import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, ScrollView, StyleSheet, SafeAreaView, TouchableOpacity } from "react-native";
import { Text, ActivityIndicator, Surface, Button, Chip } from "react-native-paper";
import {
  chatApi,
  ModelExperiment,
  ModelExperimentSummary,
  ExperimentSegment,
  DiscoveredSegment,
} from "../services/chatApi";
import { PageContainer } from "./PageContainer";
import { AppHeader } from "./AppHeader";
import { colors, radii, spacing } from "../theme";
import { useResponsive } from "../utils/responsive";
import type { Route } from "../hooks/useRouter";

interface ModelExperimentsScreenProps {
  navigate: (to: Route, query?: string) => void;
  isAuthenticated: boolean;
  onLogout: () => void;
  onBack: () => void;
}

// Same single-open tooltip pattern as ModelPerformanceDashboard's
// PROPERTY_TOOLTIPS and ModelAccuracyScreen's COLUMN_TOOLTIPS. Two of these
// carry findings that are otherwise only written down in AGENTS.md, and this
// is where someone reading a result actually needs them.
const TOOLTIPS: Record<string, string> = {
  brier:
    "Mean squared error of the win probability against the 0/1 result. Lower is better, 0 is perfect. The industry SP scores 0.0871 over the same runners — that is the number to beat.",
  delta:
    "Change against the baseline experiment. For Brier and log loss a NEGATIVE number is an IMPROVEMENT (less error), which is why green means negative in those columns. For AUC, resolution and top-1 rate it is the other way round.",
  bss:
    "Brier Skill Score against industry SP: 1 - (model Brier / market Brier). Zero means the model matches the price; negative means it is worse. The deployed model scores -0.070.",
  resolution:
    "How well the model separates winners from losers — the discrimination half of the Brier score. This is the number that matters most here: 99.2% of the deployed model's deficit against SP is resolution, not calibration, so post-processing cannot close it and only new information can.",
  reliability:
    "The calibration half of the Brier score: how close stated probabilities are to observed frequencies. Both the model and the market are already almost perfect on this, which is exactly why it is not where the gap lives.",
  top1Rate:
    "How often the model's highest-rated runner actually won the race. A pure ranking measure, so unlike Brier it cannot be flattered by being better calibrated about outcomes the model cannot separate.",
  staking:
    "Two conventions, always shown together. To-win-£1 stakes 1/(price-1) so a winner returns £1 profit; level stakes £1 flat. To-win-£1 is dominated by favourites (it stakes ~£2 on an evens shot and ~5p on a 20/1 shot), so level stakes is the one to read for 'is there an edge'.",
  bothStakings:
    "A slice that is profitable under one staking convention and losing under the other is noise, not an edge — it is the same set of bets scored two ways, so the signs must agree. A previous analysis produced exactly such a cell (+2.0% level, -1.5% to-win) and it was correctly discarded. The acceptance rule below refuses them automatically.",
  mode:
    "Fast runs score five folds on half the races with a capped tree count, so they are for comparing ideas against each other, not against a full run. Full runs score all eleven folds with no cap. The harness refuses to record a capped run as 'full'.",
  sparse:
    "Features that are almost entirely missing, and so contribute nothing while looking like part of the model. Three of the deployed model's numeric features have been in this state since 2026-07-26.",
};

const OBJECTIVE_LABELS: Record<string, string> = {
  binary: "binary logistic",
  softmax_race: "conditional logit",
  rank_pairwise: "pairwise ranking",
};

const SELECTION_LABELS: Record<string, string> = {
  all: "back everything",
  modelBeatsMarket: "model beats market",
  modelTop1: "model's top pick",
};

// Metrics where a LOWER number is better, so a negative delta is an
// improvement. Getting this backwards is the single most likely misread on
// this screen, which is why the direction is data rather than a hardcoded
// colour at each call site.
const LOWER_IS_BETTER = new Set(["brierScore", "logLoss"]);

function fmt(value: number | null | undefined, places = 4): string {
  return value === null || value === undefined || Number.isNaN(value) ? "—" : value.toFixed(places);
}

function fmtPct(value: number | null | undefined, places = 2): string {
  return value === null || value === undefined || Number.isNaN(value) ? "—" : `${value.toFixed(places)}%`;
}

function fmtSigned(value: number | null | undefined, places = 5): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(places)}`;
}

function deltaColor(metric: string, value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return colors.textSecondary;
  const improved = LOWER_IS_BETTER.has(metric) ? value < 0 : value > 0;
  return improved ? colors.success : colors.danger;
}

export const ModelExperimentsScreen: React.FC<ModelExperimentsScreenProps> = ({
  navigate,
  isAuthenticated,
  onLogout,
  onBack,
}) => {
  const { isNarrow } = useResponsive();
  const [experiments, setExperiments] = useState<ModelExperimentSummary[]>([]);
  const [selected, setSelected] = useState<ModelExperiment | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dimension, setDimension] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openTooltip, setOpenTooltip] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await chatApi.getModelExperiments();
      setExperiments(res.data ?? []);
    } catch {
      // This screen has nothing to show without its data, so a failure is an
      // error state rather than an empty list — an empty list would read as
      // "no experiments have been run", which is a different claim.
      setError("Could not load model experiments.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const openExperiment = useCallback(async (id: string) => {
    setSelectedId(id);
    setDetailLoading(true);
    setError(null);
    try {
      const detail = await chatApi.getModelExperiment(id);
      setSelected(detail);
      setDimension(detail.segmentDimensions[0] ?? "");
    } catch {
      setError("Could not load that experiment.");
      setSelectedId(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const backToList = useCallback(() => {
    setSelected(null);
    setSelectedId(null);
  }, []);

  const tooltip = useCallback(
    (key: string, label: string) => (
      <TouchableOpacity
        testID={`model-experiments-tooltip-toggle-${key}`}
        onPress={() => setOpenTooltip(prev => (prev === key ? null : key))}
        accessibilityRole="button"
      >
        <Text style={styles.tooltipLabel}>
          {label} <Text style={styles.tooltipHint}>ⓘ</Text>
        </Text>
      </TouchableOpacity>
    ),
    []
  );

  const tooltipText = (key: string) =>
    openTooltip === key ? (
      <Text testID={`model-experiments-tooltip-text-${key}`} style={styles.tooltipText}>
        {TOOLTIPS[key]}
      </Text>
    ) : null;

  const visibleSegments = useMemo(
    () => (selected?.segments ?? []).filter(s => s.dimension === dimension),
    [selected, dimension]
  );

  const header = (
    <AppHeader
      navigate={navigate}
      isAuthenticated={isAuthenticated}
      onLogout={onLogout}
      onBack={selected ? backToList : onBack}
      subtitle="Model Experiments"
      testIdPrefix="model-experiments"
    />
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.screen} testID="model-experiments-screen">
        {header}
        <View testID="model-experiments-loading" style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (error && !selected) {
    return (
      <SafeAreaView style={styles.screen} testID="model-experiments-screen">
        {header}
        <View testID="model-experiments-error" style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
          <Button mode="contained" onPress={() => void loadList()} style={styles.retry}>
            Retry
          </Button>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} testID="model-experiments-screen">
      {header}
      <ScrollView contentContainerStyle={styles.scroll}>
        <PageContainer maxWidth={1100}>
          {!selected ? (
            <ListView
              experiments={experiments}
              onOpen={openExperiment}
              detailLoading={detailLoading}
              selectedId={selectedId}
              isPhone={isNarrow}
              tooltip={tooltip}
              tooltipText={tooltipText}
            />
          ) : (
            <DetailView
              experiment={selected}
              dimension={dimension}
              setDimension={setDimension}
              segments={visibleSegments}
              onBack={backToList}
              navigate={navigate}
              tooltip={tooltip}
              tooltipText={tooltipText}
            />
          )}
        </PageContainer>
      </ScrollView>
    </SafeAreaView>
  );
};

// ---------------------------------------------------------------------------

const ListView: React.FC<{
  experiments: ModelExperimentSummary[];
  onOpen: (id: string) => void;
  detailLoading: boolean;
  selectedId: string | null;
  isPhone: boolean;
  tooltip: (key: string, label: string) => React.ReactNode;
  tooltipText: (key: string) => React.ReactNode;
}> = ({ experiments, onOpen, detailLoading, selectedId, isPhone, tooltip, tooltipText }) => {
  if (experiments.length === 0) {
    return (
      <Surface style={styles.card} testID="model-experiments-empty">
        <Text style={styles.emptyTitle}>No experiments recorded yet</Text>
        <Text style={styles.bodyText}>
          Each run of ml/experiment.py records one iteration here — its feature set, training
          objective, walk-forward metrics and the slices where it beats or loses to industry SP.
        </Text>
      </Surface>
    );
  }

  return (
    <View testID="model-experiments-list">
      <Surface style={styles.card}>
        <Text style={styles.cardTitle}>Iterations</Text>
        <Text style={styles.bodyText}>
          Newest first. {tooltip("mode", "Fast and full runs are not comparable")} — and the
          deployed model, for reference, scores Brier 0.0932 / AUC 0.719 against industry SP's
          0.0871 / 0.786.
        </Text>
        {tooltipText("mode")}
        <View style={styles.tooltipRow}>{tooltip("delta", "How to read Δ")}</View>
        {tooltipText("delta")}
      </Surface>

      {experiments.map(exp => {
        const delta = exp.metrics.deltaVsBaseline;
        return (
          <TouchableOpacity
            key={exp.id}
            testID={`model-experiments-row-${exp.id}`}
            onPress={() => onOpen(exp.id)}
            disabled={detailLoading}
          >
            <Surface style={[styles.card, selectedId === exp.id && styles.cardSelected]}>
              <View style={styles.rowHeader}>
                <Text style={styles.experimentName}>{exp.name}</Text>
                <Chip compact style={exp.mode === "full" ? styles.chipFull : styles.chipFast}>
                  {exp.mode}
                </Chip>
              </View>
              <Text style={styles.metaLine}>
                {OBJECTIVE_LABELS[exp.objective] ?? exp.objective} · {exp.featureSetName} ·{" "}
                {exp.featureCount || exp.newFeatureCount} features · {exp.meta.foldCount} folds ·{" "}
                {exp.meta.scoredRows.toLocaleString()} rows
              </Text>
              {exp.notes ? <Text style={styles.notes}>{exp.notes}</Text> : null}

              <View style={[styles.metricGrid, isPhone && styles.metricGridPhone]}>
                <Metric label="Brier" value={fmt(exp.metrics.model.brierScore)} />
                <Metric label="AUC" value={fmt(exp.metrics.model.aucRoc)} />
                <Metric label="Resolution" value={fmt(exp.metrics.model.resolution, 6)} />
                <Metric label="Top-1" value={fmtPct((exp.metrics.model.top1Rate ?? 0) * 100)} />
                <Metric
                  label="BSS vs SP"
                  value={fmtSigned(exp.metrics.bss, 4)}
                  color={(exp.metrics.bss ?? -1) >= 0 ? colors.success : colors.danger}
                />
                {delta ? (
                  <Metric
                    label="Δ Brier"
                    value={fmtSigned(delta.brierScore)}
                    color={deltaColor("brierScore", delta.brierScore)}
                  />
                ) : null}
              </View>

              {exp.discoveredCount > 0 ? (
                <Text style={styles.discoveredBadge}>
                  {exp.discoveredCount} segment{exp.discoveredCount === 1 ? "" : "s"} passed the
                  acceptance rule
                </Text>
              ) : null}
            </Surface>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

// ---------------------------------------------------------------------------

const DetailView: React.FC<{
  experiment: ModelExperiment;
  dimension: string;
  setDimension: (d: string) => void;
  segments: ExperimentSegment[];
  onBack: () => void;
  navigate: (to: Route, query?: string) => void;
  tooltip: (key: string, label: string) => React.ReactNode;
  tooltipText: (key: string) => React.ReactNode;
}> = ({ experiment, dimension, setDimension, segments, onBack, navigate, tooltip, tooltipText }) => {
  const { model, calibrated, market, bss, deltaVsBaseline } = experiment.metrics;

  const viewInFilters = (d: DiscoveredSegment) => {
    if (!d.filters) return;
    // Built from the same param spellings ISP_FILTER_PARAM_NAMES uses, so the
    // link lands on the Filters screen with the slice already applied.
    const params = new URLSearchParams(d.filters);
    navigate("/isp", params.toString());
  };

  return (
    <View testID="model-experiments-detail">
      <Button
        testID="model-experiments-back-to-list"
        mode="outlined"
        compact
        onPress={onBack}
        style={styles.backButton}
      >
        ← All experiments
      </Button>

      {experiment.sparseFeatures.length > 0 ? (
        <Surface style={[styles.card, styles.warningCard]} testID="model-experiments-coverage-warning">
          <Text style={styles.warningTitle}>
            {experiment.sparseFeatures.length} feature
            {experiment.sparseFeatures.length === 1 ? " is" : "s are"} almost entirely missing
          </Text>
          <Text style={styles.bodyText}>
            {experiment.sparseFeatures.map(f => `${f.col} (${f.populatedPct}%)`).join(", ")}
          </Text>
          {tooltip("sparse", "Why this matters")}
          {tooltipText("sparse")}
        </Surface>
      ) : null}

      {/* The payoff, so it goes first. */}
      <Surface style={styles.card} testID="model-experiments-discovered-list">
        <Text style={styles.cardTitle}>Discovered segments</Text>
        {experiment.discoveredSegments.length === 0 ? (
          <Text style={styles.bodyText}>
            No slice passed the acceptance rule — at least {String(experiment.acceptanceRule.minN ?? "—")}{" "}
            runners, a positive Brier Skill Score against SP, profitable under BOTH staking
            conventions, and positive in at least{" "}
            {String(experiment.acceptanceRule.minYearsPositive ?? "—")} of the{" "}
            {String(experiment.acceptanceRule.foldYearsScored ?? experiment.meta.foldCount)} years
            this run scored.
          </Text>
        ) : (
          experiment.discoveredSegments.map((d, i) => (
            <View key={`${d.dimension}-${d.bucket}-${d.selection}`} style={styles.discoveredRow}
                  testID={`model-experiments-discovered-row-${i}`}>
              <Text style={styles.discoveredTitle}>
                {d.dimension} = {d.bucket} · {SELECTION_LABELS[d.selection] ?? d.selection}
              </Text>
              <Text style={styles.metaLine}>
                {d.n.toLocaleString()} runners · strike {fmtPct(d.strikeRate)} · BSS{" "}
                {fmtSigned(d.bss, 4)} · ROI {fmtPct(d.roiLevel)} level / {fmtPct(d.roiToWin1)}{" "}
                to-win · positive in {d.yearsPositiveToWin1} years
              </Text>
              {d.ispFilterable && d.filters ? (
                <Button
                  testID={`model-experiments-discovered-view-in-filters-${i}`}
                  mode="outlined"
                  compact
                  onPress={() => viewInFilters(d)}
                  style={styles.inlineButton}
                >
                  View in Filters
                </Button>
              ) : (
                <Text style={styles.mutedNote}>
                  Not expressible as a saved filter — the Filters screen has no parameter for this
                  slice.
                </Text>
              )}
            </View>
          ))
        )}
        <View style={styles.tooltipRow}>{tooltip("bothStakings", "Why both staking conventions must agree")}</View>
        {tooltipText("bothStakings")}
      </Surface>

      <Surface style={styles.card} testID="model-experiments-meta">
        <Text style={styles.cardTitle}>{experiment.name}</Text>
        {experiment.notes ? <Text style={styles.notes}>{experiment.notes}</Text> : null}
        <Text style={styles.metaLine}>
          {experiment.id} · {OBJECTIVE_LABELS[experiment.objective] ?? experiment.objective} ·
          feature set “{experiment.featureSetName}” · {experiment.featureCount} features (
          {experiment.newFeatureCount} new)
        </Text>
        <Text style={styles.metaLine}>
          {experiment.mode} mode · folds {experiment.meta.foldYears.join(", ")} ·{" "}
          {experiment.meta.scoredRows.toLocaleString()} scored rows ·{" "}
          {experiment.meta.coverageMinDate} → {experiment.meta.coverageMaxDate}
        </Text>
        <Text style={styles.metaLine}>
          run {new Date(experiment.runAt).toLocaleString()} · {experiment.meta.totalSeconds}s
          {experiment.meta.gitCommit ? ` · build ${experiment.meta.gitCommit}` : ""}
          {experiment.meta.droppedTrainRaces
            ? ` · ${experiment.meta.droppedTrainRaces} races dropped from training (dead heats)`
            : ""}
        </Text>
      </Surface>

      <Surface style={styles.card} testID="model-experiments-metrics">
        <Text style={styles.cardTitle}>Overall, out-of-sample</Text>
        <Text style={styles.bodyText}>
          Model and market scored on exactly the same runners.{" "}
          {tooltip("resolution", "Resolution is the number to watch")}
        </Text>
        {tooltipText("resolution")}

        <View style={styles.compareRow}>
          <CompareColumn title="Model" metrics={model} />
          <CompareColumn title="Calibrated" metrics={calibrated} />
          <CompareColumn title="Market (SP)" metrics={market} highlight />
        </View>

        <View style={styles.tooltipRow}>{tooltip("bss", `Brier Skill Score ${fmtSigned(bss, 4)}`)}</View>
        {tooltipText("bss")}

        {deltaVsBaseline ? (
          <View style={styles.deltaRow}>
            <Text style={styles.subTitle}>
              Δ vs {experiment.baselineExperimentId ?? "baseline"}
            </Text>
            {Object.entries(deltaVsBaseline).map(([metric, value]) => (
              <Text key={metric} style={[styles.deltaItem, { color: deltaColor(metric, value) }]}>
                {metric} {fmtSigned(value)}
              </Text>
            ))}
          </View>
        ) : null}
      </Surface>

      <Surface style={styles.card} testID="model-experiments-fold-table">
        <Text style={styles.cardTitle}>Folds</Text>
        <View style={styles.tableHeader}>
          <Text style={[styles.th, styles.colYear]}>Year</Text>
          <Text style={[styles.th, styles.colNum]}>Train</Text>
          <Text style={[styles.th, styles.colNum]}>Scored</Text>
          <Text style={[styles.th, styles.colNum]}>Brier</Text>
          <Text style={[styles.th, styles.colNum]}>AUC</Text>
          <Text style={[styles.th, styles.colNum]}>Secs</Text>
        </View>
        {experiment.folds.map(fold => {
          const raw = (fold.raw ?? {}) as Record<string, number | null>;
          return (
            <View
              key={String(fold.year)}
              testID={`model-experiments-fold-row-${String(fold.year)}`}
              style={styles.tableRow}
            >
              <Text style={[styles.td, styles.colYear]}>{String(fold.year)}</Text>
              <Text style={[styles.td, styles.colNum]}>{Number(fold.trainRows).toLocaleString()}</Text>
              <Text style={[styles.td, styles.colNum]}>{Number(fold.scoredRows).toLocaleString()}</Text>
              <Text style={[styles.td, styles.colNum]}>{fmt(raw.brierScore)}</Text>
              <Text style={[styles.td, styles.colNum]}>{fmt(raw.aucRoc)}</Text>
              <Text style={[styles.td, styles.colNum]}>{String(fold.seconds)}</Text>
            </View>
          );
        })}
      </Surface>

      <Surface style={styles.card} testID="model-experiments-segment-table">
        <Text style={styles.cardTitle}>Segments</Text>
        <Text style={styles.bodyText}>
          Where the model beats or loses to the price, sliced nine ways.{" "}
          {tooltip("staking", "Two staking conventions")}
        </Text>
        {tooltipText("staking")}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
          {experiment.segmentDimensions.map(d => (
            <Chip
              key={d}
              testID={`model-experiments-segment-dimension-${d}`}
              compact
              selected={d === dimension}
              onPress={() => setDimension(d)}
              style={styles.dimensionChip}
            >
              {d}
            </Chip>
          ))}
        </ScrollView>

        <View style={styles.tableHeader}>
          <Text style={[styles.th, styles.colBucket]}>Bucket</Text>
          <Text style={[styles.th, styles.colNum]}>n</Text>
          <Text style={[styles.th, styles.colNum]}>Won</Text>
          <Text style={[styles.th, styles.colNum]}>Model</Text>
          <Text style={[styles.th, styles.colNum]}>Market</Text>
          <Text style={[styles.th, styles.colNum]}>BSS</Text>
          <Text style={[styles.th, styles.colNum]}>ROI lvl</Text>
          <Text style={[styles.th, styles.colNum]}>ROI win</Text>
        </View>
        {segments.map(seg => {
          const all = seg.selections.all;
          return (
            <View
              key={`${seg.dimension}-${seg.bucket}`}
              testID={`model-experiments-segment-row-${seg.dimension}-${seg.bucket}`}
              style={styles.tableRow}
            >
              <Text style={[styles.td, styles.colBucket]}>{seg.bucket}</Text>
              <Text style={[styles.td, styles.colNum]}>{seg.n.toLocaleString()}</Text>
              <Text style={[styles.td, styles.colNum]}>{fmtPct(seg.strikeRate, 1)}</Text>
              <Text style={[styles.td, styles.colNum]}>{fmt(seg.model.brierScore)}</Text>
              <Text style={[styles.td, styles.colNum]}>{fmt(seg.market.brierScore)}</Text>
              <Text
                style={[
                  styles.td,
                  styles.colNum,
                  { color: (seg.bss ?? -1) >= 0 ? colors.success : colors.danger },
                ]}
              >
                {fmtSigned(seg.bss, 3)}
              </Text>
              <Text style={[styles.td, styles.colNum]}>{fmtPct(all?.pnl.level?.roiPct, 1)}</Text>
              <Text style={[styles.td, styles.colNum]}>{fmtPct(all?.pnl.toWin1?.roiPct, 1)}</Text>
            </View>
          );
        })}
      </Surface>
    </View>
  );
};

const Metric: React.FC<{ label: string; value: string; color?: string }> = ({
  label,
  value,
  color,
}) => (
  <View style={styles.metric}>
    <Text style={styles.metricLabel}>{label}</Text>
    <Text style={[styles.metricValue, color ? { color } : null]}>{value}</Text>
  </View>
);

const CompareColumn: React.FC<{
  title: string;
  metrics: { brierScore: number | null; aucRoc: number | null; logLoss: number | null; resolution?: number | null; reliability?: number | null; top1Rate?: number | null };
  highlight?: boolean;
}> = ({ title, metrics, highlight }) => (
  <View style={[styles.compareColumn, highlight && styles.compareColumnHighlight]}>
    <Text style={styles.compareTitle}>{title}</Text>
    <Text style={styles.compareItem}>Brier {fmt(metrics.brierScore)}</Text>
    <Text style={styles.compareItem}>AUC {fmt(metrics.aucRoc)}</Text>
    <Text style={styles.compareItem}>Log loss {fmt(metrics.logLoss)}</Text>
    <Text style={styles.compareItem}>Resolution {fmt(metrics.resolution, 6)}</Text>
    <Text style={styles.compareItem}>Reliability {fmt(metrics.reliability, 6)}</Text>
    <Text style={styles.compareItem}>Top-1 {fmtPct((metrics.top1Rate ?? 0) * 100, 1)}</Text>
  </View>
);

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  errorText: { color: colors.danger, marginBottom: spacing.lg, textAlign: "center" },
  retry: { marginTop: spacing.md },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardSelected: { borderColor: colors.primary },
  warningCard: { borderColor: colors.warning, backgroundColor: "#FFFBEB" },
  warningTitle: { fontWeight: "600", color: colors.warning, marginBottom: spacing.xs },
  cardTitle: { fontSize: 18, fontWeight: "600", color: colors.text, marginBottom: spacing.sm },
  subTitle: { fontWeight: "600", color: colors.text, marginRight: spacing.sm },
  emptyTitle: { fontSize: 16, fontWeight: "600", color: colors.text, marginBottom: spacing.sm },
  bodyText: { color: colors.textSecondary, lineHeight: 20 },
  notes: { color: colors.textSecondary, fontStyle: "italic", marginBottom: spacing.sm },
  metaLine: { color: colors.textSecondary, fontSize: 13, marginBottom: spacing.xs },
  mutedNote: { color: colors.textTertiary, fontSize: 12, marginTop: spacing.xs },
  rowHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  experimentName: { fontSize: 16, fontWeight: "600", color: colors.text, flexShrink: 1 },
  chipFast: { backgroundColor: colors.infoLight },
  chipFull: { backgroundColor: colors.successLight },
  metricGrid: { flexDirection: "row", flexWrap: "wrap", marginTop: spacing.sm },
  metricGridPhone: { flexDirection: "column" },
  metric: { marginRight: spacing.xl, marginBottom: spacing.sm, minWidth: 90 },
  metricLabel: { fontSize: 11, color: colors.textTertiary, textTransform: "uppercase" },
  metricValue: { fontSize: 15, fontWeight: "600", color: colors.text },
  discoveredBadge: { color: colors.success, fontWeight: "600", marginTop: spacing.xs },
  discoveredRow: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
    marginTop: spacing.md,
  },
  discoveredTitle: { fontWeight: "600", color: colors.text, marginBottom: spacing.xs },
  inlineButton: { alignSelf: "flex-start", marginTop: spacing.sm },
  backButton: { alignSelf: "flex-start", marginBottom: spacing.lg },
  compareRow: { flexDirection: "row", flexWrap: "wrap", marginTop: spacing.md },
  compareColumn: {
    flexGrow: 1,
    minWidth: 160,
    padding: spacing.md,
    borderRadius: radii.sm,
    backgroundColor: colors.background,
    marginRight: spacing.sm,
    marginBottom: spacing.sm,
  },
  compareColumnHighlight: { backgroundColor: colors.primaryLight },
  compareTitle: { fontWeight: "600", color: colors.text, marginBottom: spacing.xs },
  compareItem: { color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
  deltaRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", marginTop: spacing.md },
  deltaItem: { marginRight: spacing.md, fontSize: 13, fontWeight: "600" },
  tableHeader: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: spacing.xs,
    marginTop: spacing.md,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.background,
  },
  th: { fontSize: 11, color: colors.textTertiary, textTransform: "uppercase", fontWeight: "600" },
  td: { fontSize: 13, color: colors.text },
  colYear: { width: 60 },
  colBucket: { width: 120 },
  colNum: { flex: 1, textAlign: "right", paddingRight: spacing.sm },
  chipScroll: { marginVertical: spacing.md },
  dimensionChip: { marginRight: spacing.sm },
  tooltipRow: { marginTop: spacing.sm },
  tooltipLabel: { color: colors.primary, fontSize: 13, fontWeight: "600" },
  tooltipHint: { color: colors.textTertiary },
  tooltipText: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    marginTop: spacing.xs,
    padding: spacing.sm,
    backgroundColor: colors.background,
    borderRadius: radii.sm,
  },
});
