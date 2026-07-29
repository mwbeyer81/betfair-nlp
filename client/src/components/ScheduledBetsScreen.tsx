import React from "react";
import { View, ScrollView, StyleSheet, SafeAreaView } from "react-native";
import { Text, Button, Surface } from "react-native-paper";
import { PageContainer } from "./PageContainer";
import { AppHeader } from "./AppHeader";
import { colors, radii, spacing, statusPill } from "../theme";
import { BetOrder, BET_ORDER_STATUS_LABEL, formatBetOrderCondition } from "../utils/betOrderFormat";
import type { Route } from "../hooks/useRouter";

interface ScheduledBetsScreenProps {
  navigate: (to: Route, query?: string) => void;
  isAuthenticated: boolean;
  onLogout?: () => void;
  onBack: () => void;
  // Mock, in-memory data for this phase — no backend/chatApi call yet (see
  // AGENTS.md: there is no live Betfair price feed or bet-placement
  // infrastructure in this codebase at all). App.tsx owns the actual state.
  bets: BetOrder[];
  onCancelBet: (id: string) => void;
}

export const ScheduledBetsScreen: React.FC<ScheduledBetsScreenProps> = ({
  navigate,
  isAuthenticated,
  onLogout,
  onBack,
  bets,
  onCancelBet,
}) => {
  return (
    <SafeAreaView testID="scheduled-bets-screen" style={styles.screen}>
      <AppHeader
        navigate={navigate}
        isAuthenticated={isAuthenticated}
        onLogout={onLogout}
        onBack={onBack}
        subtitle="Scheduled Bets"
        testIdPrefix="scheduled-bets"
      />

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <PageContainer>
          {bets.length === 0 && (
            <View testID="scheduled-bets-empty" style={styles.centered}>
              <Text style={styles.emptyText}>
                No scheduled bets yet — tap "Bet" on a Today's Pick to set one up.
              </Text>
            </View>
          )}
          {bets.length > 0 && (
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
                    {bet.status === "pending" && (
                      <Button
                        testID={`scheduled-bet-cancel-${bet.id}`}
                        compact
                        mode="outlined"
                        onPress={() => onCancelBet(bet.id)}
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
  meta: { fontSize: 12, color: colors.textSecondary },
  condition: { fontSize: 13, color: colors.text },
  cancelButton: {
    alignSelf: "flex-start",
    borderRadius: radii.button,
    borderColor: colors.danger,
    marginTop: spacing.xs,
  },
});
