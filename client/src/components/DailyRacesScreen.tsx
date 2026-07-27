import React, { useState, useEffect } from "react";
import { View, ScrollView, TouchableOpacity, StyleSheet, SafeAreaView } from "react-native";
import { Text, ActivityIndicator } from "react-native-paper";
import { chatApi, DailyRace } from "../services/chatApi";
import { colors, radii, spacing } from "../theme";
import { PageContainer } from "./PageContainer";
import { AppHeader } from "./AppHeader";
import type { Route } from "../hooks/useRouter";

interface DailyRacesScreenProps {
  navigate: (to: Route, query?: string) => void;
  isAuthenticated: boolean;
  onLogout?: () => void;
  onNavigateToEvent: (eventId: string) => void;
  // "YYYY-MM-DD" — omit to let the backend default to its own current date.
  date?: string;
}

interface EventGroup {
  eventId: string;
  course: string;
  date: string;
  races: DailyRace[];
}

function groupByEvent(races: DailyRace[]): EventGroup[] {
  const byId = new Map<string, EventGroup>();
  for (const race of races) {
    const existing = byId.get(race.eventId);
    if (existing) {
      existing.races.push(race);
    } else {
      byId.set(race.eventId, { eventId: race.eventId, course: race.course, date: race.date, races: [race] });
    }
  }
  return Array.from(byId.values()).sort((a, b) => a.course.localeCompare(b.course));
}

export const DailyRacesScreen: React.FC<DailyRacesScreenProps> = ({
  navigate,
  isAuthenticated,
  onLogout,
  onNavigateToEvent,
  date,
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
        const data = await chatApi.getDailyRaces(date);
        if (!cancelled) setRaces(data);
      } catch {
        if (!cancelled) setError("Failed to load daily races");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [date]);

  const events = groupByEvent(races);

  return (
    <SafeAreaView testID="daily-races-screen" style={styles.screen}>
      <AppHeader
        navigate={navigate}
        isAuthenticated={isAuthenticated}
        onLogout={onLogout}
        subtitle={!isLoading ? `Daily Races · ${events.length} events · ${races.length} races` : "Daily Races"}
        testIdPrefix="daily-races"
      />

      <View style={styles.body}>
        {isLoading && (
          <View testID="daily-races-loading" style={styles.centered}>
            <ActivityIndicator size="large" animating color={colors.primary} />
            <Text variant="bodyMedium" style={styles.loadingText}>Loading today's races…</Text>
          </View>
        )}

        {error && !isLoading && (
          <View testID="daily-races-error" style={styles.centered}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {!isLoading && !error && (
          <ScrollView testID="daily-races-list" style={styles.list}>
            <PageContainer>
              {events.length === 0 && (
                <Text testID="daily-races-empty" style={styles.emptyText}>No races found for today.</Text>
              )}
              {events.map(event => (
                <TouchableOpacity
                  key={event.eventId}
                  testID={`daily-races-event-${event.eventId}`}
                  style={styles.eventRow}
                  onPress={() => onNavigateToEvent(event.eventId)}
                >
                  <Text style={styles.eventCourse}>{event.course}</Text>
                  <Text style={styles.eventDate}>{event.date}</Text>
                  <Text style={styles.eventCount}>{event.races.length} races</Text>
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
  eventRow: {
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
  eventCourse: { fontSize: 15, fontWeight: "700", color: colors.text },
  eventDate: { fontSize: 12, color: colors.textSecondary },
  eventCount: { fontSize: 12, color: colors.textTertiary, marginLeft: "auto" },
});
