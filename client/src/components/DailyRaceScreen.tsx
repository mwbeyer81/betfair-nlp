import React, { useState, useEffect } from "react";
import { View, ScrollView, TouchableOpacity, StyleSheet, SafeAreaView } from "react-native";
import { Text, ActivityIndicator } from "react-native-paper";
import { chatApi, DailyRace } from "../services/chatApi";
import { colors, radii, spacing } from "../theme";
import { PageContainer } from "./PageContainer";
import { AppHeader } from "./AppHeader";
import type { Route } from "../hooks/useRouter";

interface DailyRaceScreenProps {
  navigate: (to: Route, query?: string) => void;
  isAuthenticated: boolean;
  onLogout?: () => void;
  raceId: string;
  onNavigateToEvent: (eventId: string) => void;
  onNavigateToRunner: (raceId: string, runnerId: string) => void;
}

export const DailyRaceScreen: React.FC<DailyRaceScreenProps> = ({
  navigate,
  isAuthenticated,
  onLogout,
  raceId,
  onNavigateToEvent,
  onNavigateToRunner,
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
        if (!cancelled) setError("Failed to load race");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [raceId]);

  return (
    <SafeAreaView testID="daily-race-screen" style={styles.screen}>
      <AppHeader
        navigate={navigate}
        isAuthenticated={isAuthenticated}
        onLogout={onLogout}
        onBack={race ? () => onNavigateToEvent(race.eventId) : undefined}
        subtitle={race ? `${race.raceName} · ${race.course} · ${race.offTime}` : "Race"}
        testIdPrefix="daily-race"
      />

      <View style={styles.body}>
        {isLoading && (
          <View testID="daily-race-loading" style={styles.centered}>
            <ActivityIndicator size="large" animating color={colors.primary} />
            <Text variant="bodyMedium" style={styles.loadingText}>Loading race…</Text>
          </View>
        )}

        {error && !isLoading && (
          <View testID="daily-race-error" style={styles.centered}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {!isLoading && !error && race && (
          <ScrollView testID="daily-race-list" style={styles.list}>
            <PageContainer>
              <View style={styles.raceHeader}>
                <Text style={styles.raceMeta}>{race.going ?? "—"} · {race.distanceF ? `${race.distanceF}f` : "—"} · {race.raceClass ?? "—"}</Text>
              </View>
              {race.runners.length === 0 && (
                <Text testID="daily-race-empty" style={styles.emptyText}>No runners declared.</Text>
              )}
              {race.runners.map(runner => (
                <TouchableOpacity
                  key={runner.runnerId}
                  testID={`daily-race-item-${runner.runnerId}`}
                  style={styles.runnerRow}
                  onPress={() => onNavigateToRunner(race.raceId, runner.runnerId)}
                >
                  <Text style={styles.number}>{runner.number ?? "—"}</Text>
                  <Text testID={`daily-race-item-horse-${runner.runnerId}`} style={styles.horseName} numberOfLines={1}>
                    {runner.horse}
                  </Text>
                  {runner.jockey && (
                    <Text style={styles.badge} numberOfLines={1}>{runner.jockey}</Text>
                  )}
                  {runner.trainer && (
                    <Text style={styles.badge} numberOfLines={1}>{runner.trainer}</Text>
                  )}
                  {runner.draw && (
                    <Text style={styles.drawBadge}>Draw {runner.draw}</Text>
                  )}
                  {runner.form && (
                    <Text style={styles.formBadge}>{runner.form}</Text>
                  )}
                </TouchableOpacity>
              ))}
            </PageContainer>
          </ScrollView>
        )}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xxl, gap: spacing.md },
  loadingText: { color: colors.textSecondary },
  errorText: { color: colors.danger, fontSize: 16 },
  list: { flex: 1, ...({ overscrollBehavior: "contain" } as any) },
  emptyText: { padding: spacing.xl, color: colors.textTertiary, fontSize: 16, textAlign: "center" },
  raceHeader: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  raceMeta: { fontSize: 12, color: colors.textSecondary },
  runnerRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    rowGap: 4,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  number: { fontSize: 12, color: colors.textTertiary, width: 22 },
  horseName: { fontSize: 13, fontWeight: "600", color: colors.text, maxWidth: 160 },
  badge: { fontSize: 11, color: colors.textSecondary, maxWidth: 140 },
  drawBadge: { fontSize: 11, color: colors.textTertiary, backgroundColor: colors.background, paddingHorizontal: 5, paddingVertical: 1, borderRadius: radii.sm },
  formBadge: { fontSize: 11, fontWeight: "600", color: colors.accent, backgroundColor: colors.primaryLight, paddingHorizontal: 5, paddingVertical: 1, borderRadius: radii.sm },
});
