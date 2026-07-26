import { useState } from "react";
import { useResponsive } from "./responsive";

// Shared burger-menu state for screen headers with more than one action
// button: at tablet+ widths (>=768px) actions render inline exactly as
// before; below that (`!isTablet`), they collapse behind a single burger
// icon, opening a dropdown. Screens with only one "← Back" button don't use
// this — one button never needs collapsing.
//
// Pair with <HeaderActionsContainer> for the actual row/dropdown JSX, and
// render an `Appbar.Action` (guarded by `!isTablet`) inside the screen's own
// `Appbar.Header` for the burger button itself — the two can't come from one
// shared component instance since they render in different parents (inside
// vs. below the Appbar.Header).
export function useHeaderMenu() {
  const { isTablet } = useResponsive();
  const [open, setOpen] = useState(false);

  // Closes the menu (a no-op at tablet+, where it's never open) before
  // running the button's own onPress, so tapping any item dismisses the
  // dropdown.
  const wrap = (onPress: () => void) => () => {
    if (!isTablet) setOpen(false);
    onPress();
  };

  return { isTablet, open, setOpen, wrap };
}
