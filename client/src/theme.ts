import { MD3LightTheme, configureFonts } from "react-native-paper";

export const colors = {
  primary: "#0B3D2E",
  accent: "#2F6B4F",
  primaryLight: "#E6EFEA",
  primaryMuted: "#A6C2B0",
  surface: "#FFFFFF",
  background: "#F8FAFC",
  border: "#E2E8F0",
  text: "#0F172A",
  textSecondary: "#64748B",
  textTertiary: "#94A3B8",
  success: "#16A34A",
  successLight: "#DCFCE7",
  danger: "#DC2626",
  warning: "#D97706",
  info: "#0891B2",
  infoLight: "#CFFAFE",
  pnlPositive: "#4ADE80",
  pnlNegative: "#F87171",
};

export const statusPill: Record<string, { bg: string; fg: string }> = {
  ACTIVE: { bg: colors.primaryLight, fg: colors.primary },
  WINNER: { bg: "#FEF3C7", fg: colors.warning },
  LOSER: { bg: "#FEE2E2", fg: colors.danger },
  HIDDEN: { bg: "#F1F5F9", fg: colors.textSecondary },
  PLACED: { bg: colors.infoLight, fg: colors.info },
  NON_FINISHER: { bg: "#F1F5F9", fg: colors.textSecondary },
  OPEN: { bg: colors.successLight, fg: colors.success },
  SUSPENDED: { bg: "#FEF3C7", fg: colors.warning },
  CLOSED: { bg: "#F1F5F9", fg: colors.textSecondary },
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

// `button: 0` is for larger tappable buttons (squared-off corners); `pill`
// remains for small pill-shaped chips/badges, which stay fully rounded.
export const radii = { sm: 6, md: 10, lg: 16, pill: 999, button: 0 };

// MD3's own typescale splits variants between a "regular" (400) and "medium"
// (500) weight — a flat single-weight config would force the medium variants
// through the browser's synthetic-bold instead of Inter's real Medium glyphs.
const regularFont = { fontFamily: "Inter_400Regular" };
const mediumFont = { fontFamily: "Inter_500Medium" };

const fontConfig = {
  displayLarge: regularFont,
  displayMedium: regularFont,
  displaySmall: regularFont,
  headlineLarge: regularFont,
  headlineMedium: regularFont,
  headlineSmall: regularFont,
  titleLarge: regularFont,
  bodyLarge: regularFont,
  bodyMedium: regularFont,
  bodySmall: regularFont,
  titleMedium: mediumFont,
  titleSmall: mediumFont,
  labelLarge: mediumFont,
  labelMedium: mediumFont,
  labelSmall: mediumFont,
  default: regularFont,
};

export const theme = {
  ...MD3LightTheme,
  fonts: configureFonts({ config: fontConfig }),
  colors: {
    ...MD3LightTheme.colors,
    primary: colors.primary,
    secondary: colors.success,
    error: colors.danger,
    background: colors.background,
    surface: colors.surface,
    onPrimary: "#ffffff",
    onSecondary: "#ffffff",
    onError: "#ffffff",
  },
};
