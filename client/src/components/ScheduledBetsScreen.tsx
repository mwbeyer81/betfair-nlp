import React, { useEffect, useState } from "react";
import { View, ScrollView, StyleSheet, SafeAreaView } from "react-native";
import { Text, Button, ActivityIndicator, Surface } from "react-native-paper";
import { chatApi, BetOrder } from "../services/chatApi";
import { PageContainer } from "./PageContainer";
import { AppHeader } from "./AppHeader";
import { colors, radii, spacing, statusPill } from "../theme";
import { BET_ORDER_STATUS_LABEL, formatBetOrderCondition } from "../utils/betOrderFormat";
import type { Route } from "../hooks/useRouter";

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
          {!loading && !error && bets.length > 0 && (
            <View testID="scheduled-bets-list" style={styles.list}>
              {bets.map(bet => {
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
  meta: { fontSize: 12, color: colors.textSecondary },
  condition: { fontSize: 13, color: colors.text },
  note: { fontSize: 12, color: colors.textSecondary, fontStyle: "italic" },
  cancelButton: {
    alignSelf: "flex-start",
    borderRadius: radii.button,
    borderColor: colors.danger,
    marginTop: spacing.xs,
  },
});
