import React, { useState, useEffect } from "react";
import { View, ScrollView, StyleSheet, SafeAreaView } from "react-native";
import { Text, ActivityIndicator } from "react-native-paper";
import { chatApi, DailyRace, DailyRaceRunner } from "../services/chatApi";
import { colors, radii, spacing } from "../theme";
import { PageContainer } from "./PageContainer";
import { AppHeader } from "./AppHeader";
import type { Route } from "../hooks/useRouter";

interface DailyRunnerDetailScreenProps {
  navigate: (to: Route, query?: string) => void;
  isAuthenticated: boolean;
  onLogout?: () => void;
  raceId: string;
  runnerId: string;
  onBack: () => void;
}

function DetailRow({ label, value, testID }: { label: string; value: string; testID?: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text testID={testID} style={styles.detailValue}>{value}</Text>
    </View>
  );
}

export const DailyRunnerDetailScreen: React.FC<DailyRunnerDetailScreenProps> = ({
  navigate,
  isAuthenticated,
  onLogout,
  raceId,
  runnerId,
  onBack,
}) => {
  const [race, setRace] = useState<DailyRace | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const data = await chatApi.getDailyRace(raceId);
        if (!cancelled) setRace(data);
      } catch {
        if (!cancelled) setError("Failed to load runner");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [raceId]);

  const runner: DailyRaceRunner | undefined = race?.runners.find(r => r.runnerId === runnerId);

  return (
    <SafeAreaView testID="daily-runner-detail-screen" style={styles.screen}>
      <AppHeader
        navigate={navigate}
        isAuthenticated={isAuthenticated}
        onLogout={onLogout}
        onBack={onBack}
        subtitle={runner ? `${runner.horse}${race ? ` · ${race.course}` : ""}` : "Runner"}
        testIdPrefix="daily-runner-detail"
      />

      {isLoading && (
        <View testID="daily-runner-detail-loading" style={styles.centered}>
          <ActivityIndicator size="large" animating color={colors.primary} />
          <Text variant="bodyMedium" style={styles.loadingText}>Loading runner…</Text>
        </View>
      )}

      {error && !isLoading && (
        <View testID="daily-runner-detail-error" style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {!isLoading && !error && race && !runner && (
        <View testID="daily-runner-detail-not-found" style={styles.centered}>
          <Text style={styles.errorText}>Runner not found in this race.</Text>
        </View>
      )}

      {!isLoading && !error && race && runner && (
        <ScrollView testID="daily-runner-detail-list" style={styles.list}>
          <PageContainer>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Race</Text>
              <DetailRow label="Course" value={race.course} testID="daily-runner-detail-course" />
              <DetailRow label="Time" value={`${race.offTime} · ${race.date}`} />
              <DetailRow label="Type" value={race.type ?? "—"} />
              <DetailRow label="Class" value={race.raceClass ?? "—"} />
              <DetailRow label="Going" value={race.going ?? "—"} />
              <DetailRow label="Race Name" value={race.raceName} />
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Runner</Text>
              <DetailRow label="Number" value={runner.number ?? "—"} />
              <DetailRow label="Draw" value={runner.draw ?? "—"} />
              <DetailRow label="Age" value={runner.age ?? "—"} />
              <DetailRow label="Sex" value={runner.sex ?? "—"} />
              <DetailRow label="Colour" value={runner.colour ?? "—"} />
              <DetailRow label="Headgear" value={runner.headgear || "—"} />
              <DetailRow label="Weight (lbs)" value={runner.lbs ?? "—"} />
              <DetailRow label="Official Rating" value={runner.officialRating || "—"} testID="daily-runner-detail-official-rating" />
              <DetailRow label="Form" value={runner.form || "—"} testID="daily-runner-detail-form" />
              <DetailRow label="Days Since Last Run" value={runner.lastRun || "—"} />
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Connections</Text>
              <DetailRow label="Trainer" value={runner.trainer ?? "—"} testID="daily-runner-detail-trainer" />
              <DetailRow label="Jockey" value={runner.jockey ?? "—"} testID="daily-runner-detail-jockey" />
              <DetailRow label="Owner" value={runner.owner ?? "—"} />
              <DetailRow label="Sire" value={runner.sire ?? "—"} />
              <DetailRow label="Dam" value={runner.dam ?? "—"} />
              <DetailRow label="Damsire" value={runner.damsire ?? "—"} />
            </View>
          </PageContainer>
        </ScrollView>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
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
});
