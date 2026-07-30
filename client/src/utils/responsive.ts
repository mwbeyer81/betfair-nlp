import { useWindowDimensions } from "react-native";

// Shared breakpoints for the handful of layout decisions that need to
// react to viewport width beyond what PageContainer's max-width alone
// covers (e.g. switching Split A/B cards from stacked to side-by-side).
// Values follow common device classes: iPad portrait starts at 768,
// small-laptop/iPad-landscape at 1024, MacBook-and-up at 1440.
export const BREAKPOINTS = {
  tablet: 768,
  desktop: 1024,
  wide: 1440,
};

export function useResponsive() {
  const { width, height } = useWindowDimensions();
  return {
    width,
    height,
    isTablet: width >= BREAKPOINTS.tablet,
    isDesktop: width >= BREAKPOINTS.desktop,
    isWide: width >= BREAKPOINTS.wide,
  };
}
