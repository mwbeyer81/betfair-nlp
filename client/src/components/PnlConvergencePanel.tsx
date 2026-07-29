import React, { useMemo, useRef, useState } from "react";
import { View, StyleSheet, ScrollView, GestureResponderEvent, TextInput as RNTextInput } from "react-native";
import { Text, Button, Surface, Divider, ActivityIndicator } from "react-native-paper";
import Svg, { Path, Line as SvgLine, Circle } from "react-native-svg";
import { RaceConvergencePoint } from "../services/chatApi";
import { colors, radii, spacing } from "../theme";
import { formatPnl, formatPct } from "../utils/ispFormat";

interface PnlConvergencePanelProps {
  points: RaceConvergencePoint[];
  loading: boolean;
  error: string | null;
  // Non-default filters (date range, courses, going, model thresholds, ...)
  // that narrowed this specific result — captured by the caller at the
  // moment the graph was opened. Empty means the full, unfiltered default
  // range was used.
  filters: { key: string; label: string }[];
  onClose: () => void;
}

const CHART_WIDTH = 1000;
const CHART_HEIGHT = 320;
const CHART_PADDING = 24;
// How many leading points to exclude when computing the Y-axis scale.
// Reported live: a single lucky/unlucky early result (e.g. a 12/1 winner
// as literally the very first race) can swing ROI% into the hundreds or
// thousands of percent on a near-zero cumulative stake — mathematically
// correct, but it stretches the axis so much that the actual "converging"
// detail for the rest of the series becomes an invisible flat sliver.
// Points before the warm-up still draw on the line (they can go off the
// top/bottom of the visible chart), just don't influence how the axis is
// scaled — the point of this graph is to show the converged/converging
// behavior, not to let one early swing hide it. Kept small relative to the
// runner-ordinal version's constant (50) — a split's race count is
// typically far smaller than its runner count, and a fixed 50 could eat a
// large fraction (or all) of a small split's own points.
const SCALE_WARMUP_POINTS = 10;

