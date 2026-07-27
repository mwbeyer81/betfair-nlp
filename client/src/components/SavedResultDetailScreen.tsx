import React, { useEffect, useState } from "react";
import { View, StyleSheet, SafeAreaView } from "react-native";
import { Text, Button, ActivityIndicator } from "react-native-paper";
import { chatApi, SavedFilterSet } from "../services/chatApi";
import { SplitDetailPanel } from "./SplitDetailPanel";
import { PnlConvergencePanel } from "./PnlConvergencePanel";
import { AppHeader } from "./AppHeader";
import { buildFilterSummaryFromParams } from "../utils/ispFormat";
import { colors, spacing } from "../theme";
import type { Route } from "../hooks/useRouter";

interface SavedResultDetailScreenProps {
  navigate: (to: Route, query?: string) => void;
  isAuthenticated: boolean;
  onLogout?: () => void;
  id: string;
  onBack: () => void;
  onRestore: (filters: Record<string, string>) => void;
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
  const [showGraph, setShowGraph] = useState(false);

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
      {!loading && !error && result && !showGraph && (
        <View style={styles.detailContainer}>
          {/* SplitDetailPanel is a full-screen position:"absolute" overlay by
              design (zIndex 100) — the action bar below sits in its own
              higher-zIndex absolute layer so it floats above it, rather than
              being a normal ScrollView sibling that the panel would cover. */}
          <SplitDetailPanel
            id="a"
            label={result.name}
            fromRow={1}
            toRow={result.pnlStats.count}
            totalRaces={result.pnlStats.count}
            totalRunners={result.pnlStats.count}
            pnl={result.pnlStats}
            onClose={onBack}
            onViewRaces={() => {}}
          />
          <View style={styles.actionsRow}>
            <Button testID="saved-result-detail-view-graph" mode="contained" onPress={() => setShowGraph(true)} style={styles.actionButton}>
              View full graph
            </Button>
            <Button testID="saved-result-detail-restore" mode="contained" buttonColor={colors.accent} onPress={() => onRestore(result.filters)} style={styles.actionButton}>
              Restore filters
            </Button>
            <Button testID="saved-result-detail-delete" mode="outlined" textColor={colors.danger} onPress={handleDelete} style={styles.actionButton}>
              Delete
            </Button>
          </View>
        </View>
      )}
      {!loading && !error && result && showGraph && (
        <PnlConvergencePanel
          points={result.graphPoints}
          loading={false}
          error={null}
          filters={buildFilterSummaryFromParams(result.filters)}
          onClose={() => setShowGraph(false)}
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
  detailContainer: { flex: 1, position: "relative" },
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
