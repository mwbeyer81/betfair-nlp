import React, { useEffect, useMemo, useState } from "react";
import { View, ScrollView, StyleSheet, SafeAreaView } from "react-native";
import { Text, Button, ActivityIndicator, Surface, SegmentedButtons } from "react-native-paper";
import { chatApi, BetOrder } from "../services/chatApi";
import { PageContainer } from "./PageContainer";
import { AppHeader } from "./AppHeader";
import { colors, radii, spacing, statusPill } from "../theme";
import { BET_ORDER_STATUS_LABEL, formatBetOrderCondition, formatBetOrderResult, computeSandboxPnl } from "../utils/betOrderFormat";
import type { Route } from "../hooks/useRouter";

type BetsFilter = "all" | "real" | "sandbox";

interface ScheduledBetsScreenProps {
  navigate: (to: Route, query?: string) => void;
  isAuthenticated: boolean;
  onLogout?: () => void;
  onBack: () => void;
}

export const ScheduledBetsScreen: React.FC<ScheduledBetsScreenProps> = ({
  navigate,
  isAuthenticated,
  onLogout,
  onBack,
}) => {
  const [bets, setBets] = useState<BetOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<BetsFilter>("all");

  const filteredBets = useMemo(() => {
    if (filter === "sandbox") return bets.filter(b => b.sandbox === true);
    if (filter === "real") return bets.filter(b => b.sandbox !== true);
    return bets;
  }, [bets, filter]);

  const sandboxPnl = useMemo(() => computeSandboxPnl(bets), [bets]);
  const hasSandboxBets = bets.some(b => b.sandbox === true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    chatApi
      .getBetOrders()
      .then(data => {
        if (!cancelled) setBets(data);
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load scheduled bets.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCancel(id: string) {
    setCancellingId(id);
    try {
      await chatApi.cancelBetOrder(id);
      setBets(prev => prev.map(b => (b.id === id ? { ...b, status: "cancelled" } : b)));
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <SafeAreaView testID="scheduled-bets-screen" style={styles.screen}>
      <AppHeader
        navigate={navigate}
        isAuthenticated={isAuthenticated}
        onLogout={onLogout}
        onBack={onBack}
        subtitle="My Bets"
        testIdPrefix="scheduled-bets"
      />

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <PageContainer>
          {loading && (
            <View testID="scheduled-bets-loading" style={styles.centered}>
              <ActivityIndicator size="large" animating color={colors.primary} />
              <Text style={styles.loadingText}>Loading scheduled bets…</Text>
            </View>
          )}
          {!loading && error && (
            <View testID="scheduled-bets-error" style={styles.centered}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}
          {!loading && !error && bets.length === 0 && (
            <View testID="scheduled-bets-empty" style={styles.centered}>
              <Text style={styles.emptyText}>
                No bets yet — tap "Bet" on a Today's Pick to schedule one or place one instantly.
              </Text>
            </View>
          )}
          {!loading && !error && bets.length > 0 && hasSandboxBets && (
            <View testID="scheduled-bets-filter" style={styles.filterRow}>
              <SegmentedButtons
                value={filter}
                onValueChange={value => setFilter(value as BetsFilter)}
                buttons={[
                  { value: "all", label: "All", testID: "scheduled-bets-filter-all" },
                  { value: "real", label: "Real", testID: "scheduled-bets-filter-real" },
                  { value: "sandbox", label: "Sandbox", testID: "scheduled-bets-filter-sandbox" },
                ]}
              />
            </View>
          )}
          {!loading && !error && bets.length > 0 && filter === "sandbox" && (
            <Surface testID="scheduled-bets-sandbox-pnl" style={styles.pnlCard} elevation={1}>
              <Text style={styles.pnlTitle}>Sandbox P&amp;L</Text>
              <Text style={[styles.pnlValue, { color: sandboxPnl.pnl >= 0 ? colors.success : colors.danger }]}>
                {sandboxPnl.pnl >= 0 ? "+" : "-"}£{Math.abs(sandboxPnl.pnl).toFixed(2)}
              </Text>
              <Text style={styles.pnlMeta}>
                Staked £{sandboxPnl.staked.toFixed(2)} across {sandboxPnl.settledCount} settled bet
                {sandboxPnl.settledCount === 1 ? "" : "s"}
                {sandboxPnl.pendingCount > 0
                  ? ` (${sandboxPnl.pendingCount} more not settled yet — race hasn't run or result not captured)`
                  : ""}
              </Text>
            </Surface>
          )}
          {!loading && !error && bets.length > 0 && filteredBets.length === 0 && (
            <View testID="scheduled-bets-filter-empty" style={styles.centered}>
              <Text style={styles.emptyText}>No {filter} bets to show.</Text>
            </View>
          )}
          {!loading && !error && filteredBets.length > 0 && (
            <View testID="scheduled-bets-list" style={styles.list}>
              {filteredBets.map(bet => {
                const pill = statusPill[bet.status.toUpperCase()] ?? statusPill.HIDDEN;
                return (
                  <Surface key={bet.id} testID={`scheduled-bet-item-${bet.id}`} style={styles.card} elevation={1}>
                    <View style={styles.cardHeader}>
                      <Text variant="titleSmall" style={styles.horseName} numberOfLines={1}>
                        {bet.horse}
                      </Text>
                      <Text
                        testID={`scheduled-bet-order-type-${bet.id}`}
                        style={styles.orderTypeBadge}
                      >
                        {bet.orderType === "instant" ? "Instant" : "Scheduled"}
                      </Text>
                      {bet.sandbox && (
                        <Text testID={`scheduled-bet-sandbox-badge-${bet.id}`} style={styles.sandboxBadge}>
                          Sandbox
                        </Text>
                      )}
                      <Text
                        testID={`scheduled-bet-status-${bet.id}`}
                        style={[styles.statusBadge, { backgroundColor: pill.bg, color: pill.fg }]}
                      >
                        {BET_ORDER_STATUS_LABEL[bet.status]}
                      </Text>
                    </View>
                    <Text style={styles.meta}>{bet.course} · {bet.offTime}</Text>
                    <Text testID={`scheduled-bet-condition-${bet.id}`} style={styles.condition}>
                      {formatBetOrderCondition(bet)}
                    </Text>
                    {formatBetOrderResult(bet) && (
                      <Text
                        testID={`scheduled-bet-result-${bet.id}`}
                        style={[
                          styles.result,
                          { color: bet.betOutcome === "WON" ? colors.success : bet.betOutcome === "LOST" ? colors.danger : colors.textSecondary },
                        ]}
                      >
                        {formatBetOrderResult(bet)}
                      </Text>
                    )}
                    {bet.note && (
                      <Text testID={`scheduled-bet-note-${bet.id}`} style={styles.note}>
                        {bet.note}
                      </Text>
                    )}
                    {(bet.status === "pending" || bet.status === "unmatched") && (
                      <Button
                        testID={`scheduled-bet-cancel-${bet.id}`}
                        compact
                        mode="outlined"
                        loading={cancellingId === bet.id}
                        disabled={cancellingId === bet.id}
                        onPress={() => handleCancel(bet.id)}
                        style={styles.cancelButton}
                        textColor={colors.danger}
                      >
                        Cancel
                      </Button>
                    )}
                  </Surface>
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
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  centered: { alignItems: "center", justifyContent: "center", padding: spacing.xl },
  loadingText: { marginTop: spacing.sm, color: colors.textSecondary },
  errorText: { color: colors.danger },
  emptyText: { color: colors.textSecondary, textAlign: "center" },
  list: { padding: spacing.md, gap: spacing.md },
  card: { borderRadius: radii.md, padding: spacing.md, gap: spacing.xs },
  cardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  horseName: { flex: 1, fontWeight: "700" },
  statusBadge: {
    fontSize: 11,
    fontWeight: "700",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radii.sm,
    overflow: "hidden",
  },
  orderTypeBadge: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.textSecondary,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  sandboxBadge: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.warning,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.warning,
    overflow: "hidden",
  },
  meta: { fontSize: 12, color: colors.textSecondary },
  condition: { fontSize: 13, color: colors.text },
  result: { fontSize: 13, fontWeight: "700" },
  note: { fontSize: 12, color: colors.textSecondary, fontStyle: "italic" },
  filterRow: { paddingHorizontal: spacing.md, paddingTop: spacing.md },
  pnlCard: {
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: 2,
  },
  pnlTitle: { fontSize: 12, fontWeight: "600", color: colors.textSecondary },
  pnlValue: { fontSize: 22, fontWeight: "800" },
  pnlMeta: { fontSize: 12, color: colors.textSecondary },
  cancelButton: {
    alignSelf: "flex-start",
    borderRadius: radii.button,
    borderColor: colors.danger,
    marginTop: spacing.xs,
  },
});
