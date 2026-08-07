import React from "react";
import { View, StyleSheet } from "react-native";
import { Text } from "react-native-paper";
import { FavPnlStats, PnlStats } from "../services/chatApi";
import { colors, radii, spacing } from "../theme";
import {
  StakeConvention,
  favBook,
  favEdgePts,
  favRoi,
  favVerdict,
  formatFavEdge,
  formatFavPnl,
  hasFavPnl,
  isSmallFavSample,
} from "../utils/favPnlFormat";

/**
 * "Back the favourite" — the same market baseline, rendered identically
 * everywhere a filtered P&L is shown.
 *
 * One component (in two densities) rather than per-screen markup, for the same
 * reason BrierScore beside it is one component: the entire value of putting this
 * number on six screens is that a user can compare what they see on one against
 * what they see on another, and a baseline formatted one way on the Filters
 * screen and another way on a saved result would quietly defeat that.
 *
 * The baseline is never shown alone. What a reader needs is the GAP — did this
 * filter beat doing the dumbest possible thing over the same races — so both
 * densities show the filtered selection's edge over it, and the edge is what
 * carries the colour.
 */

interface FavPnlProps {
  fav: FavPnlStats | null | undefined;
  /**
   * The filtered figure this baseline is being read against — the split card's
   * own headline. Optional only because one surface (a header line describing
   * the whole matched set) has no single selection to compare to.
   */
  pnl?: PnlStats | null;
  /**
   * Which staking convention the surrounding surface is showing. MUST match, or
   * the comparison manufactures ~11 points of edge out of bet sizing alone —
   * see favPnlFormat.ts.
   */
  convention?: StakeConvention;
  /**
   * `inline` — one dense line, for a card that has room for a headline and
   * little else (the Split A/B cards, a saved-result row).
   * `rows` — label/value rows, for a detail panel that is already a list of them.
   */
  variant?: "inline" | "rows";
  /** `dark` for the navy split cards, `light` for white surfaces. */
  tone?: "light" | "dark";
  testID: string;
  /** Overrides the "Fav" label — e.g. "Fav (live)" on captured results. */
  label?: string;
}

export const FavPnl: React.FC<FavPnlProps> = ({
  fav,
  pnl,
  convention = "toWin",
  variant = "inline",
  tone = "light",
  testID,
  label = "Fav",
}) => {
  const dark = tone === "dark";
  const verdict = favVerdict(pnl, fav, convention);
  const small = isSmallFavSample(fav);

  if (!hasFavPnl(fav)) {
    return (
      <View testID={`${testID}-empty`} style={variant === "rows" ? styles.row : styles.inlineWrap}>
        <Text style={[styles.label, dark && styles.labelDark]}>{label}</Text>
        <Text accessibilityLabel={verdict} style={[styles.muted, dark && styles.mutedDark]}>
          —
        </Text>
      </View>
    );
  }

  const edge = favEdgePts(pnl, fav, convention);
  const book = favBook(fav, convention);
  const roi = favRoi(fav, convention);

  // Same light/dark pairing rule as BrierScore: colors.pnlPositive/pnlNegative
  // are readable on the navy split cards and fail contrast on white, so the
  // light tone gets the darker success/danger pair. Applied to the EDGE, not to
  // the baseline's own P&L — a baseline losing 11% is not bad news, it is the
  // number the selection has to beat, and colouring it red would read as a
  // verdict on the filter.
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
        <View testID={`${testID}-pnl`} style={styles.row}>
          <Text style={[styles.label, dark && styles.labelDark]}>{label} — back the favourite</Text>
          <Text style={[styles.value, dark && styles.valueDark]}>{formatFavPnl(fav, convention)}</Text>
        </View>
        <View testID={`${testID}-book`} style={styles.row}>
          <Text style={[styles.label, dark && styles.labelDark]}>{label} — staked</Text>
          <Text style={[styles.value, dark && styles.valueDark]}>
            £{book?.staked.toFixed(2)} over {fav?.count} bet{fav?.count === 1 ? "" : "s"} / {fav?.races} race
            {fav?.races === 1 ? "" : "s"}
          </Text>
        </View>
        <View testID={`${testID}-edge`} style={styles.row}>
          <Text style={[styles.label, dark && styles.labelDark]}>This filter vs favourite</Text>
          <Text style={[styles.value, edgeStyle]}>{formatFavEdge(edge)}</Text>
        </View>
        <Text testID={`${testID}-caption`} style={[styles.caption, dark && styles.captionDark]}>
          {captionFor(fav, roi, small)}
        </Text>
      </View>
    );
  }

  return (
    <View testID={testID} style={styles.inlineWrap} accessibilityLabel={verdict}>
      <Text style={[styles.inlineText, dark && styles.inlineTextDark]} numberOfLines={1}>
        <Text style={[styles.label, dark && styles.labelDark]}>{label} </Text>
        <Text testID={`${testID}-value`} style={[styles.value, dark && styles.valueDark]}>
          {formatFavPnl(fav, convention)}
        </Text>
        {edge != null && (
          <>
            <Text style={[styles.label, dark && styles.labelDark]}> </Text>
            <Text testID={`${testID}-edge`} style={[styles.value, edgeStyle]}>
              ({formatFavEdge(edge)})
            </Text>
          </>
        )}
      </Text>
      {small && (
        <View testID={`${testID}-small-sample`} style={styles.smallSamplePill}>
          <Text style={styles.smallSampleText}>{fav?.races} races</Text>
        </View>
      )}
    </View>
  );
};

function captionFor(fav: FavPnlStats | null | undefined, roi: number | null, small: boolean): string {
  const races = fav?.races ?? 0;
  const joint = (fav?.count ?? 0) - races;
  const jointNote = joint > 0 ? ` Includes ${joint} joint favourite${joint === 1 ? "" : "s"}, each backed in full.` : "";
  // No stake size named here — the figure above is whichever convention the
  // surrounding surface uses, and hardcoding "£1" would contradict it on the
  // to-win surfaces.
  const base = `The shortest-priced runner in each of these ${races} race${races === 1 ? "" : "s"}, backed whatever the filters say, returns ${roi == null ? "—" : `${roi.toFixed(1)}%`}.${jointNote}`;
  return small ? `${base} Too few races to read as a result.` : base;
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
