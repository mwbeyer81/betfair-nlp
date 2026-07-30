import React, { useCallback, useEffect, useState } from "react";
import { View, ScrollView, StyleSheet, SafeAreaView, TouchableOpacity } from "react-native";
import { Text, ActivityIndicator, Surface, Button, Chip } from "react-native-paper";
import { chatApi, ModelAccuracyBand, ModelAccuracyFilters, ModelVersion } from "../services/chatApi";
import { PageContainer } from "./PageContainer";
import { AppHeader } from "./AppHeader";
import { DateRangePicker } from "./DateRangePicker";
import { colors, radii, spacing } from "../theme";
import { useResponsive } from "../utils/responsive";
import { formatGbp, formatPnl } from "../utils/ispFormat";
import { toFractionalOdds } from "../utils/oddsFormat";
import type { Route } from "../hooks/useRouter";

interface ModelAccuracyScreenProps {
  navigate: (to: Route, query?: string) => void;
  isAuthenticated: boolean;
  onLogout: () => void;
  onBack: () => void;
}

// Plain-English explanations for every column — same single-open tooltip
// pattern as ModelPerformanceDashboard's PROPERTY_TOOLTIPS (:83-114). This is
// the screen where they matter most: half these columns are meaningless
// without knowing which direction is good.
const COLUMN_TOOLTIPS: Record<string, string> = {
  "Model price":
    "The price the model itself makes this runner, from its win probability (a 25% chance is a price of 4.0). Rows are grouped by that price, shortest first — not by the price the bookmaker offered.",
  Runners:
    "How many runners the model priced into this band, across every race matching your filters.",
  "Model says":
    "The average win chance the model gave runners in this band. Compare it to 'Actually won' on the same row.",
  "Actually won":
    "The share of those runners that actually won. If this is well below 'Model says', the model is over-rating this price band and backing it loses money.",
  "Market said":
    "What the industry SP implied, after the bookmaker's margin is taken out so it's a fair comparison against the model. A bookmaker's book adds up to about 115-125%, not 100%.",
  "Break-even":
    "The same market view WITH the margin left in — this is the number a bet actually has to beat to be value, which is why it's always higher than 'Market said'.",
  "Model error":
    "How far the model was from the truth, in percentage points. Positive means it over-rated the band. Closer to zero is better.",
  "Market error":
    "The same gap for the market. Whichever of the two errors is closer to zero was nearer the truth — that's where you learn which prices to trust the model at.",
  "P&L":
    "Profit or loss from backing every runner in this band at its industry SP, staking to win £1 each time.",
  ROI: "That profit as a percentage of the total staked.",
  Brier:
    "A combined accuracy score where lower is better (0 is perfect). Shown for the model and the market over exactly the same runners.",
};

// DateRangePicker formats whatever it's given, so an empty string renders as
// "Jan 1, NaN" — it needs real YYYY-MM-DD bounds. Same coverage window
// ModelVsSpScreen uses: every year from 2015 carries scored runners.
const MODEL_COVERAGE_MIN_DATE = "2015-01-01";
const ABSOLUTE_MAX_DATE = "2026-12-31";

// The table's own columns, in render order. "Brier" is in COLUMN_TOOLTIPS too
// but lives on its own card below the table, so it is deliberately not here.
const TABLE_COLUMN_KEYS = [
  "Model price",
  "Runners",
  "Model says",
  "Actually won",
  "Market said",
  "Break-even",
  "Model error",
  "Market error",
  "P&L",
  "ROI",
];

// Reuses the app-wide P&L colour convention: success/danger on a white
// background, not the pnlPositive/pnlNegative pastels (those are for the dark
// split cards).
function pnlColor(value: number): string {
  if (value > 0) return colors.success;
  if (value < 0) return colors.danger;
  return colors.textSecondary;
}

// Signed percentage points, e.g. "+4.2" / "-11.8". A band with no runners
// shows a dash rather than a misleading 0.0.
function formatPp(value: number, hasRunners: boolean): string {
  if (!hasRunners) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
}

