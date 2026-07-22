import React from "react";
import { View, StyleSheet, ScrollView } from "react-native";
import { Text, Button, Surface, Divider, ActivityIndicator } from "react-native-paper";
import Svg, { Path, Line as SvgLine } from "react-native-svg";
import { RunnerConvergencePoint } from "../services/chatApi";
import { colors, radii, spacing } from "../theme";

interface RunnerConvergencePanelProps {
  points: RunnerConvergencePoint[];
  loading: boolean;
  error: string | null;
  onClose: () => void;
}

const CHART_WIDTH = 1000;
const CHART_HEIGHT = 320;
const CHART_PADDING = 24;

// Requested live: a chart showing how the running ROI% is wildly volatile
// over a small sample of runners and settles down as more are included, up
// to the upper limit of Split B — one point per qualifying runner, no
// bucketing, so the early volatility reads clearly rather than being
// smoothed away.
export const RunnerConvergencePanel: React.FC<RunnerConvergencePanelProps> = ({ points, loading, error, onClose }) => {
  const upperLimit = points.length > 0 ? points[points.length - 1].runnerOrdinal : 0;
  const finalRoi = points.length > 0 ? points[points.length - 1].roiPercent : null;

  let pathD = "";
  let zeroLineY: number | null = null;
  if (points.length > 1) {
    const roiValues = points.map(p => p.roiPercent);
    const minRoi = Math.min(...roiValues);
    const maxRoi = Math.max(...roiValues);
    // Guards against a perfectly flat series (minRoi === maxRoi) collapsing
    // the Y scale to a divide-by-zero.
    const roiRange = maxRoi - minRoi || 1;
    const plotWidth = CHART_WIDTH - CHART_PADDING * 2;
    const plotHeight = CHART_HEIGHT - CHART_PADDING * 2;

    const xFor = (i: number) => CHART_PADDING + (i / (points.length - 1)) * plotWidth;
    const yFor = (roi: number) => CHART_PADDING + plotHeight - ((roi - minRoi) / roiRange) * plotHeight;

    pathD = points
      .map((p, i) => `${i === 0 ? "M" : "L"} ${xFor(i).toFixed(2)} ${yFor(p.roiPercent).toFixed(2)}`)
      .join(" ");

    if (minRoi <= 0 && maxRoi >= 0) {
      zeroLineY = yFor(0);
    }
  }

  return (
    <Surface testID="runner-convergence-panel" style={styles.panel} elevation={3}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text variant="titleMedium" style={styles.title}>
            P&L Convergence
          </Text>
          {upperLimit > 0 && (
            <Text variant="bodySmall" style={styles.subtitle}>
              Runners 1–{upperLimit}
            </Text>
          )}
        </View>
        <Button
          testID="runner-convergence-panel-close"
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

      <ScrollView contentContainerStyle={styles.body}>
        {loading ? (
          <View testID="runner-convergence-loading" style={styles.centerRow}>
            <ActivityIndicator size="small" color={colors.accent} />
            <Text style={styles.stateText}>Loading convergence data…</Text>
          </View>
        ) : error ? (
          <Text testID="runner-convergence-error" style={styles.errorText}>
            {error}
          </Text>
        ) : points.length === 0 ? (
          <Text testID="runner-convergence-empty" style={styles.stateText}>
            No qualifying runners in this range.
          </Text>
        ) : (
          <>
            {finalRoi != null && (
              <Text
                testID="runner-convergence-final-roi"
                style={[styles.finalRoi, finalRoi >= 0 ? styles.pnlPos : styles.pnlNeg]}
              >
                Converges to {finalRoi >= 0 ? "+" : ""}
                {finalRoi.toFixed(1)}% after {upperLimit} runners
              </Text>
            )}
            <View testID="runner-convergence-chart" style={styles.chartContainer}>
              <Svg width="100%" height={CHART_HEIGHT} viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}>
                {zeroLineY != null && (
                  <SvgLine
                    x1={CHART_PADDING}
                    y1={zeroLineY}
                    x2={CHART_WIDTH - CHART_PADDING}
                    y2={zeroLineY}
                    stroke={colors.textTertiary}
                    strokeDasharray="4,4"
                    strokeWidth={1}
                  />
                )}
                <Path d={pathD} stroke={colors.accent} strokeWidth={2} fill="none" />
              </Svg>
            </View>
            <Text style={styles.axisCaption}>X axis: runner count (1–{upperLimit}) · Y axis: cumulative ROI%</Text>
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
    borderRadius: radii.sm,
  },
  closeButtonLabel: {
    fontSize: 11,
    fontWeight: "600",
  },
  body: {
    padding: spacing.lg,
    gap: spacing.md,
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
  },
  axisCaption: {
    fontSize: 11,
    color: colors.textTertiary,
    textAlign: "center",
  },
  pnlPos: {
    color: colors.pnlPositive,
  },
  pnlNeg: {
    color: colors.pnlNegative,
  },
});
