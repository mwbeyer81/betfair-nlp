import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  SafeAreaView,
} from "react-native";
import { chatApi, RaceWithEvent, Runner } from "../services/chatApi";

interface AllRunnersScreenProps {
  onNavigateToEvents: () => void;
}

const STATUS_COLOR: Record<string, string> = {
  ACTIVE: "#28a745",
  WINNER: "#ffc107",
  LOSER: "#dc3545",
  HIDDEN: "#6c757d",
  PLACED: "#17a2b8",
};

function formatRaceTime(isoTime: string): string {
  try {
    return new Date(isoTime).toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/London",
    });
  } catch {
    return isoTime;
  }
}

export const AllRunnersScreen: React.FC<AllRunnersScreenProps> = ({
  onNavigateToEvents,
}) => {
  const [races, setRaces] = useState<RaceWithEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        setRaces(await chatApi.getAllRunners());
      } catch {
        setError("Failed to load runners");
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const totalRunners = races.reduce((sum, r) => sum + r.runners.length, 0);

  const byEvent = races.reduce<Record<string, { eventName: string; races: RaceWithEvent[] }>>(
    (acc, race) => {
      if (!acc[race.eventId]) {
        acc[race.eventId] = { eventName: race.eventName, races: [] };
      }
      acc[race.eventId].races.push(race);
      return acc;
    },
    {}
  );

  return (
    <SafeAreaView testID="all-runners-screen" style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>All Runners</Text>
          {!isLoading && (
            <Text style={styles.subtitle}>
              {totalRunners} runners · {races.length} races
            </Text>
          )}
        </View>
        <TouchableOpacity
          testID="all-runners-screen-events-button"
          style={styles.eventsButton}
          onPress={onNavigateToEvents}
        >
          <Text style={styles.eventsButtonText}>← Events</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.body}>
        {isLoading && (
          <View testID="all-runners-loading" style={styles.centered}>
            <ActivityIndicator size="large" color="#007AFF" />
            <Text style={styles.loadingText}>Loading runners…</Text>
          </View>
        )}

        {error && !isLoading && (
          <View testID="all-runners-error" style={styles.centered}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {!isLoading && !error && (
          <ScrollView testID="all-runners-list" style={styles.list}>
            {races.length === 0 && (
              <Text style={styles.emptyText}>No runners found.</Text>
            )}
            {Object.entries(byEvent).map(([eventId, { eventName, races: eventRaces }]) => (
              <View key={eventId} testID={`all-runners-event-${eventId}`}>
                <View style={styles.eventHeader}>
                  <Text style={styles.eventName}>{eventName}</Text>
                </View>
                {eventRaces.map(race => (
                  <View key={race.marketId}>
                    <View
                      testID={`all-runners-race-${race.marketId}`}
                      style={styles.raceHeader}
                    >
                      <Text style={styles.raceTime}>{formatRaceTime(race.marketTime)}</Text>
                      <Text style={styles.raceType}>{race.marketType}</Text>
                      <Text style={styles.raceCount}>{race.runners.length} runners</Text>
                    </View>
                    {race.runners.map((runner: Runner) => (
                      <View
                        key={runner.id}
                        testID={`all-runner-item-${runner.id}`}
                        style={styles.runnerRow}
                      >
                        <Text style={styles.priority}>{runner.sortPriority}.</Text>
                        <Text style={styles.runnerName} numberOfLines={1}>
                          {runner.name}
                        </Text>
                        <View
                          style={[
                            styles.statusBadge,
                            { backgroundColor: STATUS_COLOR[runner.status] ?? "#6c757d" },
                          ]}
                        >
                          <Text style={styles.statusText}>{runner.status}</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                ))}
              </View>
            ))}
          </ScrollView>
        )}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#f8f9fa",
  },
  header: {
    backgroundColor: "#007AFF",
    paddingVertical: 14,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerText: {
    flex: 1,
    marginRight: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: "#fff",
  },
  subtitle: {
    fontSize: 12,
    color: "rgba(255,255,255,0.8)",
    marginTop: 2,
  },
  eventsButton: {
    backgroundColor: "#0056b3",
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  eventsButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  body: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: "#666",
  },
  errorText: {
    color: "#d9534f",
    fontSize: 16,
  },
  list: {
    flex: 1,
  },
  emptyText: {
    padding: 24,
    color: "#999",
    fontSize: 16,
    textAlign: "center",
  },
  eventHeader: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "#e8f0fe",
    borderBottomWidth: 1,
    borderBottomColor: "#c5d4f5",
  },
  eventName: {
    fontSize: 15,
    fontWeight: "700",
    color: "#1a3a6e",
  },
  raceHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 6,
    backgroundColor: "#f8f9fa",
    borderBottomWidth: 1,
    borderBottomColor: "#e9ecef",
    gap: 8,
  },
  raceTime: {
    fontSize: 13,
    fontWeight: "700",
    color: "#333",
  },
  raceType: {
    fontSize: 11,
    color: "#666",
    backgroundColor: "#e9ecef",
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  raceCount: {
    fontSize: 11,
    color: "#999",
    marginLeft: "auto",
  },
  runnerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  priority: {
    fontSize: 12,
    color: "#aaa",
    width: 22,
  },
  runnerName: {
    fontSize: 13,
    fontWeight: "500",
    color: "#222",
    flex: 1,
    marginRight: 8,
  },
  statusBadge: {
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  statusText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "600",
  },
});
