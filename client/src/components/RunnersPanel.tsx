import React from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { Race, Runner } from "../services/chatApi";

interface RunnersPanelProps {
  eventId: string;
  eventName: string;
  races: Race[];
  isLoading: boolean;
  error: string | null;
  onClose: () => void;
  onRunnerSelect?: (runnerId: number, runnerName: string) => void;
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

export const RunnersPanel: React.FC<RunnersPanelProps> = ({
  eventId,
  eventName,
  races,
  isLoading,
  error,
  onClose,
  onRunnerSelect,
}) => {
  const totalRunners = races.reduce((sum, r) => sum + r.runners.length, 0);
  const subtitle =
    races.length === 1
      ? `Runners · ${totalRunners} runners`
      : `${races.length} races · ${totalRunners} runners`;

  return (
    <View testID="runners-panel" style={styles.panel}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>
            {eventName}
          </Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
        <TouchableOpacity
          testID="runners-panel-close"
          onPress={onClose}
          style={styles.closeButton}
        >
          <Text style={styles.closeText}>✕</Text>
        </TouchableOpacity>
      </View>

      {isLoading && (
        <View testID="runners-loading" style={styles.centered}>
          <ActivityIndicator size="small" color="#28a745" />
          <Text style={styles.loadingText}>Loading runners...</Text>
        </View>
      )}

      {error && !isLoading && (
        <View testID="runners-error" style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {!isLoading && !error && (
        <ScrollView testID="runners-list" style={styles.list}>
          {races.length === 0 && (
            <Text style={styles.emptyText}>No runners found.</Text>
          )}
          {races.map((race) => (
            <View key={race.marketId} testID={`race-section-${race.marketId}`}>
              {races.length > 1 && (
                <View style={styles.raceHeader}>
                  <Text style={styles.raceTime}>{formatRaceTime(race.marketTime)}</Text>
                  <Text style={styles.raceType}>{race.marketType}</Text>
                  <Text style={styles.raceCount}>{race.runners.length} runners</Text>
                </View>
              )}
              {race.runners.map((runner: Runner) => (
                <TouchableOpacity
                  key={runner.id}
                  testID={`runner-item-${runner.id}`}
                  style={styles.item}
                  onPress={() => onRunnerSelect?.(runner.id, runner.name)}
                  activeOpacity={onRunnerSelect ? 0.7 : 1}
                >
                  <View style={styles.itemRow}>
                    <Text style={styles.priority}>{runner.sortPriority}.</Text>
                    <Text style={styles.runnerName} numberOfLines={1}>
                      {runner.name}
                    </Text>
                    {runner.bsp != null && (
                      <Text testID={`runner-bsp-${runner.id}`} style={styles.bspBadge}>
                        SP {runner.bsp}
                      </Text>
                    )}
                    <View
                      style={[
                        styles.statusBadge,
                        { backgroundColor: STATUS_COLOR[runner.status] ?? "#6c757d" },
                      ]}
                    >
                      <Text style={styles.statusText}>{runner.status}</Text>
                    </View>
                    {onRunnerSelect && <Text style={styles.chevron}>›</Text>}
                  </View>
                  <Text style={styles.meta}>ID: {runner.id}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  panel: {
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: "#e0e0e0",
    maxHeight: 400,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
    backgroundColor: "#f0fff4",
  },
  headerText: {
    flex: 1,
    marginRight: 8,
  },
  title: {
    fontSize: 15,
    fontWeight: "600",
    color: "#222",
  },
  subtitle: {
    fontSize: 12,
    color: "#888",
    marginTop: 1,
  },
  closeButton: {
    padding: 4,
  },
  closeText: {
    fontSize: 16,
    color: "#666",
  },
  centered: {
    alignItems: "center",
    padding: 16,
  },
  loadingText: {
    marginTop: 8,
    color: "#666",
    fontSize: 14,
  },
  errorText: {
    color: "#d9534f",
    fontSize: 14,
  },
  list: {
    flex: 1,
  },
  emptyText: {
    padding: 16,
    color: "#999",
    fontSize: 14,
  },
  raceHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 6,
    backgroundColor: "#f8f9fa",
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
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
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  raceCount: {
    fontSize: 11,
    color: "#999",
    marginLeft: "auto",
  },
  item: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 2,
  },
  priority: {
    fontSize: 12,
    color: "#999",
    width: 22,
  },
  runnerName: {
    fontSize: 13,
    fontWeight: "600",
    color: "#222",
    flex: 1,
    marginRight: 8,
  },
  statusBadge: {
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  statusText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "600",
  },
  meta: {
    fontSize: 11,
    color: "#aaa",
    marginLeft: 22,
  },
  chevron: {
    fontSize: 18,
    color: "#aaa",
    marginLeft: 6,
  },
  bspBadge: {
    fontSize: 11,
    fontWeight: "700",
    color: "#0056b3",
    backgroundColor: "#e8f0fe",
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    marginRight: 6,
  },
});
