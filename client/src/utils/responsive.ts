import { useWindowDimensions } from "react-native";

// Shared breakpoints for the handful of layout decisions that need to
// react to viewport width beyond what PageContainer's max-width alone
// covers (e.g. switching Split A/B cards from stacked to side-by-side).
// Values follow common device classes: iPad portrait starts at 768,
// small-laptop/iPad-landscape at 1024, MacBook-and-up at 1440.
//
// `narrow` is the odd one out: it isn't a device class but the width below
// which a label + two 84px number inputs + an inline hint stop fitting on one
// line inside a padded card (measured on the Model vs SP filter grid — it needs
// ~460px of viewport, so anything under 480 has to stack). Phones sit well
// under it (iPhone SE 320, iPhone 12/13/14 390, Pro Max 430), desktops well
// over, so nothing lands ambiguously on the boundary.
export const BREAKPOINTS = {
  narrow: 480,
  tablet: 768,
  desktop: 1024,
  wide: 1440,
};

export function useResponsive() {
  const { width, height } = useWindowDimensions();
  return {
    width,
    height,
    isNarrow: width < BREAKPOINTS.narrow,
    isTablet: width >= BREAKPOINTS.tablet,
    isDesktop: width >= BREAKPOINTS.desktop,
    isWide: width >= BREAKPOINTS.wide,
  };
}
