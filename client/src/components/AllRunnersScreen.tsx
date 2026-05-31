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
import { chatApi, RaceWithEvent, Runner, PnlStats } from "../services/chatApi";

interface AllRunnersScreenProps {
  onNavigateToEvents: () => void;
  onNavigateToRunner: (eventId: string, runnerId: number, runnerName: string) => void;
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

export const AllRunnersScreen: React.FC<AllRunnersScreenProps> = ({
  onNavigateToEvents,
  onNavigateToRunner,
}) => {
  const [races, setRaces] = useState<RaceWithEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showNoBsp, setShowNoBsp] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalRaces, setTotalRaces] = useState(0);
  const [pnlStats, setPnlStats] = useState<PnlStats>({ staked: 0, returns: 0, pnl: 0 });
  const PAGE_SIZE = 20;

  useEffect(() => {
    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await chatApi.getAllRunners(1, PAGE_SIZE);
        setRaces(result.data);
        setPage(1);
        setTotalPages(result.totalPages);
        setTotalRaces(result.total);
        setPnlStats(result.pnlStats);
      } catch {
        setError("Failed to load runners");
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  async function loadMore() {
    if (isLoadingMore || page >= totalPages) return;
    setIsLoadingMore(true);
    try {
      const next = page + 1;
      const result = await chatApi.getAllRunners(next, PAGE_SIZE);
      setRaces(prev => [...prev, ...result.data]);
      setPage(next);
      setTotalPages(result.totalPages);
    } catch {
      // silently ignore load-more errors
    } finally {
      setIsLoadingMore(false);
    }
  }

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
    <SafeAreaView testID="all-runners-screen" style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>All Runners</Text>
          {!isLoading && (
            <Text style={styles.subtitle}>
              {totalRunners} runners · {visibleRaces.length}/{totalRaces} races
            </Text>
          )}
        </View>
        <TouchableOpacity
          testID="all-runners-bsp-toggle"
          style={[styles.toggleButton, showNoBsp && styles.toggleButtonActive]}
          onPress={() => setShowNoBsp(v => !v)}
        >
          <Text style={styles.toggleButtonText}>
            {showNoBsp ? "BSP only" : "Show all"}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID="all-runners-screen-events-button"
          style={styles.eventsButton}
          onPress={onNavigateToEvents}
        >
          <Text style={styles.eventsButtonText}>← Events</Text>
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
                      <TouchableOpacity
                        key={runner.id}
                        testID={`all-runner-item-${runner.id}`}
                        style={styles.runnerRow}
                        onPress={() => onNavigateToRunner(eventId, runner.id, runner.name)}
                        activeOpacity={0.6}
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
                        <Text style={styles.chevron}>›</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                ))}
              </View>
            ))}
            {page < totalPages && (
              <TouchableOpacity
                testID="all-runners-load-more"
                style={styles.loadMoreButton}
                onPress={loadMore}
                disabled={isLoadingMore}
              >
                {isLoadingMore
                  ? <ActivityIndicator size="small" color="#007AFF" />
                  : <Text style={styles.loadMoreText}>Load more ({totalRaces - races.length} remaining)</Text>
                }
              </TouchableOpacity>
            )}
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
  toggleButton: {
    backgroundColor: "rgba(255,255,255,0.2)",
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 8,
    marginRight: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.4)",
  },
  toggleButtonActive: {
    backgroundColor: "rgba(255,255,255,0.35)",
  },
  toggleButtonText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
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
  pnlBar: {
    backgroundColor: "#1a1a2e",
    paddingHorizontal: 16,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  pnlLabel: {
    fontSize: 11,
    color: "rgba(255,255,255,0.5)",
  },
  pnlStats: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  pnlStat: {
    fontSize: 12,
    color: "rgba(255,255,255,0.75)",
  },
  pnlStatLabel: {
    color: "rgba(255,255,255,0.4)",
  },
  pnlValue: {
    fontSize: 14,
    fontWeight: "700",
  },
  pnlPos: {
    color: "#4caf50",
  },
  pnlNeg: {
    color: "#ef5350",
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
  loadMoreButton: {
    margin: 16,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: "#e8f0fe",
    alignItems: "center",
  },
  loadMoreText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0056b3",
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
    fontSize: 11,
    color: "#555",
    backgroundColor: "#f0f0f0",
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    marginRight: 6,
  },
  chevron: {
    fontSize: 16,
    color: "#bbb",
    marginLeft: 4,
  },
  runnerPnl: {
    fontSize: 12,
    fontWeight: "700",
    marginRight: 6,
  },
});
