import { MD3LightTheme } from "react-native-paper";

export const colors = {
  primary: "#4F46E5",
  primaryDark: "#4338CA",
  surface: "#FFFFFF",
  background: "#F8FAFC",
  border: "#E2E8F0",
  text: "#0F172A",
  textSecondary: "#64748B",
  textTertiary: "#94A3B8",
  success: "#16A34A",
  danger: "#DC2626",
  warning: "#D97706",
  info: "#0891B2",
};

export const statusPill: Record<string, { bg: string; fg: string }> = {
  ACTIVE: { bg: "#EEF2FF", fg: colors.primary },
  WINNER: { bg: "#FEF3C7", fg: colors.warning },
  LOSER: { bg: "#FEE2E2", fg: colors.danger },
  HIDDEN: { bg: "#F1F5F9", fg: colors.textSecondary },
  PLACED: { bg: "#CFFAFE", fg: colors.info },
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

export const radii = { sm: 6, md: 10, lg: 16, pill: 999 };

export const theme = {
  ...MD3LightTheme,
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
