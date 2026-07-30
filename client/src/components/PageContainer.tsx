import React from "react";
import { View, StyleSheet, ViewStyle, StyleProp } from "react-native";

interface PageContainerProps {
  children: React.ReactNode;
  maxWidth?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

// Constrains and centers a screen's scrollable content on wide viewports
// (tablet landscape through MacBook/desktop) so filter grids, list rows,
// and cards don't stretch edge-to-edge into a sea of empty whitespace —
// the same content that reads fine at phone width otherwise just grows
// wider and wider with no upper bound. Headers/app bars deliberately stay
// full-bleed outside this (a colored bar spanning the viewport reads
// fine, and often carries its own left/right-anchored content); only the
// body content beneath needs capping. A no-op at phone widths (maxWidth
// is always wider than a phone viewport, so it never constrains there).
export const PageContainer: React.FC<PageContainerProps> = ({
  children,
  maxWidth = 900,
  style,
  testID,
}) => {
  return (
    <View testID={testID} style={styles.outer}>
      <View style={[styles.inner, { maxWidth }, style]}>{children}</View>
    </View>
  );
};

const styles = StyleSheet.create({
  outer: {
    width: "100%",
    alignItems: "center",
  },
  inner: {
    width: "100%",
  },
});
