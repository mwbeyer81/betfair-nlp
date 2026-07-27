import React, { useEffect, useState } from "react";
import { View, ScrollView, StyleSheet, SafeAreaView, TouchableOpacity } from "react-native";
import { Text, Button, ActivityIndicator, Surface, IconButton, Chip } from "react-native-paper";
import Svg, { Path } from "react-native-svg";
import { chatApi, SavedFilterSet, SavedFilterSetPnlStats, SavedFilterSetSplit } from "../services/chatApi";
import { PageContainer } from "./PageContainer";
import { AppHeader } from "./AppHeader";
import { useResponsive } from "../utils/responsive";
import { colors, radii, spacing } from "../theme";
import { formatPnl, formatPct, formatRaceDate } from "../utils/ispFormat";
import type { Route } from "../hooks/useRouter";

interface SavedResultsListScreenProps {
  navigate: (to: Route, query?: string) => void;
  isAuthenticated: boolean;
  onLogout?: () => void;
  onBack: () => void;
  onOpenResult: (id: string) => void;
}

type SortBy = "date" | "pnl" | "name";

const SPARK_WIDTH = 120;
const SPARK_HEIGHT = 36;

// Real bug, reported live: any saved_filter_sets document created before
// the Split A/B schema change has neither field at all (the old shape
// stored one flat pnlStats/graphPoints instead) — nothing migrates old
// documents on deploy. Reading result.splitA.pnlStats on one of these threw
// mid-render with no error boundary anywhere in the app to catch it,
// blanking the ENTIRE screen (not just the one bad card). Every access to
// splitA/splitB below must go through this guard first.
function isLegacyResult(result: SavedFilterSet): boolean {
  return result.splitA == null || result.splitB == null;
}

// Split A/Split B are two independent tests, each with its own cumulative
// P&L series restarting from its own first race — concatenating them into
// one line would show a discontinuous jump right at the split boundary
// (Split B's series doesn't pick up where Split A's left off), which reads
// as a rendering bug rather than two separate results. Split A's own series
// is used as the at-a-glance preview instead; the detail screen (opened by
// tapping the card) shows both splits' own full graphs separately.
// Only ever called after isLegacyResult() has confirmed both splits exist.
function combinedPnlStats(result: SavedFilterSet): SavedFilterSetPnlStats {
  return {
    staked: result.splitA!.pnlStats.staked + result.splitB!.pnlStats.staked,
    returns: result.splitA!.pnlStats.returns + result.splitB!.pnlStats.returns,
    pnl: result.splitA!.pnlStats.pnl + result.splitB!.pnlStats.pnl,
    count: result.splitA!.pnlStats.count + result.splitB!.pnlStats.count,
  };
}

// A minimal, axis-less trend line — same react-native-svg Path technique as
// ModelPerformanceDashboard's calibration chart, just without any of its
// tooltip/axis machinery, since this only needs to hint at shape at card
// size, not be inspected.
function Sparkline({ points }: { points: SavedFilterSetSplit["graphPoints"] }) {
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
  navigate,
  isAuthenticated,
  onLogout,
  onBack,
  onOpenResult,
}) => {
  const { isDesktop } = useResponsive();
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
    if (sortBy === "pnl") {
      const pnlA = isLegacyResult(a) ? 0 : combinedPnlStats(a).pnl;
      const pnlB = isLegacyResult(b) ? 0 : combinedPnlStats(b).pnl;
      return pnlB - pnlA;
    }
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
      <AppHeader
        navigate={navigate}
        isAuthenticated={isAuthenticated}
        onLogout={onLogout}
        onBack={onBack}
        subtitle="Results"
        testIdPrefix="saved-results"
        extraActions={wrap => (
          <Button
            testID="saved-results-sort-toggle"
            mode="outlined"
            compact
            onPress={wrap(() =>
              setSortBy(s => (s === "date" ? "pnl" : s === "pnl" ? "name" : "date"))
            )}
            style={styles.headerButton}
            labelStyle={styles.headerButtonLabel}
          >
            Sort: {sortBy === "date" ? "Newest" : sortBy === "pnl" ? "PnL" : "Name"}
          </Button>
        )}
      />

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
                const legacy = isLegacyResult(result);
                const pnl = legacy ? null : combinedPnlStats(result);
                const pnlPositive = pnl != null && pnl.pnl >= 0;
                const deleteRow = confirmDeleteId === result.id && (
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
                );
                return (
                  <View key={result.id} style={isDesktop ? styles.resultCardFlex : undefined}>
                    {legacy ? (
                      // Not tappable — there's no valid split data to open a
                      // detail view for. The only useful action is deleting
                      // it, same delete flow as a normal card.
                      <Surface testID={`saved-results-item-${result.id}`} style={styles.resultCard} elevation={1}>
                        <View style={styles.resultCardHeader}>
                          <Text variant="titleSmall" style={styles.resultName} numberOfLines={1}>
                            {result.name}
                          </Text>
                          {result.createdBy === "agent" && (
                            <Chip
                              testID={`saved-results-item-${result.id}-agent-badge`}
                              compact
                              mode="flat"
                              style={styles.agentBadge}
                              textStyle={styles.agentBadgeText}
                            >
                              AI Training
                            </Chip>
                          )}
                          {result.createdBy !== "agent" && (
                            <IconButton
                              testID={`saved-results-item-${result.id}-delete`}
                              icon="delete-outline"
                              size={18}
                              onPress={() => setConfirmDeleteId(result.id)}
                            />
                          )}
                        </View>
                        <Text style={styles.resultDate}>{formatRaceDate(result.createdAt)}</Text>
                        <Text testID={`saved-results-item-${result.id}-legacy-notice`} style={styles.legacyNoticeText}>
                          Saved before this app's Split A/B update — delete and re-save to see it here.
                        </Text>
                        {deleteRow}
                      </Surface>
                    ) : (
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
                                {formatPnl(pnl!.pnl)}
                              </Text>
                              <Text style={[styles.resultPct, pnlPositive ? styles.pnlPos : styles.pnlNeg]}>
                                ({formatPct(pnl!.pnl, pnl!.staked)})
                              </Text>
                            </View>
                            <Sparkline points={result.splitA!.graphPoints} />
                          </View>
                          {deleteRow}
                        </Surface>
                      </TouchableOpacity>
                    )}
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
  agentBadge: { backgroundColor: colors.primaryLight },
  agentBadgeText: { color: colors.primary, fontSize: 11, fontWeight: "700" },
  resultDate: { fontSize: 12, color: colors.textSecondary },
  resultBody: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.xs },
  resultPnl: { fontSize: 18, fontWeight: "700" },
  resultPct: { fontSize: 13 },
  legacyNoticeText: { fontSize: 12, color: colors.textSecondary, fontStyle: "italic", marginTop: spacing.xs },
  pnlPos: { color: colors.pnlPositive },
  pnlNeg: { color: colors.pnlNegative },
  confirmDeleteRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginTop: spacing.xs },
  confirmDeleteText: { flex: 1, fontSize: 12, color: colors.textSecondary },
});