// Requested live: a chart showing how the running ROI% is wildly volatile
// over a small sample of races and settles down as more are included — one
// point per race, no bucketing, so the early volatility reads clearly
// rather than being smoothed away. Each split's own Graph button passes
// that split's own race range (e.g. Split B's 501-1000), so
// firstRowNumber/lastRowNumber below show the same numbers that split's own
// card does — not always starting at 1 (see loadConvergence in
// IndustrySpScreen.tsx).
export const PnlConvergencePanel: React.FC<PnlConvergencePanelProps> = ({ points, loading, error, filters, onClose }) => {
  const firstRowNumber = points.length > 0 ? points[0].raceRowNumber : 0;
  const lastRowNumber = points.length > 0 ? points[points.length - 1].raceRowNumber : 0;
  const finalRoi = points.length > 0 ? points[points.length - 1].roiPercent : null;

  // Rendered on-screen width of the chart, in pixels — the Svg itself is
  // drawn in a fixed CHART_WIDTH viewBox regardless of screen size, so a
  // touch's pixel position needs this to convert into viewBox space. Kept
  // in state (from onLayout) purely to position the tooltip box; the touch
  // handler itself re-measures synchronously via chartRef (see handleTouch)
  // rather than trusting this alone, since onLayout can still be pending
  // on the very first tap right after mount.
  const [chartWidth, setChartWidth] = useState(0);
  const chartRef = useRef<View>(null);
  // Index into `points` of the tap/drag-selected point — null until the
  // user has touched the chart at least once.
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  // Requested live: dragging a finger along the chart to land on one exact
  // race is imprecise, especially for a wide range on a small screen — an
  // explicit "jump to race" input lets the user type the race row number
  // they actually want and land on it directly. Sets the exact same
  // selectedIndex a tap/drag would, so the marker/guide-line/tooltip that
  // follow are unchanged — this is just an alternate, precise way to choose
  // the index, not a separate display path.
  const [jumpInput, setJumpInput] = useState("");

  const chart = useMemo(() => {
    if (points.length < 2) return null;

    const scalePoints = points.length > SCALE_WARMUP_POINTS ? points.slice(SCALE_WARMUP_POINTS) : points;
    const roiValues = scalePoints.map(p => p.roiPercent);
    const minRoi = Math.min(...roiValues);
    const maxRoi = Math.max(...roiValues);
    // Guards against a perfectly flat series (minRoi === maxRoi) collapsing
    // the Y scale to a divide-by-zero.
    const roiRange = maxRoi - minRoi || 1;
    const plotWidth = CHART_WIDTH - CHART_PADDING * 2;
    const plotHeight = CHART_HEIGHT - CHART_PADDING * 2;

    const xFor = (i: number) => CHART_PADDING + (i / (points.length - 1)) * plotWidth;
    const yFor = (roi: number) => CHART_PADDING + plotHeight - ((roi - minRoi) / roiRange) * plotHeight;

    const pathD = points
      .map((p, i) => `${i === 0 ? "M" : "L"} ${xFor(i).toFixed(2)} ${yFor(p.roiPercent).toFixed(2)}`)
      .join(" ");

    const zeroLineY = minRoi <= 0 && maxRoi >= 0 ? yFor(0) : null;

    // True when the warm-up window actually excluded at least one point AND
    // that exclusion changed the scale (i.e. an early point really was more
    // extreme than anything after the warm-up) — used to caption the chart
    // so it's clear the line may run off-screen briefly rather than looking
    // like a rendering glitch.
    const earlyPointsClipped = points
      .slice(0, points.length - scalePoints.length)
      .some(p => p.roiPercent < minRoi || p.roiPercent > maxRoi);

    return { pathD, zeroLineY, earlyPointsClipped, xFor, yFor, plotWidth };
  }, [points]);

  // Converts a touch's on-screen X position into the nearest point's
  // index, then snaps the marker/tooltip to it — tap or drag anywhere on
  // the chart to inspect the exact race count and P&L at that spot on the
  // line.
  function handleTouch(e: GestureResponderEvent) {
    if (!chart) return;
    // Measured directly off the DOM node rather than trusting `chartWidth`
    // alone — on web, a View's ref *is* its DOM node, so this works even
    // if onLayout's own measurement hasn't landed yet (a real race on the
    // very first tap right after the panel mounts).
    const node = chartRef.current as unknown as { getBoundingClientRect?: () => { width: number } } | null;
    const width = node?.getBoundingClientRect?.().width || chartWidth;
    if (!width) return;
    if (width !== chartWidth) setChartWidth(width);
    const touchXInViewBox = (e.nativeEvent.locationX / width) * CHART_WIDTH;
    const fraction = (touchXInViewBox - CHART_PADDING) / chart.plotWidth;
    const idx = Math.round(fraction * (points.length - 1));
    setSelectedIndex(Math.max(0, Math.min(points.length - 1, idx)));
  }

  // Snaps to whichever point's raceRowNumber is closest to the typed
  // target — same "snap to nearest" behavior as a tap, just driven by a
  // number instead of a screen position. A target outside the split's own
  // range (below firstRowNumber or above lastRowNumber) still resolves
  // sensibly: closest is simply the first or last point.
  function jumpToRace() {
    const target = parseInt(jumpInput, 10);
    if (!Number.isFinite(target) || points.length === 0) return;
    let closestIndex = 0;
    let closestDiff = Infinity;
    for (let i = 0; i < points.length; i++) {
      const diff = Math.abs(points[i].raceRowNumber - target);
      if (diff < closestDiff) {
        closestDiff = diff;
        closestIndex = i;
      }
    }
    setSelectedIndex(closestIndex);
  }

  const selectedPoint = selectedIndex != null ? points[selectedIndex] : null;
  // Clamped so the tooltip box doesn't run off either edge of the chart —
  // TOOLTIP_WIDTH is an estimate (exact measured width isn't worth the
  // extra render round-trip this would need).
  const TOOLTIP_WIDTH = 150;
  const tooltipLeft =
    selectedIndex != null && chart && chartWidth > 0
      ? Math.max(0, Math.min(chartWidth - TOOLTIP_WIDTH, (chart.xFor(selectedIndex) / CHART_WIDTH) * chartWidth - TOOLTIP_WIDTH / 2))
      : 0;

  return (
    <Surface testID="pnl-convergence-panel" style={styles.panel} elevation={3}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text variant="titleMedium" style={styles.title}>
            P&L Convergence
          </Text>
          {lastRowNumber > 0 && (
            <Text testID="pnl-convergence-range-subtitle" variant="bodySmall" style={styles.subtitle}>
              Races {firstRowNumber}–{lastRowNumber}
            </Text>
          )}
        </View>
        <Button
          testID="pnl-convergence-panel-close"
          mode="contained"
          compact
          buttonColor={colors.accent}
          onPress={onClose}
          style={styles.closeButton}
          labelStyle={styles.closeButtonLabel}
        >
          ← Filters
        </Button>
      </View>

      <Divider />

      {filters.length > 0 ? (
        <View testID="pnl-convergence-filters-summary" style={styles.filtersRow}>
          {filters.map(f => (
            <View key={f.key} testID={`pnl-convergence-filter-chip-${f.key}`} style={styles.filterChip}>
              <Text style={styles.filterChipText}>{f.label}</Text>
            </View>
          ))}
        </View>
      ) : (
        <Text testID="pnl-convergence-no-filters" style={styles.noFiltersText}>
          No filters applied — full default range
        </Text>
      )}

      <ScrollView contentContainerStyle={styles.body}>
        {loading ? (
          <View testID="pnl-convergence-loading" style={styles.centerRow}>
            <ActivityIndicator size="small" color={colors.accent} />
            <Text style={styles.stateText}>Loading convergence data…</Text>
          </View>
        ) : error ? (
          <Text testID="pnl-convergence-error" style={styles.errorText}>
            {error}
          </Text>
        ) : points.length === 0 ? (
          <Text testID="pnl-convergence-empty" style={styles.stateText}>
            No qualifying races in this range.
          </Text>
        ) : (
          <>
            {finalRoi != null && (
              <Text
                testID="pnl-convergence-final-roi"
                style={[styles.finalRoi, finalRoi >= 0 ? styles.pnlPos : styles.pnlNeg]}
              >
                Converges to {finalRoi >= 0 ? "+" : ""}
                {finalRoi.toFixed(1)}% after {points.length} races
              </Text>
            )}
            <View style={styles.jumpRow}>
              <Text style={styles.jumpLabel}>Jump to race</Text>
              <RNTextInput
                testID="pnl-convergence-jump-input"
                style={styles.jumpInput}
                value={jumpInput}
                onChangeText={setJumpInput}
                onSubmitEditing={jumpToRace}
                keyboardType="numeric"
                maxLength={7}
                placeholder={`${firstRowNumber}-${lastRowNumber}`}
                placeholderTextColor={colors.textTertiary}
              />
              <Button
                testID="pnl-convergence-jump-button"
                mode="contained"
                compact
                buttonColor={colors.accent}
                onPress={jumpToRace}
                disabled={jumpInput.trim() === ""}
                style={styles.jumpButton}
                labelStyle={styles.jumpButtonLabel}
              >
                Go
              </Button>
            </View>
            <View
              ref={chartRef}
              testID="pnl-convergence-chart"
              style={styles.chartContainer}
              onLayout={e => setChartWidth(e.nativeEvent.layout.width)}
              onStartShouldSetResponder={() => true}
              onMoveShouldSetResponder={() => true}
              onResponderGrant={handleTouch}
              onResponderMove={handleTouch}
            >
              <Svg width="100%" height={CHART_HEIGHT} viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}>
                {chart?.zeroLineY != null && (
                  <SvgLine
                    x1={CHART_PADDING}
                    y1={chart.zeroLineY}
                    x2={CHART_WIDTH - CHART_PADDING}
                    y2={chart.zeroLineY}
                    stroke={colors.textTertiary}
                    strokeDasharray="4,4"
                    strokeWidth={1}
                  />
                )}
                <Path d={chart?.pathD ?? ""} stroke={colors.accent} strokeWidth={2} fill="none" />
                {selectedPoint != null && selectedIndex != null && chart && (
                  <>
                    <SvgLine
                      testID="pnl-convergence-snap-guide"
                      x1={chart.xFor(selectedIndex)}
                      y1={CHART_PADDING}
                      x2={chart.xFor(selectedIndex)}
                      y2={CHART_HEIGHT - CHART_PADDING}
                      stroke={colors.textTertiary}
                      strokeDasharray="2,3"
                      strokeWidth={1}
                    />
                    <Circle
                      testID="pnl-convergence-snap-dot"
                      cx={chart.xFor(selectedIndex)}
                      cy={chart.yFor(selectedPoint.roiPercent)}
                      r={9}
                      fill={colors.accent}
                      stroke="white"
                      strokeWidth={3}
                    />
                  </>
                )}
              </Svg>
              {selectedPoint != null && selectedIndex != null && (
                <View testID="pnl-convergence-tooltip" style={[styles.tooltip, { left: tooltipLeft, width: TOOLTIP_WIDTH }]}>
                  <Text style={styles.tooltipRace}>Race {selectedPoint.raceRowNumber}</Text>
                  {/* The headline reads "after N races" (a count local to
                      this split), while the row number above is the TRUE
                      global race row (can be much larger, e.g. 1876, for a
                      split that doesn't start at 1 — see the file-level
                      comment on firstRowNumber). Juxtaposed with no context,
                      that reads as a bug rather than two intentionally
                      different numbers. This line ties them together
                      explicitly. */}
                  <Text testID="pnl-convergence-tooltip-position" style={styles.tooltipPosition}>
                    {selectedIndex + 1} of {points.length} in this split
                  </Text>
                  <Text
                    testID="pnl-convergence-tooltip-pnl"
                    style={[styles.tooltipPnl, selectedPoint.cumulativePnl >= 0 ? styles.pnlPos : styles.pnlNeg]}
                  >
                    {formatPnl(selectedPoint.cumulativePnl)}{" "}
                    {formatPct(selectedPoint.cumulativePnl, selectedPoint.cumulativeStaked)}
                  </Text>
                </View>
              )}
            </View>
            <Text style={styles.axisCaption}>
              X axis: races {firstRowNumber}–{lastRowNumber} · Y axis: cumulative ROI%
            </Text>
            {chart?.earlyPointsClipped && (
              <Text testID="pnl-convergence-clip-note" style={styles.axisCaption}>
                An early result swung far outside this range — the line may run off-screen briefly near the start.
              </Text>
            )}
            <Text style={styles.tapHint}>Tap or drag on the chart to inspect a race.</Text>
          </>
        )}
      </ScrollView>
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
  },
  closeButton: {
    borderRadius: radii.button,
  },
  closeButtonLabel: {
    fontSize: 11,
    fontWeight: "600",
  },
  body: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  filtersRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  filterChip: {
    backgroundColor: colors.primaryLight,
    borderRadius: radii.sm,
    paddingVertical: spacing.xs / 2,
    paddingHorizontal: spacing.sm,
  },
  filterChipText: {
    fontSize: 11,
    color: colors.primary,
    fontWeight: "600",
  },
  noFiltersText: {
    fontSize: 11,
    color: colors.textTertiary,
    textAlign: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    fontStyle: "italic",
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
  finalRoi: {
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center",
  },
  chartContainer: {
    width: "100%",
    position: "relative",
  },
  jumpRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    justifyContent: "center",
  },
  jumpLabel: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  jumpInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    fontSize: 13,
    color: colors.text,
    width: 90,
    textAlign: "center",
  },
  jumpButton: {
    borderRadius: radii.button,
  },
  jumpButtonLabel: {
    fontSize: 12,
    fontWeight: "600",
  },
  tooltip: {
    position: "absolute",
    top: spacing.xs,
    backgroundColor: colors.primary,
    borderRadius: radii.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    alignItems: "center",
  },
  tooltipRace: {
    fontSize: 11,
    color: "rgba(255,255,255,0.8)",
  },
  tooltipPosition: {
    fontSize: 9,
    color: "rgba(255,255,255,0.6)",
    textAlign: "center",
  },
  tooltipPnl: {
    fontSize: 13,
    fontWeight: "700",
  },
  axisCaption: {
    fontSize: 11,
    color: colors.textTertiary,
    textAlign: "center",
  },
  tapHint: {
    fontSize: 11,
    color: colors.textTertiary,
    textAlign: "center",
    fontStyle: "italic",
  },
  pnlPos: {
    color: colors.pnlPositive,
  },
  pnlNeg: {
    color: colors.pnlNegative,
  },
});
