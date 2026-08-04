import React from "react";
import { View, StyleSheet } from "react-native";
import { Text } from "react-native-paper";
import { BrierStats } from "../services/chatApi";
import { colors, radii, spacing } from "../theme";
import {
  brierEdge,
  brierVerdict,
  formatBrier,
  formatBrierEdge,
  hasModelBrier,
  isSmallBrierSample,
} from "../utils/brierFormat";

/**
 * The Brier score, rendered identically everywhere horses can be filtered.
 *
 * One component (in two densities) rather than per-screen markup, because the
 * whole value of putting this number on six different screens is that a user
 * can compare what they see on one against what they see on another. A score
 * formatted to 4dp on the Filters screen and 3dp on a saved result would quietly
 * defeat that.
 *
 * Both densities always show model AND market. The model's score in isolation
 * says almost nothing (0.08 is excellent over a big field and poor over a small
 * one); the gap between the two is the number worth reading, so it is never
 * possible to see one without the other.
 */

interface BrierScoreProps {
  brier: BrierStats | null | undefined;
  /**
   * `inline` — one dense line, for a card that has room for a headline and
   * little else (the Split A/B cards, a saved-result row).
   * `rows` — label/value rows, for a detail panel that is already a list of
   * them.
   */
  variant?: "inline" | "rows";
  /** `dark` for the navy split cards, `light` for white surfaces. */
  tone?: "light" | "dark";
  testID: string;
  /** Overrides the "Brier" label — e.g. "Brier (live)" on captured results. */
  label?: string;
}

export const BrierScore: React.FC<BrierScoreProps> = ({
  brier,
  variant = "inline",
  tone = "light",
  testID,
  label = "Brier",
}) => {
  const dark = tone === "dark";
  const edge = brierEdge(brier);
  const verdict = brierVerdict(brier);
  const small = isSmallBrierSample(brier);

  // The market's own score survives on the Betfair-SP screen, which has no
  // model column at all — so "nothing to show" means neither score exists,
  // not merely that the model one is missing.
  if (!hasModelBrier(brier) && brier?.market == null) {
    return (
      <View testID={`${testID}-empty`} style={variant === "rows" ? styles.row : styles.inlineWrap}>
        <Text style={[styles.label, dark && styles.labelDark]}>{label}</Text>
        <Text
          accessibilityLabel={verdict}
          style={[styles.muted, dark && styles.mutedDark]}
        >
          —
        </Text>
      </View>
    );
  }

  // colors.pnlPositive/pnlNegative are the light pair the navy split cards
  // use; at ~2.4:1 against white they fail contrast on a light surface, so the
  // light tone gets the darker success/danger pair instead. Same meaning, same
  // hue family, readable on both.
  const edgeStyle =
    edge == null
      ? dark
        ? styles.mutedDark
        : styles.muted
      : edge >= 0
        ? dark
          ? styles.betterDark
          : styles.better
        : dark
          ? styles.worseDark
          : styles.worse;

  if (variant === "rows") {
    return (
      <View testID={testID} style={styles.rowsGroup} accessibilityLabel={verdict}>
        <View testID={`${testID}-model`} style={styles.row}>
          <Text style={[styles.label, dark && styles.labelDark]}>{label} — model</Text>
          <Text style={[styles.value, dark && styles.valueDark]}>{formatBrier(brier?.model)}</Text>
        </View>
        <View testID={`${testID}-market`} style={styles.row}>
          <Text style={[styles.label, dark && styles.labelDark]}>{label} — SP</Text>
          <Text style={[styles.value, dark && styles.valueDark]}>{formatBrier(brier?.market)}</Text>
        </View>
        <View testID={`${testID}-edge`} style={styles.row}>
          <Text style={[styles.label, dark && styles.labelDark]}>Model vs SP</Text>
          <Text style={[styles.value, edgeStyle]}>{formatBrierEdge(edge)}</Text>
        </View>
        <Text testID={`${testID}-caption`} style={[styles.caption, dark && styles.captionDark]}>
          {captionFor(brier, small)}
        </Text>
      </View>
    );
  }

  return (
    <View testID={testID} style={styles.inlineWrap} accessibilityLabel={verdict}>
      <Text style={[styles.inlineText, dark && styles.inlineTextDark]} numberOfLines={1}>
        <Text style={[styles.label, dark && styles.labelDark]}>{label} </Text>
        <Text style={[styles.value, dark && styles.valueDark]}>{formatBrier(brier?.model)}</Text>
        <Text style={[styles.label, dark && styles.labelDark]}> · SP </Text>
        <Text style={[styles.value, dark && styles.valueDark]}>{formatBrier(brier?.market)}</Text>
        {edge != null && (
          <>
            <Text style={[styles.label, dark && styles.labelDark]}> </Text>
            <Text testID={`${testID}-edge`} style={[styles.value, edgeStyle]}>
              ({formatBrierEdge(edge)})
            </Text>
          </>
        )}
      </Text>
      {small && (
        <View testID={`${testID}-small-sample`} style={styles.smallSamplePill}>
          <Text style={styles.smallSampleText}>{brier?.scored} runners</Text>
        </View>
      )}
    </View>
  );
};

function captionFor(brier: BrierStats | null | undefined, small: boolean): string {
  const scored = brier?.scored ?? 0;
  if (!hasModelBrier(brier)) {
    // The Betfair-SP screen, or a filter that matched only pre-ML runners.
    return `SP-implied probabilities only — no model score for these ${brier?.priced ?? 0} runners.`;
  }
  const base = `Lower is better. Scored over ${scored} runner${scored === 1 ? "" : "s"} the model rated.`;
  return small ? `${base} Too few to read as a result.` : base;
}

const styles = StyleSheet.create({
  rowsGroup: {
    gap: spacing.md,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  inlineWrap: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  inlineText: {
    fontSize: 12,
  },
  inlineTextDark: {
    color: "rgba(255,255,255,0.85)",
  },
  label: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  labelDark: {
    color: "rgba(255,255,255,0.7)",
  },
  value: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.text,
  },
  valueDark: {
    color: "#FFFFFF",
  },
  muted: {
    fontSize: 14,
    color: colors.textTertiary,
  },
  mutedDark: {
    color: "rgba(255,255,255,0.5)",
  },
  // Green when the model's squared error is SMALLER than the market's, which
  // is what "better" means for a Brier score — the same green the P&L figures
  // use, so the colour keeps meaning "good news" across a card.
  better: {
    color: colors.success,
  },
  worse: {
    color: colors.danger,
  },
  betterDark: {
    color: colors.pnlPositive,
  },
  worseDark: {
    color: colors.pnlNegative,
  },
  caption: {
    fontSize: 11,
    color: colors.textTertiary,
  },
  captionDark: {
    color: "rgba(255,255,255,0.55)",
  },
  smallSamplePill: {
    backgroundColor: "rgba(217,119,6,0.15)",
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
  },
  smallSampleText: {
    fontSize: 10,
    fontWeight: "600",
    color: colors.warning,
  },
});
