import React, { useState, useEffect } from "react";
import { View, ScrollView, TouchableOpacity, StyleSheet, SafeAreaView } from "react-native";
import { Text, ActivityIndicator } from "react-native-paper";
import { chatApi, DailyRace } from "../services/chatApi";
import { colors, radii, spacing } from "../theme";
import { PageContainer } from "./PageContainer";
import { AppHeader } from "./AppHeader";
import type { Route } from "../hooks/useRouter";

interface DailyRaceEventScreenProps {
  navigate: (to: Route, query?: string) => void;
  isAuthenticated: boolean;
  onLogout?: () => void;
  eventId: string;
  onBack: () => void;
  onNavigateToRace: (raceId: string) => void;
}

export const DailyRaceEventScreen: React.FC<DailyRaceEventScreenProps> = ({
  navigate,
  isAuthenticated,
  onLogout,
  eventId,
  onBack,
  onNavigateToRace,
}) => {
  const [races, setRaces] = useState<DailyRace[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const data = await chatApi.getDailyRacesByEvent(eventId);
        if (!cancelled) setRaces(data);
      } catch {
        if (!cancelled) setError("Failed to load event");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [eventId]);

  const course = races[0]?.course ?? "";
  const date = races[0]?.date ?? "";

  return (
    <SafeAreaView testID="daily-race-event-screen" style={styles.screen}>
      <AppHeader
        navigate={navigate}
        isAuthenticated={isAuthenticated}
        onLogout={onLogout}
        onBack={onBack}
        subtitle={!isLoading ? `${course || "Event"} · ${date} · ${races.length} races` : course || "Event"}
        testIdPrefix="daily-race-event"
      />

      <View style={styles.body}>
        {isLoading && (
          <View testID="daily-race-event-loading" style={styles.centered}>
            <ActivityIndicator size="large" animating color={colors.primary} />
            <Text variant="bodyMedium" style={styles.loadingText}>Loading event…</Text>
          </View>
        )}

        {error && !isLoading && (
          <View testID="daily-race-event-error" style={styles.centered}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {!isLoading && !error && (
          <ScrollView testID="daily-race-event-list" style={styles.list}>
            <PageContainer>
              {races.length === 0 && (
                <Text testID="daily-race-event-empty" style={styles.emptyText}>No races found for this event.</Text>
              )}
              {races.map(race => (
                <TouchableOpacity
                  key={race.raceId}
                  testID={`daily-race-event-race-${race.raceId}`}
                  style={styles.raceRow}
                  onPress={() => onNavigateToRace(race.raceId)}
                >
                  <Text style={styles.raceTime}>{race.offTime}</Text>
                  <Text style={styles.raceName} numberOfLines={1}>{race.raceName}</Text>
                  <Text style={styles.raceMeta}>{race.type ?? "—"}{race.raceClass ? ` · ${race.raceClass}` : ""}</Text>
                  <Text style={styles.raceCount}>{race.runners.length} runners</Text>
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
  raceRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
    borderRadius: radii.md,
    marginBottom: spacing.sm,
    marginHorizontal: spacing.lg,
  },
  raceTime: { fontSize: 14, fontWeight: "700", color: colors.text },
  raceName: { fontSize: 13, color: colors.text, flexShrink: 1, maxWidth: 220 },
  raceMeta: { fontSize: 11, color: colors.textSecondary, backgroundColor: colors.background, paddingHorizontal: 5, paddingVertical: 1, borderRadius: radii.sm },
  raceCount: { fontSize: 11, color: colors.textTertiary, marginLeft: "auto" },
});
