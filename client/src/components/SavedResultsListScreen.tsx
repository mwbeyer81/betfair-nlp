import React, { useEffect, useState } from "react";
import { View, ScrollView, StyleSheet, SafeAreaView, TouchableOpacity } from "react-native";
import { Text, Appbar, Button, ActivityIndicator, Surface, IconButton } from "react-native-paper";
import Svg, { Path } from "react-native-svg";
import { chatApi, SavedFilterSet } from "../services/chatApi";
import { PageContainer } from "./PageContainer";
import { HeaderActionsContainer } from "./HeaderActionsContainer";
import { useHeaderMenu } from "../utils/useHeaderMenu";
import { useResponsive } from "../utils/responsive";
import { colors, radii, spacing } from "../theme";
import { formatPnl, formatPct, formatRaceDate } from "../utils/ispFormat";

interface SavedResultsListScreenProps {
  onBack: () => void;
  onOpenResult: (id: string) => void;
  onNavigateToChat: () => void;
  onNavigateToEvents: () => void;
  onNavigateToRunners: () => void;
  onNavigateToIsp: () => void;
}

type SortBy = "date" | "pnl" | "name";

const SPARK_WIDTH = 120;
const SPARK_HEIGHT = 36;

// A minimal, axis-less trend line — same react-native-svg Path technique as
// ModelPerformanceDashboard's calibration chart, just without any of its
// tooltip/axis machinery, since this only needs to hint at shape at card
// size, not be inspected.
function Sparkline({ points }: { points: SavedFilterSet["graphPoints"] }) {
  if (points.length < 2) return null;
  const rois = points.map(p => p.roiPercent);
  const minRoi = Math.min(...rois, 0);
  const maxRoi = Math.max(...rois, 0);
  const range = maxRoi - minRoi || 1;
  const xFor = (i: number) => (i / (points.length - 1)) * SPARK_WIDTH;
  const yFor = (roi: number) => SPARK_HEIGHT - ((roi - minRoi) / range) * SPARK_HEIGHT;
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"} ${xFor(i)} ${yFor(p.roiPercent)}`).join(" ");
  const lastRoi = points[points.length - 1].roiPercent;
  return (
    <Svg width={SPARK_WIDTH} height={SPARK_HEIGHT} viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`}>
      <Path d={d} stroke={lastRoi >= 0 ? colors.pnlPositive : colors.pnlNegative} strokeWidth={2} fill="none" />
    </Svg>
  );
}

export const SavedResultsListScreen: React.FC<SavedResultsListScreenProps> = ({
  onBack,
  onOpenResult,
  onNavigateToChat,
  onNavigateToEvents,
  onNavigateToRunners,
  onNavigateToIsp,
}) => {
  const { isTablet, isDesktop } = useResponsive();
  const { open: menuOpen, setOpen: setMenuOpen, wrap } = useHeaderMenu();
  const [results, setResults] = useState<SavedFilterSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortBy>("date");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    chatApi
      .getSavedFilterSets()
      .then(res => {
        if (!cancelled) setResults(res.data);
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load saved results.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const sorted = [...results].sort((a, b) => {
    if (sortBy === "pnl") return b.pnlStats.pnl - a.pnlStats.pnl;
    if (sortBy === "name") return a.name.localeCompare(b.name);
    return b.createdAt.localeCompare(a.createdAt);
  });

  async function handleDelete(id: string) {
    try {
      await chatApi.deleteSavedFilterSet(id);
      setResults(prev => prev.filter(r => r.id !== id));
    } finally {
      setConfirmDeleteId(null);
    }
  }

  return (
    <SafeAreaView testID="saved-results-screen" style={styles.screen}>
      <View style={styles.headerWrapper}>
        <Appbar.Header style={styles.appbar}>
          <Appbar.BackAction testID="saved-results-back-button" color="white" onPress={onBack} />
          <Appbar.Content title="Results" titleStyle={styles.appbarTitle} />
          {!isTablet && (
            <Appbar.Action
              testID="saved-results-menu-button"
              icon="menu"
              color="white"
              onPress={() => setMenuOpen(v => !v)}
            />
          )}
        </Appbar.Header>
        <HeaderActionsContainer
          isTablet={isTablet}
          open={menuOpen}
          inlineTestId="saved-results-header-actions"
          menuTestId="saved-results-nav-menu"
        >
          <Button
            testID="saved-results-sort-toggle"
            mode="contained-tonal"
            compact
            onPress={wrap(() =>
              setSortBy(s => (s === "date" ? "pnl" : s === "pnl" ? "name" : "date"))
            )}
            style={styles.headerButton}
            labelStyle={styles.headerButtonLabel}
          >
            Sort: {sortBy === "date" ? "Newest" : sortBy === "pnl" ? "PnL" : "Name"}
          </Button>
          <Button testID="saved-results-screen-isp-button" mode="contained" compact buttonColor={colors.accent} onPress={wrap(onNavigateToIsp)} style={styles.headerButton} labelStyle={styles.headerButtonLabel}>
            Filters →
          </Button>
          <Button testID="saved-results-screen-events-button" mode="contained" compact buttonColor={colors.accent} onPress={wrap(onNavigateToEvents)} style={styles.headerButton} labelStyle={styles.headerButtonLabel}>
            Events →
          </Button>
          <Button testID="saved-results-screen-chat-button" mode="contained" compact buttonColor={colors.accent} onPress={wrap(onNavigateToChat)} style={styles.headerButton} labelStyle={styles.headerButtonLabel}>
            Chat →
          </Button>
          <Button testID="saved-results-screen-runners-button" mode="contained" compact buttonColor={colors.accent} onPress={wrap(onNavigateToRunners)} style={styles.headerButton} labelStyle={styles.headerButtonLabel}>
            Runners →
          </Button>
        </HeaderActionsContainer>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <PageContainer>
          {loading && (
            <View testID="saved-results-loading" style={styles.centered}>
              <ActivityIndicator size="large" animating color={colors.primary} />
              <Text style={styles.loadingText}>Loading saved results…</Text>
            </View>
          )}
          {!loading && error && (
            <View testID="saved-results-error" style={styles.centered}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}
          {!loading && !error && sorted.length === 0 && (
            <View testID="saved-results-empty" style={styles.centered}>
              <Text style={styles.emptyText}>No saved results yet — save a filter set from the Filters screen.</Text>
            </View>
          )}
          {!loading && !error && sorted.length > 0 && (
            <View testID="saved-results-list" style={[styles.resultCards, isDesktop && styles.resultCardsRow]}>
              {sorted.map(result => {
                const pnlPositive = result.pnlStats.pnl >= 0;
                return (
                  <View key={result.id} style={isDesktop ? styles.resultCardFlex : undefined}>
                    <TouchableOpacity testID={`saved-results-item-${result.id}`} onPress={() => onOpenResult(result.id)} activeOpacity={0.8}>
                      <Surface style={styles.resultCard} elevation={1}>
                        <View style={styles.resultCardHeader}>
                          <Text variant="titleSmall" style={styles.resultName} numberOfLines={1}>
                            {result.name}
                          </Text>
                          <IconButton
                            testID={`saved-results-item-${result.id}-delete`}
                            icon="delete-outline"
                            size={18}
                            onPress={() => setConfirmDeleteId(result.id)}
                          />
                        </View>
                        <Text style={styles.resultDate}>{formatRaceDate(result.createdAt)}</Text>
                        <View style={styles.resultBody}>
                          <View>
                            <Text style={[styles.resultPnl, pnlPositive ? styles.pnlPos : styles.pnlNeg]}>
                              {formatPnl(result.pnlStats.pnl)}
                            </Text>
                            <Text style={[styles.resultPct, pnlPositive ? styles.pnlPos : styles.pnlNeg]}>
                              ({formatPct(result.pnlStats.pnl, result.pnlStats.staked)})
                            </Text>
                          </View>
                          <Sparkline points={result.graphPoints} />
                        </View>
                        {confirmDeleteId === result.id && (
                          <View style={styles.confirmDeleteRow}>
                            <Text style={styles.confirmDeleteText}>Delete this result?</Text>
                            <Button
                              testID={`saved-results-item-${result.id}-cancel-delete`}
                              compact
                              mode="text"
                              onPress={() => setConfirmDeleteId(null)}
                            >
                              Cancel
                            </Button>
                            <Button
                              testID={`saved-results-item-${result.id}-confirm-delete`}
                              compact
                              mode="text"
                              textColor={colors.danger}
                              onPress={() => handleDelete(result.id)}
                            >
                              Delete
                            </Button>
                          </View>
                        )}
                      </Surface>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          )}
        </PageContainer>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  headerWrapper: { position: "relative", zIndex: 10 },
  appbar: { backgroundColor: colors.primary },
  appbarTitle: { color: "white", fontWeight: "700" },
  headerButton: { borderRadius: radii.sm, marginLeft: spacing.xs },
  headerButtonLabel: { fontSize: 12, fontWeight: "600" },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  centered: { alignItems: "center", justifyContent: "center", padding: spacing.xl },
  loadingText: { marginTop: spacing.sm, color: colors.textSecondary },
  errorText: { color: colors.danger },
  emptyText: { color: colors.textSecondary, textAlign: "center" },
  resultCards: { padding: spacing.md, gap: spacing.md },
  resultCardsRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start" },
  resultCardFlex: { flexBasis: "48%", flexGrow: 1, minWidth: 280 },
  resultCard: { borderRadius: radii.md, padding: spacing.md, gap: spacing.xs },
  resultCardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  resultName: { flex: 1, fontWeight: "700" },
  resultDate: { fontSize: 12, color: colors.textSecondary },
  resultBody: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.xs },
  resultPnl: { fontSize: 18, fontWeight: "700" },
  resultPct: { fontSize: 13 },
  pnlPos: { color: colors.pnlPositive },
  pnlNeg: { color: colors.pnlNegative },
  confirmDeleteRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginTop: spacing.xs },
  confirmDeleteText: { flex: 1, fontSize: 12, color: colors.textSecondary },
});
