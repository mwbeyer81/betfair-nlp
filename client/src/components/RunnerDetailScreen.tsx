import React, { useState, useEffect } from "react";
import { View, ScrollView, TouchableOpacity, StyleSheet, SafeAreaView } from "react-native";
import { Text, Appbar, Button, ActivityIndicator } from "react-native-paper";
import { chatApi, IspRace, IspRunner } from "../services/chatApi";
import { colors, statusPill, radii, spacing } from "../theme";
import { PageContainer } from "./PageContainer";
import {
  stakeToWin1,
  formatGbp,
  formatPnl,
  formatPct,
  formatIsp,
  runnerPnl,
  formatRaceTime,
  formatRaceDate,
  toFormCategory,
  OddsMode,
} from "../utils/ispFormat";

interface RunnerDetailScreenProps {
  raceId: number;
  runnerId: number;
  onBack: () => void;
  onNavigateToHistory: (runnerName: string) => void;
  onNavigateToTrainer: (trainer: string, formCategory: "Flat" | "Jumps") => void;
}

function DetailRow({ label, value, testID }: { label: string; value: string; testID?: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text testID={testID} style={styles.detailValue}>{value}</Text>
    </View>
  );
}

export const RunnerDetailScreen: React.FC<RunnerDetailScreenProps> = ({
  raceId,
  runnerId,
  onBack,
  onNavigateToHistory,
  onNavigateToTrainer,
}) => {
  const [race, setRace] = useState<IspRace | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [oddsMode, setOddsMode] = useState<OddsMode>("fraction");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const data = await chatApi.getIspRace(raceId);
        if (!cancelled) setRace(data);
      } catch {
        if (!cancelled) setError("Failed to load runner");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [raceId]);

  const runner: IspRunner | undefined = race?.runners.find(r => r.id === runnerId);
  const pnl = runner ? runnerPnl(runner) : null;

  return (
    <SafeAreaView testID="runner-detail-screen" style={styles.screen}>
      <Appbar.Header style={styles.appbar}>
        <Appbar.Content
          title={runner ? runner.name : "Runner"}
          subtitle={race ? `${race.course} · ${formatRaceDate(race.raceTime)}` : undefined}
          titleStyle={styles.appbarTitle}
          subtitleStyle={styles.appbarSubtitle}
        />
        <Button
          testID="runner-detail-back"
          mode="contained"
          compact
          buttonColor={colors.accent}
          onPress={onBack}
          style={styles.headerButton}
          labelStyle={styles.headerButtonLabel}
        >
          ← Back
        </Button>
      </Appbar.Header>

      {isLoading && (
        <View testID="runner-detail-loading" style={styles.centered}>
          <ActivityIndicator size="large" animating color={colors.primary} />
          <Text variant="bodyMedium" style={styles.loadingText}>Loading runner…</Text>
        </View>
      )}

      {error && !isLoading && (
        <View testID="runner-detail-error" style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {!isLoading && !error && race && !runner && (
        <View testID="runner-detail-not-found" style={styles.centered}>
          <Text style={styles.errorText}>Runner not found in this race.</Text>
        </View>
      )}

      {!isLoading && !error && race && runner && (
        <ScrollView testID="runner-detail-list" style={styles.list}>
          <PageContainer>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Race</Text>
              <DetailRow label="Course" value={race.course} testID="runner-detail-course" />
              <DetailRow label="Time" value={`${formatRaceTime(race.raceTime)} · ${formatRaceDate(race.raceTime)}`} />
              <DetailRow label="Type" value={race.raceType} />
              <DetailRow label="Class" value={race.raceClass ?? "—"} />
              <DetailRow label="Going" value={race.going ?? "—"} />
              <DetailRow label="Race Name" value={race.raceName} />
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Runner</Text>
              <View style={styles.statusRow}>
                <View
                  style={[styles.statusBadge, { backgroundColor: (statusPill[runner.status] ?? statusPill.HIDDEN).bg }]}
                >
                  <Text
                    testID="runner-detail-status"
                    style={[styles.statusText, { color: (statusPill[runner.status] ?? statusPill.HIDDEN).fg }]}
                  >
                    {runner.status}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => setOddsMode(m => (m === "fraction" ? "decimal" : "fraction"))}>
                  <Text testID="runner-detail-odds-mode-toggle" style={styles.oddsToggle}>
                    {oddsMode === "fraction" ? "Odds: Fraction" : "Odds: Decimal"}
                  </Text>
                </TouchableOpacity>
              </View>
              <DetailRow label="Number" value={runner.num != null ? String(runner.num) : "—"} />
              <DetailRow label="Draw" value={runner.draw != null ? String(runner.draw) : "—"} />
              <DetailRow label="Position" value={String(runner.sortPriority)} />
              {runner.isp != null && (
                <>
                  <DetailRow label="ISP" value={formatIsp(runner, oddsMode)} testID="runner-detail-isp" />
                  <DetailRow label="Favourite" value={runner.isFavourite ? "Yes" : "No"} />
                  <DetailRow label="Stake to win £1" value={formatGbp(stakeToWin1(runner.isp))} />
                  {pnl != null && (
                    <DetailRow
                      label="P&L"
                      value={`${formatPnl(pnl)} (${formatPct(pnl, stakeToWin1(runner.isp))})`}
                      testID="runner-detail-pnl"
                    />
                  )}
                </>
              )}
              {runner.jockey && <DetailRow label="Jockey" value={runner.jockey} />}
            </View>

            {runner.trainer && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Trainer</Text>
                <TouchableOpacity
                  testID="runner-detail-trainer-link"
                  onPress={() => onNavigateToTrainer(runner.trainer!, toFormCategory(race.raceType))}
                >
                  <Text style={styles.trainerLink}>{runner.trainer} →</Text>
                </TouchableOpacity>
                {runner.trainerFormRuns != null && runner.trainerFormRuns > 0 && runner.trainerFormWinRate != null ? (
                  <Text testID="runner-detail-trainer-form" style={styles.trainerFormText}>
                    {runner.trainerFormWins}/{runner.trainerFormRuns} wins in the last 14 days ({runner.trainerFormWinRate.toFixed(0)}%)
                  </Text>
                ) : (
                  <Text style={styles.trainerFormText}>No recent form sample.</Text>
                )}
              </View>
            )}

            <Button
              testID="runner-detail-view-history"
              mode="contained"
              onPress={() => onNavigateToHistory(runner.name)}
              style={styles.historyButton}
            >
              View full runner history →
            </Button>
          </PageContainer>
        </ScrollView>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  appbar: { backgroundColor: colors.primary, elevation: 4 },
  appbarTitle: { color: "white", fontSize: 18, fontWeight: "700" },
  appbarSubtitle: { color: "rgba(255,255,255,0.8)", fontSize: 11 },
  headerButton: { marginHorizontal: 3, borderRadius: radii.md },
  headerButtonLabel: { fontSize: 11, fontWeight: "600" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xxl, gap: spacing.md },
  loadingText: { color: colors.textSecondary },
  errorText: { color: colors.danger, fontSize: 16 },
  list: { flex: 1, ...({ overscrollBehavior: "contain" } as any) },
  section: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    marginHorizontal: spacing.lg,
  },
  sectionTitle: { fontSize: 13, fontWeight: "700", color: colors.accent, marginBottom: spacing.sm },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  detailLabel: { fontSize: 13, color: colors.textSecondary },
  detailValue: { fontSize: 13, color: colors.text, fontWeight: "500", flexShrink: 1, textAlign: "right" },
  statusRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm },
  statusBadge: { borderRadius: radii.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  statusText: { fontSize: 11, fontWeight: "600" },
  oddsToggle: { fontSize: 12, fontWeight: "600", color: colors.primary },
  trainerLink: { fontSize: 15, fontWeight: "700", color: colors.primary },
  trainerFormText: { fontSize: 12, color: colors.textSecondary, marginTop: 4 },
  historyButton: { margin: spacing.lg, borderRadius: radii.md },
});
