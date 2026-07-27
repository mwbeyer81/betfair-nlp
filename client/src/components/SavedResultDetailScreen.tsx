import React, { useEffect, useState } from "react";
import { View, StyleSheet, SafeAreaView, ScrollView } from "react-native";
import { Text, Button, ActivityIndicator } from "react-native-paper";
import { chatApi, SavedFilterSet, SavedFilterSetSplit } from "../services/chatApi";
import { SplitDetailPanel } from "./SplitDetailPanel";
import { PnlConvergencePanel } from "./PnlConvergencePanel";
import { AppHeader } from "./AppHeader";
import { buildFilterSummaryFromParams, formatPnl, formatPct } from "../utils/ispFormat";
import { colors, radii, spacing } from "../theme";
import type { Route } from "../hooks/useRouter";

interface SavedResultDetailScreenProps {
  navigate: (to: Route, query?: string) => void;
  isAuthenticated: boolean;
  onLogout?: () => void;
  id: string;
  onBack: () => void;
  onRestore: (filters: Record<string, string>) => void;
}

// The live Filters screen's own Split A/Split B card look (see
// IndustrySpScreen's renderSplitCard/splitCard styles) — mirrored here so a
// saved result reads as close as possible to what the user actually saw at
// save time, rather than a differently-shaped summary.
function SplitCard({
  id,
  label,
  split,
  onDetails,
  onGraph,
}: {
  id: "a" | "b";
  label: string;
  split: SavedFilterSetSplit;
  onDetails: () => void;
  onGraph: () => void;
}) {
  const effectiveTo = split.toRow ?? split.total;
  return (
    <View testID={`saved-result-split-card-${id}`} style={styles.splitCard}>
      <Text style={styles.splitCardLabel}>
        {label} — races {split.fromRow}–{effectiveTo}
      </Text>
      {split.pnlStats.staked > 0 ? (
        <Text testID={`saved-result-split-pnl-${id}`} style={[styles.pnlHeadline, split.pnlStats.pnl >= 0 ? styles.pnlPos : styles.pnlNeg]}>
          {formatPnl(split.pnlStats.pnl)}{" "}
          <Text style={[styles.pnlPct, split.pnlStats.pnl >= 0 ? styles.pnlPos : styles.pnlNeg]}>
            ({formatPct(split.pnlStats.pnl, split.pnlStats.staked)})
          </Text>
        </Text>
      ) : (
        <Text testID={`saved-result-split-empty-${id}`} style={styles.splitEmptyText}>
          No qualifying bets in this split.
        </Text>
      )}
      <View style={styles.splitButtonRow}>
        <Button
          testID={`saved-result-split-details-button-${id}`}
          mode="outlined"
          compact
          onPress={onDetails}
          style={styles.splitDetailsButton}
          labelStyle={styles.splitDetailsButtonLabel}
        >
          Details
        </Button>
        <Button
          testID={`saved-result-split-graph-button-${id}`}
          mode="outlined"
          compact
          onPress={onGraph}
          style={styles.splitDetailsButton}
          labelStyle={styles.splitDetailsButtonLabel}
        >
          Graph
        </Button>
      </View>
    </View>
  );
}

