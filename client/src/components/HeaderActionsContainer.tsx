import React from "react";
import { View, StyleSheet } from "react-native";
import { colors, radii, spacing } from "../theme";

// Renders a screen's header action buttons either as the tablet+ inline row
// (unchanged from before the burger menu existed) or, at phone widths, as a
// compact dropdown anchored under the burger icon — never both. Pair with
// `useHeaderMenu()` for the `isTablet`/`open` state and the Appbar.Action
// burger button itself (rendered separately, inside the screen's own
// Appbar.Header).
interface HeaderActionsContainerProps {
  isTablet: boolean;
  open: boolean;
  inlineTestId: string;
  menuTestId: string;
  children: React.ReactNode;
}

export const HeaderActionsContainer: React.FC<HeaderActionsContainerProps> = ({
  isTablet,
  open,
  inlineTestId,
  menuTestId,
  children,
}) => {
  if (isTablet) {
    return (
      <View testID={inlineTestId} style={styles.inlineRow}>
        {children}
      </View>
    );
  }
  if (!open) return null;
  return (
    <View testID={menuTestId} style={styles.dropdown}>
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  inlineRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.primary,
  },
  dropdown: {
    position: "absolute",
    top: "100%",
    right: spacing.sm,
    zIndex: 1000,
    elevation: 8,
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    marginTop: spacing.xs,
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    minWidth: 160,
    maxWidth: 260,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
});
