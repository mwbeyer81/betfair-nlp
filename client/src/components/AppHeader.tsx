import React, { useEffect, useState } from "react";
import { View, StyleSheet } from "react-native";
import { Text, Appbar, Button, Icon } from "react-native-paper";
import { HeaderActionsContainer } from "./HeaderActionsContainer";
import { useHeaderMenu } from "../utils/useHeaderMenu";
import { chatApi } from "../services/chatApi";
import { colors, radii, spacing } from "../theme";
import type { Route } from "../hooks/useRouter";

export interface AppHeaderProps {
  navigate: (to: Route, query?: string) => void;
  isAuthenticated: boolean;
  onLogout?: () => void;
  // Only the /isp family renders anonymously — every other screen sits
  // behind the login wall in App.tsx, so this is omitted there and the
  // burger menu simply has no Log In/Sign Up items on those screens.
  onRequestAuth?: () => void;
  onBack?: () => void;
  subtitle?: string;
  // Unique per screen (e.g. "isp", "events", "runner-detail") — namespaces
  // every testID this component renders so two screens' headers never
  // collide in the same test suite.
  testIdPrefix: string;
  // Screen-specific buttons (e.g. IndustrySpScreen's "Hide filters"/"Model
  // Performance") that appear ahead of the shared nav items, inside the
  // same burger menu — kept as a slot rather than hardcoded here so each
  // screen can still expose its own actions without duplicating the menu
  // shell. Render-prop so those buttons can also close the phone dropdown
  // on press via the same `wrap` the standard nav items use.
  extraActions?: (wrap: (onPress: () => void) => () => void) => React.ReactNode;
}