export const SavedResultDetailScreen: React.FC<SavedResultDetailScreenProps> = ({
  navigate,
  isAuthenticated,
  onLogout,
  id,
  onBack,
  onRestore,
}) => {
  const [result, setResult] = useState<SavedFilterSet | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailSplit, setDetailSplit] = useState<"a" | "b" | null>(null);
  const [graphSplit, setGraphSplit] = useState<"a" | "b" | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    chatApi
      .getSavedFilterSet(id)
      .then(res => {
        if (!cancelled) setResult(res.data);
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load saved result.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function handleDelete() {
    await chatApi.deleteSavedFilterSet(id);
    onBack();
  }

  const detailedSplit = detailSplit === "a" ? result?.splitA : detailSplit === "b" ? result?.splitB : null;
  const graphedSplit = graphSplit === "a" ? result?.splitA : graphSplit === "b" ? result?.splitB : null;
  // Same real bug as SavedResultsListScreen's isLegacyResult(): a result
  // saved before the Split A/B schema change has neither field at all.
  // Rendering the two SplitCards below on one of these threw mid-render
  // with no error boundary anywhere in the app to catch it — check this
  // before assuming result.splitA/splitB exist.
  const isLegacyResult = result != null && (result.splitA == null || result.splitB == null);

  return (
    <SafeAreaView testID="saved-result-detail-screen" style={styles.screen}>
      <AppHeader
        navigate={navigate}
        isAuthenticated={isAuthenticated}
        onLogout={onLogout}
        onBack={onBack}
        subtitle={result?.name ?? "Result"}
        testIdPrefix="saved-result-detail"
      />
      {loading && (
        <View testID="saved-result-detail-loading" style={styles.centered}>
          <ActivityIndicator size="large" animating color={colors.primary} />
        </View>
      )}
      {!loading && error && (
        <View testID="saved-result-detail-error" style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
          <Button mode="contained" onPress={onBack} style={styles.backButton}>
            ← Back to Results
          </Button>
        </View>
      )}
      {!loading && !error && result && isLegacyResult && (
        <View style={styles.detailContainer}>
          <View style={styles.centered}>
            <Text testID="saved-result-detail-legacy-notice" style={styles.legacyNoticeText}>
              This result was saved before this app's Split A/B update and
              can't be displayed. Delete it and save a fresh one from the
              Filters screen.
            </Text>
          </View>
          <View style={styles.actionsRow}>
            <Button testID="saved-result-detail-restore" mode="contained" buttonColor={colors.accent} onPress={() => onRestore(result.filters)} style={styles.actionButton}>
              Restore filters
            </Button>
            <Button testID="saved-result-detail-delete" mode="outlined" textColor={colors.danger} onPress={handleDelete} style={styles.actionButton}>
              Delete
            </Button>
          </View>
        </View>
      )}
      {!loading && !error && result && !isLegacyResult && graphedSplit == null && (
        <View style={styles.detailContainer}>
          {/* SplitDetailPanel is a full-screen position:"absolute" overlay by
              design (zIndex 100) — the action bar below sits in its own
              higher-zIndex absolute layer so it floats above it, rather than
              being a normal ScrollView sibling that the panel would cover. */}
          {detailedSplit != null && detailSplit != null && (
            <SplitDetailPanel
              id={detailSplit}
              label={detailSplit === "a" ? "Split A" : "Split B"}
              fromRow={detailedSplit.fromRow}
              toRow={detailedSplit.toRow ?? detailedSplit.total}
              totalRaces={detailedSplit.total}
              totalRunners={detailedSplit.totalRunners}
              pnl={detailedSplit.pnlStats}
              onClose={() => setDetailSplit(null)}
              onViewRaces={() => {}}
            />
          )}
          <ScrollView contentContainerStyle={styles.scrollContent}>
            <SplitCard
              id="a"
              label="Split A"
              split={result.splitA!}
              onDetails={() => setDetailSplit("a")}
              onGraph={() => setGraphSplit("a")}
            />
            <SplitCard
              id="b"
              label="Split B"
              split={result.splitB!}
              onDetails={() => setDetailSplit("b")}
              onGraph={() => setGraphSplit("b")}
            />
          </ScrollView>
          <View style={styles.actionsRow}>
            <Button testID="saved-result-detail-restore" mode="contained" buttonColor={colors.accent} onPress={() => onRestore(result.filters)} style={styles.actionButton}>
              Restore filters
            </Button>
            <Button testID="saved-result-detail-delete" mode="outlined" textColor={colors.danger} onPress={handleDelete} style={styles.actionButton}>
              Delete
            </Button>
          </View>
        </View>
      )}
      {!loading && !error && result && graphedSplit != null && (
        <PnlConvergencePanel
          points={graphedSplit.graphPoints}
          loading={false}
          error={null}
          filters={buildFilterSummaryFromParams(result.filters)}
          onClose={() => setGraphSplit(null)}
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md },
  errorText: { color: colors.danger },
  backButton: { marginTop: spacing.md },
  legacyNoticeText: { fontSize: 14, color: colors.textSecondary, textAlign: "center" },
  detailContainer: { flex: 1, position: "relative" },
  scrollContent: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl * 3 },
  splitCard: {
    backgroundColor: colors.text,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  splitCardLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "rgba(255,255,255,0.85)",
  },
  splitEmptyText: {
    fontSize: 12,
    color: "rgba(255,255,255,0.5)",
  },
  pnlHeadline: {
    fontSize: 18,
    fontWeight: "700",
  },
  pnlPct: {
    fontSize: 13,
    fontWeight: "400",
    opacity: 0.8,
  },
  pnlPos: {
    color: colors.pnlPositive,
  },
  pnlNeg: {
    color: colors.pnlNegative,
  },
  splitButtonRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  splitDetailsButton: {
    borderRadius: radii.sm,
    borderColor: "rgba(255,255,255,0.4)",
  },
  splitDetailsButtonLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: "#fff",
  },
  actionsRow: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 200,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  actionButton: { flexGrow: 1, minWidth: 160 },
});