function formatPct(value: number, hasRunners: boolean): string {
  if (!hasRunners) return "—";
  return `${value.toFixed(1)}%`;
}

// The band label already reads as decimal odds; adding the fractional form
// matches the "Fair {fraction} ({decimal})" framing used on the Daily Races
// pick badges.
function bandSubLabel(band: ModelAccuracyBand): string {
  if (band.maxPrice != null && band.minPrice == null) return `shorter than ${toFractionalOdds(band.maxPrice)}`;
  if (band.minPrice != null && band.maxPrice == null) return `${toFractionalOdds(band.minPrice)} and bigger`;
  if (band.minPrice != null && band.maxPrice != null) {
    return `${toFractionalOdds(band.minPrice)} – ${toFractionalOdds(band.maxPrice)}`;
  }
  return "";
}

export function ModelAccuracyScreen({
  navigate,
  isAuthenticated,
  onLogout,
  onBack,
}: ModelAccuracyScreenProps) {
  const { isTablet } = useResponsive();

  const [bands, setBands] = useState<ModelAccuracyBand[]>([]);
  const [overall, setOverall] = useState<ModelAccuracyBand | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openTooltip, setOpenTooltip] = useState<string | null>(null);

  const [modelVersions, setModelVersions] = useState<ModelVersion[]>([]);

  // Draft/applied filter pair, same convention as ModelPerformanceDashboard
  // (:158-181) — nothing refetches until Apply is pressed, except the date
  // picker, which has its own confirm step.
  const [draftFromDate, setDraftFromDate] = useState(MODEL_COVERAGE_MIN_DATE);
  const [draftToDate, setDraftToDate] = useState(ABSOLUTE_MAX_DATE);
  const [draftModelVersionId, setDraftModelVersionId] = useState<string | null>(null);
  // Seeded with the same window the picker displays, so what's on screen is
  // always what was actually applied.
  const [appliedFilters, setAppliedFilters] = useState<ModelAccuracyFilters>({
    minDate: MODEL_COVERAGE_MIN_DATE,
    maxDate: ABSOLUTE_MAX_DATE,
  });

  const load = useCallback(async (filters: ModelAccuracyFilters) => {
    setLoading(true);
    setError(null);
    try {
      const response = await chatApi.getModelAccuracy(filters);
      setBands(response.data);
      setOverall(response.overall);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load model accuracy");
      setBands([]);
      setOverall(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(appliedFilters);
  }, [load, appliedFilters]);

  useEffect(() => {
    // Best-effort: the version picker is a convenience, so a failure here must
    // not blank out the table itself.
    chatApi
      .getModelVersions()
      .then(r => setModelVersions(r.data))
      .catch(() => setModelVersions([]));
  }, []);

  function applyFilters() {
    setAppliedFilters({
      minDate: draftFromDate || null,
      maxDate: draftToDate || null,
      modelVersionId: draftModelVersionId,
    });
  }

  function resetFilters() {
    setDraftFromDate(MODEL_COVERAGE_MIN_DATE);
    setDraftToDate(ABSOLUTE_MAX_DATE);
    setDraftModelVersionId(null);
    setAppliedFilters({ minDate: MODEL_COVERAGE_MIN_DATE, maxDate: ABSOLUTE_MAX_DATE });
  }

  function renderTooltipToggle(key: string) {
    return (
      <TouchableOpacity
        testID={`model-accuracy-tooltip-toggle-${key}`}
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
      <Text testID={`model-accuracy-tooltip-text-${key}`} style={styles.tooltipText}>
        {COLUMN_TOOLTIPS[key]}
      </Text>
    );
  }

  function renderHeaderCell(label: string, colStyle: object) {
    return (
      <View key={label} style={[styles.tableHeaderMetricCell, colStyle]}>
        {/* flexShrink + minWidth:0 are load-bearing: without them a long label
            like "Actually won" refuses to wrap, overflows its flex:1 cell and
            shunts the next column's header (and its ? toggle) sideways, so the
            header stops lining up with the body rows underneath. */}
        <Text style={[styles.tableHeaderCell, styles.tableHeaderCellText]} numberOfLines={2}>
          {label}
        </Text>
        {renderTooltipToggle(label)}
      </View>
    );
  }

  function renderRow(band: ModelAccuracyBand, isOverall: boolean) {
    const has = band.runners > 0;
    const testID = isOverall ? "model-accuracy-overall-row" : `model-accuracy-band-${band.bandKey}`;

    if (!isTablet) {
      // Narrow layout: no aligned columns, each band becomes a stacked card —
      // same fork as ModelPerformanceDashboard's table (:461-474).
      return (
        <View key={band.bandKey} testID={testID} style={[styles.tableRow, styles.tableRowNarrow, isOverall && styles.overallRow]}>
          <Text style={styles.narrowTitle}>{band.label}</Text>
          <Text style={styles.narrowSub}>
            {band.runners} runners · {band.wins} won
          </Text>
          <Text style={styles.narrowMetrics}>
            Model {formatPct(band.modelMeanProb, has)} · Actually {formatPct(band.actualWinRate, has)} · Market{" "}
            {formatPct(band.marketMeanProbFair, has)} · Break-even {formatPct(band.marketMeanProbRaw, has)}
          </Text>
          <Text style={styles.narrowMetrics}>
            Model error {formatPp(band.modelErrorPp, has)} · Market error {formatPp(band.marketErrorPp, has)}
          </Text>
          <Text style={[styles.narrowMetrics, { color: pnlColor(band.pnl) }]}>
            {formatPnl(band.pnl)} on {formatGbp(band.staked)} staked
            {has ? ` (${band.roiPercent.toFixed(1)}%)` : ""}
          </Text>
        </View>
      );
    }

    return (
      <View key={band.bandKey} testID={testID} style={[styles.tableRow, styles.tableRowWide, isOverall && styles.overallRow]}>
        <View style={styles.colBand}>
          <Text style={styles.bandLabel}>{band.label}</Text>
          {!isOverall && <Text style={styles.bandSubLabel}>{bandSubLabel(band)}</Text>}
        </View>
        <Text style={[styles.cell, styles.colNum]}>{band.runners}</Text>
        <Text style={[styles.cell, styles.colNum]}>{formatPct(band.modelMeanProb, has)}</Text>
        <Text style={[styles.cell, styles.colNum, styles.cellStrong]}>{formatPct(band.actualWinRate, has)}</Text>
        <Text style={[styles.cell, styles.colNum]}>{formatPct(band.marketMeanProbFair, has)}</Text>
        <Text style={[styles.cell, styles.colNum, styles.cellMuted]}>
          {formatPct(band.marketMeanProbRaw, has)}
        </Text>
        <Text style={[styles.cell, styles.colNum]}>{formatPp(band.modelErrorPp, has)}</Text>
        <Text style={[styles.cell, styles.colNum]}>{formatPp(band.marketErrorPp, has)}</Text>
        <Text style={[styles.cell, styles.colNum, { color: pnlColor(band.pnl) }]}>
          {has ? formatPnl(band.pnl) : "—"}
        </Text>
        <Text style={[styles.cell, styles.colNum, { color: pnlColor(band.pnl) }]}>
          {has ? `${band.roiPercent.toFixed(1)}%` : "—"}
        </Text>
      </View>
    );
  }

  const hasAnyRunners = bands.some(b => b.runners > 0);

  return (
    <SafeAreaView testID="model-accuracy-screen" style={styles.screen}>
      <AppHeader
        navigate={navigate}
        isAuthenticated={isAuthenticated}
        onLogout={onLogout}
        onBack={onBack}
        subtitle="Model Accuracy"
        testIdPrefix="model-accuracy"
      />

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <PageContainer maxWidth={1100}>
          <Text style={styles.intro}>
            Every runner grouped by the price the model itself makes it. Read each row across: if
            "Actually won" is well below "Model says", the model over-rates that price. Whichever of
            the two error columns is closer to zero was nearer the truth.
          </Text>

          {/* The stored probabilities come from a model that was refit on 100%
              of the data, including these very races (ml/train_and_predict.py
              :420-437), so it already knew every result it scored. Saying so
              here is the difference between an honest instrument and a
              flattering one. */}
          <Surface testID="model-accuracy-insample-warning" style={styles.warningCard} elevation={0}>
            <Text style={styles.warningText}>
              These figures flatter the model. Each race was scored by a model trained on that same
              race's result, so the real strike rates would be lower — most at short prices. Treat
              this as a shape check, not a forward test.
            </Text>
          </Surface>

          <Surface style={styles.panelCard} elevation={1}>
            <Text style={styles.cardTitle}>Filters</Text>
            <DateRangePicker
              testID="model-accuracy-date-range"
              fromDate={draftFromDate}
              toDate={draftToDate}
              minDate={MODEL_COVERAGE_MIN_DATE}
              maxDate={ABSOLUTE_MAX_DATE}
              onChange={(from, to) => {
                setDraftFromDate(from);
                setDraftToDate(to);
              }}
            />
            {modelVersions.length > 0 && (
              <View testID="model-accuracy-model-version-row" style={styles.chipRow}>
                <Text style={styles.filterLabel}>Model version</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipScroll}>
                  {modelVersions.map(v => (
                    <Chip
                      key={v.id}
                      testID={`model-accuracy-model-version-${v.id}`}
                      mode={draftModelVersionId === v.id ? "flat" : "outlined"}
                      selected={draftModelVersionId === v.id}
                      onPress={() => setDraftModelVersionId(draftModelVersionId === v.id ? null : v.id)}
                      style={styles.chip}
                    >
                      {v.id}
                    </Chip>
                  ))}
                </ScrollView>
              </View>
            )}
            <View style={styles.filterActionsRow}>
              <Button testID="model-accuracy-reset" mode="text" onPress={resetFilters} style={styles.button}>
                Reset
              </Button>
              <Button
                testID="model-accuracy-apply"
                mode="contained"
                buttonColor={colors.accent}
                onPress={applyFilters}
                style={styles.button}
              >
                Apply
              </Button>
            </View>
          </Surface>

          {loading && (
            <View testID="model-accuracy-loading" style={styles.centered}>
              <ActivityIndicator size="large" animating color={colors.primary} />
              <Text style={styles.loadingText}>Loading model accuracy…</Text>
            </View>
          )}

          {!loading && error && (
            <View testID="model-accuracy-error" style={styles.centered}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {!loading && !error && !hasAnyRunners && (
            <View testID="model-accuracy-empty" style={styles.centered}>
              <Text style={styles.emptyText}>
                No scored runners match these filters. The model only scores races the training
                pipeline has run over — try widening the date range.
              </Text>
            </View>
          )}

          {!loading && !error && hasAnyRunners && (
            <View testID="model-accuracy-table" style={styles.tableContainer}>
              {isTablet && (
                <View style={styles.tableHeaderRow}>
                  <View style={styles.colBand}>
                    <Text style={styles.tableHeaderCell}>Model price</Text>
                  </View>
                  {renderHeaderCell("Runners", styles.colNum)}
                  {renderHeaderCell("Model says", styles.colNum)}
                  {renderHeaderCell("Actually won", styles.colNum)}
                  {renderHeaderCell("Market said", styles.colNum)}
                  {renderHeaderCell("Break-even", styles.colNum)}
                  {renderHeaderCell("Model error", styles.colNum)}
                  {renderHeaderCell("Market error", styles.colNum)}
                  {renderHeaderCell("P&L", styles.colNum)}
                  {renderHeaderCell("ROI", styles.colNum)}
                </View>
              )}
              {/* Hoisted out of the header row so an open tooltip can't
                  stretch a column and break the alignment. Only the table's
                  own columns — "Brier" is rendered by its own card below, and
                  including it here would emit the same testID twice. */}
              <View style={styles.tableHeaderTooltipRow}>
                {TABLE_COLUMN_KEYS.map(key => (
                  <React.Fragment key={key}>{renderTooltipText(key)}</React.Fragment>
                ))}
              </View>

              {bands.map(band => renderRow(band, false))}
              {overall && renderRow(overall, true)}

              {overall && overall.runners > 0 && (
                <Surface testID="model-accuracy-brier" style={styles.brierCard} elevation={1}>
                  <View style={styles.brierHeaderRow}>
                    <Text style={styles.cardTitle}>Model vs market, overall</Text>
                    {renderTooltipToggle("Brier")}
                  </View>
                  {renderTooltipText("Brier")}
                  <Text style={styles.brierText}>
                    Model Brier {overall.modelBrier.toFixed(4)} · Market Brier{" "}
                    {overall.marketBrier.toFixed(4)}
                  </Text>
                  <Text style={styles.brierVerdict}>
                    {overall.modelBrier < overall.marketBrier
                      ? "The model was more accurate than the market over these runners."
                      : overall.modelBrier > overall.marketBrier
                        ? "The market was more accurate than the model over these runners."
                        : "The model and the market were equally accurate over these runners."}
                  </Text>
                </Surface>
              )}
            </View>
          )}
        </PageContainer>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: spacing.xxl },
  intro: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  warningCard: {
    backgroundColor: colors.infoLight,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  warningText: { fontSize: 12, lineHeight: 17, color: colors.text },
  panelCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  cardTitle: { fontSize: 14, fontWeight: "700", color: colors.text },
  filterLabel: { fontSize: 12, fontWeight: "600", color: colors.textSecondary },
  chipRow: { gap: spacing.xs },
  chipScroll: { gap: spacing.xs, paddingVertical: spacing.xs },
  chip: { marginRight: spacing.xs },
  filterActionsRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  button: { borderRadius: radii.button },
  centered: { alignItems: "center", paddingVertical: spacing.xxl, gap: spacing.sm },
  loadingText: { fontSize: 13, color: colors.textSecondary },
  errorText: { fontSize: 13, color: colors.danger, textAlign: "center" },
  emptyText: { fontSize: 13, color: colors.textSecondary, textAlign: "center", maxWidth: 420 },
  tableContainer: { gap: spacing.sm },
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
    alignItems: "flex-end",
    justifyContent: "flex-end",
    gap: 4,
    minWidth: 0,
  },
  tableHeaderCellText: {
    flexShrink: 1,
    minWidth: 0,
    textAlign: "right",
  },
  tableHeaderTooltipRow: { paddingHorizontal: spacing.md },
  // The same col styles are applied to header cells and body cells — that is
  // what keeps the columns aligned.
  colBand: { flex: 2 },
  colNum: { flex: 1, textAlign: "right" },
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
  tableRowNarrow: { padding: spacing.md, gap: 2 },
  overallRow: { borderColor: colors.primary, borderWidth: 2 },
  bandLabel: { fontSize: 13, fontWeight: "700", color: colors.text },
  bandSubLabel: { fontSize: 11, color: colors.textTertiary },
  cell: { fontSize: 13, color: colors.text },
  cellStrong: { fontWeight: "700" },
  // The break-even column is reference information, not a headline figure —
  // muted so it doesn't compete with the model/market comparison beside it.
  cellMuted: { color: colors.textTertiary },
  narrowTitle: { fontSize: 14, fontWeight: "700", color: colors.text },
  narrowSub: { fontSize: 12, color: colors.textSecondary },
  narrowMetrics: { fontSize: 12, color: colors.textSecondary },
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
    maxWidth: 320,
    fontSize: 11,
    lineHeight: 15,
    color: "#fff",
    backgroundColor: colors.text,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.sm,
  },
  brierCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.md,
    marginTop: spacing.md,
    gap: spacing.xs,
  },
  brierHeaderRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  brierText: { fontSize: 13, color: colors.text },
  brierVerdict: { fontSize: 12, color: colors.textSecondary },
});
