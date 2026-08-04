import React from "react";
import { View, StyleSheet } from "react-native";
import { Text, Button, Surface, Divider } from "react-native-paper";
import { PnlStats, BrierStats } from "../services/chatApi";
import { colors, radii, spacing } from "../theme";
import { formatGbp, formatPnl, formatPct } from "../utils/ispFormat";
import { BrierScore } from "./BrierScore";

interface SplitDetailPanelProps {
  id: "a" | "b";
  label: string;
  fromRow: number;
  toRow: number;
  totalRaces: number;
  totalRunners: number;
  pnl: PnlStats;
  brier: BrierStats | undefined;
  onClose: () => void;
  onViewRaces: () => void;
}

// Full breakdown for one Race A/B split — pulled out to its own screen
// because cramming Races/Horses/Staked/Return/PnL into the split card
// itself wrapped awkwardly on narrow phones (the card only has room for a
// one-line headline). The card links here for the full numbers.
export const SplitDetailPanel: React.FC<SplitDetailPanelProps> = ({
  id,
  label,
  fromRow,
  toRow,
  totalRaces,
  totalRunners,
  pnl,
  brier,
  onClose,
  onViewRaces,
}) => {
  const pnlPositive = pnl.pnl >= 0;
  return (
    <Surface testID={`split-detail-panel-${id}`} style={styles.panel} elevation={3}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text variant="titleMedium" style={styles.title}>
            {label}
          </Text>
          <Text variant="bodySmall" style={styles.subtitle}>
            Races {fromRow}–{toRow}
          </Text>
        </View>
        <Button
          testID={`split-detail-panel-filters-${id}`}
          mode="contained"
          compact
          buttonColor={colors.accent}
          onPress={onClose}
          style={styles.filtersButton}
          labelStyle={styles.filtersButtonLabel}
        >
          ← Filters
        </Button>
      </View>

      <Divider />

      <View testID={`split-detail-body-${id}`} style={styles.body}>
        <View testID={`split-detail-row-races-${id}`} style={styles.row}>
          <Text style={styles.rowLabel}>Races</Text>
          <Text style={styles.rowValue}>{totalRaces}</Text>
        </View>
        <View testID={`split-detail-row-runners-${id}`} style={styles.row}>
          <Text style={styles.rowLabel}>Runners</Text>
          <Text style={styles.rowValue}>{totalRunners}</Text>
        </View>
        {pnl.count != null && (
          <View testID={`split-detail-row-horses-${id}`} style={styles.row}>
            <Text style={styles.rowLabel}>Horses backed</Text>
            <Text style={styles.rowValue}>{pnl.count}</Text>
          </View>
        )}
        <View testID={`split-detail-row-staked-${id}`} style={styles.row}>
          <Text style={styles.rowLabel}>Staked</Text>
          <Text style={styles.rowValue}>{formatGbp(pnl.staked)}</Text>
        </View>
        <View testID={`split-detail-row-return-${id}`} style={styles.row}>
          <Text style={styles.rowLabel}>Return</Text>
          <Text style={styles.rowValue}>{formatGbp(pnl.returns)}</Text>
        </View>

        <Divider style={styles.pnlDivider} />

        <View style={styles.row}>
          <Text style={styles.pnlLabel}>Profit / Loss</Text>
          <Text testID={`split-detail-pnl-${id}`} style={[styles.pnlValue, pnlPositive ? styles.pnlPos : styles.pnlNeg]}>
            {formatPnl(pnl.pnl)}{" "}
            <Text style={[styles.pnlPct, pnlPositive ? styles.pnlPos : styles.pnlNeg]}>
              ({formatPct(pnl.pnl, pnl.staked)})
            </Text>
          </Text>
        </View>

        <Divider style={styles.pnlDivider} />

        {/*
          Below the P&L, not above it: this panel is read top-down as
          "what did this split contain, and what did betting it return" —
          the calibration question comes after that, as the check on whether
          the return was skill or variance.
        */}
        <BrierScore brier={brier} variant="rows" testID={`split-detail-brier-${id}`} />
      </View>

      <Button
        testID={`split-detail-view-races-button-${id}`}
        mode="contained"
        onPress={onViewRaces}
        style={styles.viewRacesButton}
      >
        View {totalRaces} Races →
      </Button>
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
  subtitleMuted: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 11,
  },
  filtersButton: {
    borderRadius: radii.button,
  },
  filtersButtonLabel: {
    fontSize: 11,
    fontWeight: "600",
  },
  body: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  rowLabel: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  rowValue: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.text,
  },
  pnlDivider: {
    marginVertical: spacing.xs,
  },
  pnlLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.text,
  },
  pnlValue: {
    fontSize: 20,
    fontWeight: "700",
  },
  pnlPct: {
    fontSize: 15,
    fontWeight: "400",
    opacity: 0.8,
  },
  pnlPos: {
    color: colors.pnlPositive,
  },
  pnlNeg: {
    color: colors.pnlNegative,
  },
  viewRacesButton: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    borderRadius: radii.button,
  },
});