// One header — brand, title/subtitle, back action, and burger nav menu —
// shared by every screen so "BackBet" branding and the menu's item set
// (Industry SP / Chat / Events / Runners / Account / Results / Log Out or
// Log In+Sign Up) are identical everywhere instead of each screen
// reimplementing its own subset.
export const AppHeader: React.FC<AppHeaderProps> = ({
  navigate,
  isAuthenticated,
  onLogout,
  onRequestAuth,
  onBack,
  subtitle,
  testIdPrefix,
  extraActions,
}) => {
  const { isTablet, open: menuOpen, setOpen: setMenuOpen, wrap } = useHeaderMenu();
  const [showAccountPanel, setShowAccountPanel] = useState(false);
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [accountPhone, setAccountPhone] = useState<string | null>(null);
  const [emailVerified, setEmailVerified] = useState<boolean | null>(null);

  // Centralized here (was previously duplicated inside IndustrySpScreen
  // alone) now that every screen shares this one header's Account item.
  useEffect(() => {
    let cancelled = false;
    if (!isAuthenticated) {
      setAccountEmail(null);
      setAccountPhone(null);
      setEmailVerified(null);
      setShowAccountPanel(false);
      return;
    }
    chatApi.getMe().then(me => {
      if (!cancelled) {
        setAccountEmail(me?.email ?? null);
        setAccountPhone(me?.phone ?? null);
        setEmailVerified(me?.emailVerified ?? null);
      }
    }).catch(() => {
      if (!cancelled) setEmailVerified(null);
    });
    return () => { cancelled = true; };
  }, [isAuthenticated]);

  return (
    <View style={styles.headerWrapper}>
      <Appbar.Header style={styles.appbar}>
        {onBack && (
          <Appbar.BackAction testID={`${testIdPrefix}-back-button`} color="white" onPress={onBack} />
        )}
        <Appbar.Content
          title={
            // Appbar.Content's own `subtitle` prop is MD2-only (react-native-
            // paper silently no-ops it under this app's MD3 theme — isV3
            // guards it out entirely, see AppbarContent.tsx) — folding the
            // subtitle into our own title node, as a second line, is what
            // actually gets it on screen.
            <View testID={`${testIdPrefix}-title`} style={styles.titleColumn}>
              <View style={styles.titleRow}>
                <Text style={styles.title}>BackBet</Text>
                <View style={styles.syncIcon}>
                  <Icon source="sync" size={16} color="white" />
                </View>
              </View>
              {subtitle != null && (
                <Text style={styles.subtitle} numberOfLines={1}>
                  {subtitle}
                </Text>
              )}
            </View>
          }
        />
        {!isTablet && (
          <Appbar.Action
            testID={`${testIdPrefix}-menu-button`}
            icon="menu"
            color="white"
            onPress={() => setMenuOpen(v => !v)}
          />
        )}
      </Appbar.Header>
      <HeaderActionsContainer
        isTablet={isTablet}
        open={menuOpen}
        inlineTestId={`${testIdPrefix}-header-actions`}
        menuTestId={`${testIdPrefix}-nav-menu`}
      >
        {extraActions?.(wrap)}
        {extraActions != null && <View style={styles.divider} />}
        <Button
          testID={`${testIdPrefix}-menu-isp-link`}
          mode="outlined"
          compact
          onPress={wrap(() => navigate("/isp"))}
          style={styles.toggleButton}
          labelStyle={styles.toggleButtonLabel}
        >
          Industry SP
        </Button>
        <Button
          testID={`${testIdPrefix}-menu-chat-link`}
          mode="outlined"
          compact
          onPress={wrap(() => navigate("/chat"))}
          style={styles.toggleButton}
          labelStyle={styles.toggleButtonLabel}
        >
          Chat
        </Button>
        <Button
          testID={`${testIdPrefix}-menu-events-link`}
          mode="outlined"
          compact
          onPress={wrap(() => navigate("/events"))}
          style={styles.toggleButton}
          labelStyle={styles.toggleButtonLabel}
        >
          Events
        </Button>
        <Button
          testID={`${testIdPrefix}-menu-runners-link`}
          mode="outlined"
          compact
          onPress={wrap(() => navigate("/runners"))}
          style={styles.toggleButton}
          labelStyle={styles.toggleButtonLabel}
        >
          Runners
        </Button>
        <View style={styles.divider} />
        {isAuthenticated ? (
          <>
            <Button
              testID={`${testIdPrefix}-account-button`}
              mode="outlined"
              compact
              onPress={wrap(() => setShowAccountPanel(v => !v))}
              style={styles.toggleButton}
              labelStyle={styles.toggleButtonLabel}
            >
              Account
            </Button>
            <Button
              testID={`${testIdPrefix}-menu-results-link`}
              mode="contained"
              compact
              buttonColor={colors.accent}
              onPress={wrap(() => navigate("/results"))}
              style={styles.headerButton}
              labelStyle={styles.headerButtonLabel}
            >
              Results →
            </Button>
            {onLogout && (
              <Button
                testID={`${testIdPrefix}-logout-button`}
                mode="contained"
                compact
                buttonColor={colors.accent}
                onPress={wrap(onLogout)}
                style={styles.headerButton}
                labelStyle={styles.headerButtonLabel}
              >
                Log Out
              </Button>
            )}
          </>
        ) : onRequestAuth ? (
          <>
            <Button
              testID={`${testIdPrefix}-login-button`}
              mode="outlined"
              compact
              onPress={wrap(onRequestAuth)}
              style={styles.toggleButton}
              labelStyle={styles.toggleButtonLabel}
            >
              Log In
            </Button>
            <Button
              testID={`${testIdPrefix}-signup-button`}
              mode="contained"
              compact
              buttonColor={colors.accent}
              onPress={wrap(onRequestAuth)}
              style={styles.headerButton}
              labelStyle={styles.headerButtonLabel}
            >
              Sign Up
            </Button>
          </>
        ) : null}
      </HeaderActionsContainer>
      {isAuthenticated && showAccountPanel && (
        <View testID={`${testIdPrefix}-account-panel`} style={styles.accountPanel}>
          <Text style={styles.accountPanelText}>
            {/* A phone-only or emailless-Google account has no email at
                all — fall back to the phone number rather than showing
                the "…" not-yet-loaded placeholder forever. */}
            Signed in as {accountEmail ?? accountPhone ?? "…"}
          </Text>
          <Text style={styles.accountPanelStatus}>
            {!accountEmail
              ? ""
              : emailVerified === true
                ? "Email verified"
                : emailVerified === false
                  ? "Email not verified"
                  : ""}
          </Text>
          <Button
            testID={`${testIdPrefix}-account-panel-close`}
            mode="text"
            compact
            onPress={() => setShowAccountPanel(false)}
          >
            Close
          </Button>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  headerWrapper: {
    position: "relative",
    zIndex: 10,
  },
  appbar: {
    backgroundColor: colors.primary,
    elevation: 4,
  },
  titleColumn: {
    flexDirection: "column",
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 1,
  },
  syncIcon: {
    marginTop: 5,
  },
  title: {
    color: "white",
    fontSize: 18,
    fontWeight: "700",
  },
  subtitle: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 11,
  },
  divider: {
    alignSelf: "stretch",
    height: 1,
    backgroundColor: "rgba(255,255,255,0.25)",
    marginVertical: 4,
  },
  toggleButton: {
    marginHorizontal: 3,
    borderRadius: radii.md,
    borderColor: "rgba(255,255,255,0.6)",
  },
  toggleButtonLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: "#fff",
  },
  headerButton: {
    marginHorizontal: 3,
    borderRadius: radii.md,
  },
  headerButtonLabel: {
    fontSize: 11,
    fontWeight: "600",
  },
  accountPanel: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  accountPanelText: {
    color: colors.primary,
    fontWeight: "600",
    flexShrink: 1,
    fontSize: 13,
  },
  accountPanelStatus: {
    color: colors.textSecondary,
    fontSize: 12,
    flexShrink: 1,
  },
});
