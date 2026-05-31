import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { chatApi, RaceWithEvent, Runner, PnlStats } from "../services/chatApi";

interface AllRunnersPanelProps {
  races: RaceWithEvent[];
  isLoading: boolean;
  error: string | null;
  onClose: () => void;
}

const STATUS_COLOR: Record<string, string> = {
  ACTIVE: "#28a745",
  WINNER: "#ffc107",
  LOSER: "#dc3545",
  HIDDEN: "#6c757d",
  PLACED: "#17a2b8",
};

function stakeToWin1(bsp: number): number {
  return 1 / (bsp - 1);
}

function formatGbp(val: number): string {
  return `£${Math.abs(val).toFixed(2)}`;
}

function formatPnl(val: number): string {
  return val >= 0 ? `+${formatGbp(val)}` : `-${formatGbp(val)}`;
}

function runnerPnl(runner: Runner): number | null {
  if (runner.bsp == null) return null;
  return runner.status === "WINNER" ? 1 : -stakeToWin1(runner.bsp);
}

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

export const AllRunnersPanel: React.FC<AllRunnersPanelProps> = ({
  races,
  isLoading,
  error,
  onClose,
}) => {
  const [showNoBsp, setShowNoBsp] = useState(false);
  const [pnlStats, setPnlStats] = useState<PnlStats>({ staked: 0, returns: 0, pnl: 0 });

  useEffect(() => {
    chatApi.getRunnersPnlStats()
      .then(setPnlStats)
      .catch(() => {});
  }, []);

  const { staked, returns, pnl } = pnlStats;

  const visibleRaces = showNoBsp
    ? races
    : races
        .map(race => ({ ...race, runners: race.runners.filter(r => r.bsp != null) }))
        .filter(race => race.runners.length > 0);

  const totalRunners = visibleRaces.reduce((sum, r) => sum + r.runners.length, 0);

  const byEvent = visibleRaces.reduce<Record<string, { eventName: string; races: RaceWithEvent[] }>>(
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
    <View testID="all-runners-panel" style={styles.panel}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>All Runners</Text>
          <Text style={styles.subtitle}>
            {isLoading ? "Loading…" : `${totalRunners} runners · ${visibleRaces.length} races`}
          </Text>
        </View>
        <TouchableOpacity
          testID="all-runners-bsp-toggle"
          onPress={() => setShowNoBsp(v => !v)}
          style={styles.toggleButton}
        >
          <Text style={styles.toggleText}>
            {showNoBsp ? "BSP only" : "Show all"}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID="all-runners-panel-close"
          onPress={onClose}
          style={styles.closeButton}
        >
          <Text style={styles.closeText}>✕</Text>
        </TouchableOpacity>
      </View>

      {!isLoading && staked > 0 && (
        <View testID="all-runners-pnl-bar" style={styles.pnlBar}>
          <Text style={styles.pnlLabel}>Stake to win £1 per runner</Text>
          <View style={styles.pnlStats}>
            <Text style={styles.pnlStat}>
              <Text style={styles.pnlStatLabel}>Staked </Text>{formatGbp(staked)}
            </Text>
            <Text style={styles.pnlStat}>
              <Text style={styles.pnlStatLabel}>Return </Text>{formatGbp(returns)}
            </Text>
            <Text testID="all-runners-pnl" style={[styles.pnlValue, pnl >= 0 ? styles.pnlPos : styles.pnlNeg]}>
              {formatPnl(pnl)}
            </Text>
          </View>
        </View>
      )}

      {isLoading && (
        <View testID="all-runners-loading" style={styles.centered}>
          <ActivityIndicator size="small" color="#007AFF" />
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
          {visibleRaces.length === 0 && (
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
                      {runner.bsp != null && (
                        <Text testID={`all-runner-bsp-${runner.id}`} style={styles.bspBadge}>
                          SP {runner.bsp}
                        </Text>
                      )}
                      {runner.bsp != null && (
                        <Text testID={`all-runner-stake-${runner.id}`} style={styles.stakeBadge}>
                          Bet {formatGbp(stakeToWin1(runner.bsp))}
                        </Text>
                      )}
                      {runnerPnl(runner) != null && (
                        <Text
                          testID={`all-runner-pnl-${runner.id}`}
                          style={[styles.runnerPnl, runnerPnl(runner)! >= 0 ? styles.pnlPos : styles.pnlNeg]}
                        >
                          {formatPnl(runnerPnl(runner)!)}
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
                    </View>
                  ))}
                </View>
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
    maxHeight: 480,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
    backgroundColor: "#f0f4ff",
  },
  headerText: {
    flex: 1,
    marginRight: 8,
  },
  title: {
    fontSize: 15,
    fontWeight: "700",
    color: "#222",
  },
  subtitle: {
    fontSize: 12,
    color: "#888",
    marginTop: 1,
  },
  toggleButton: {
    backgroundColor: "#e8f0fe",
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    marginRight: 8,
  },
  toggleText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#0056b3",
  },
  closeButton: {
    padding: 4,
  },
  closeText: {
    fontSize: 16,
    color: "#666",
  },
  pnlBar: {
    backgroundColor: "#1a1a2e",
    paddingHorizontal: 12,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  pnlLabel: {
    fontSize: 10,
    color: "rgba(255,255,255,0.45)",
  },
  pnlStats: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  pnlStat: {
    fontSize: 11,
    color: "rgba(255,255,255,0.7)",
  },
  pnlStatLabel: {
    color: "rgba(255,255,255,0.35)",
  },
  pnlValue: {
    fontSize: 13,
    fontWeight: "700",
  },
  pnlPos: {
    color: "#4caf50",
  },
  pnlNeg: {
    color: "#ef5350",
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
  eventHeader: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: "#e8f0fe",
    borderBottomWidth: 1,
    borderBottomColor: "#c5d4f5",
  },
  eventName: {
    fontSize: 14,
    fontWeight: "700",
    color: "#1a3a6e",
  },
  raceHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 5,
    backgroundColor: "#f8f9fa",
    borderBottomWidth: 1,
    borderBottomColor: "#e9ecef",
    gap: 8,
  },
  raceTime: {
    fontSize: 12,
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
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#f5f5f5",
  },
  priority: {
    fontSize: 11,
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
    paddingVertical: 1,
  },
  statusText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "600",
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
  stakeBadge: {
    fontSize: 10,
    color: "#555",
    backgroundColor: "#f0f0f0",
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    marginRight: 5,
  },
  runnerPnl: {
    fontSize: 11,
    fontWeight: "700",
    marginRight: 6,
  },
});
