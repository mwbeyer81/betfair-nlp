import React, { useState, useEffect } from "react";
import {
  View,
  ScrollView,
  StyleSheet,
} from "react-native";
import {
  Text,
  IconButton,
  Button,
  ActivityIndicator,
  Surface,
  Divider,
} from "react-native-paper";
import { chatApi, RaceWithEvent, Runner, PnlStats } from "../services/chatApi";
import { colors, statusPill, radii, spacing } from "../theme";

interface AllRunnersPanelProps {
  races: RaceWithEvent[];
  isLoading: boolean;
  error: string | null;
  onClose: () => void;
}

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
    <Surface testID="all-runners-panel" style={styles.panel} elevation={3}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text variant="bodyMedium" style={styles.title}>
            All Runners
          </Text>
          <Text variant="bodySmall" style={styles.subtitle}>
            {isLoading ? "Loading…" : `${totalRunners} runners · ${visibleRaces.length} races`}
          </Text>
        </View>
        <Button
          testID="all-runners-bsp-toggle"
          mode="outlined"
          compact
          onPress={() => setShowNoBsp(v => !v)}
          style={styles.toggleButton}
          labelStyle={styles.toggleButtonLabel}
        >
          {showNoBsp ? "BSP only" : "Show all"}
        </Button>
        <IconButton
          testID="all-runners-panel-close"
          icon="close"
          size={20}
          onPress={onClose}
          style={styles.closeButton}
        />
      </View>

      <Divider />

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
          <ActivityIndicator size="small" animating color={colors.primary} />
          <Text variant="bodySmall" style={styles.loadingText}>
            Loading runners…
          </Text>
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
                          {
                            backgroundColor:
                              (statusPill[runner.status] ?? statusPill.HIDDEN).bg,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.statusText,
                            { color: (statusPill[runner.status] ?? statusPill.HIDDEN).fg },
                          ]}
                        >
                          {runner.status}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              ))}
            </View>
          ))}
        </ScrollView>
      )}
    </Surface>
  );
};

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    maxHeight: 480,
    width: "100%",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingLeft: spacing.lg,
    paddingRight: spacing.xs,
    paddingVertical: 6,
    backgroundColor: colors.primaryLight,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
    marginRight: spacing.sm,
  },
  title: {
    fontWeight: "700",
    color: colors.text,
  },
  subtitle: {
    color: colors.textSecondary,
    marginTop: 1,
  },
  toggleButton: {
    borderRadius: radii.sm,
    marginRight: spacing.xs,
  },
  toggleButtonLabel: {
    fontSize: 11,
  },
  closeButton: {
    margin: 0,
  },
  pnlBar: {
    backgroundColor: colors.text,
    paddingHorizontal: spacing.md,
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
    color: colors.pnlPositive,
  },
  pnlNeg: {
    color: colors.pnlNegative,
  },
  centered: {
    alignItems: "center",
    padding: spacing.lg,
    gap: spacing.sm,
  },
  loadingText: {
    color: colors.textSecondary,
  },
  errorText: {
    color: colors.danger,
    fontSize: 14,
  },
  list: {
    flex: 1,
  },
  emptyText: {
    padding: spacing.lg,
    color: colors.textTertiary,
    fontSize: 14,
  },
  eventHeader: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.primaryLight,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  eventName: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.accent,
  },
  raceHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: 5,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  raceTime: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.text,
  },
  raceType: {
    fontSize: 11,
    color: colors.textSecondary,
    backgroundColor: colors.surface,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: radii.sm,
  },
  raceCount: {
    fontSize: 11,
    color: colors.textTertiary,
    marginLeft: "auto",
  },
  runnerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  priority: {
    fontSize: 11,
    color: colors.textTertiary,
    width: 22,
  },
  runnerName: {
    fontSize: 13,
    fontWeight: "500",
    color: colors.text,
    flex: 1,
    minWidth: 0,
    marginRight: spacing.sm,
  },
  statusBadge: {
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
  },
  statusText: {
    fontSize: 10,
    fontWeight: "600",
  },
  bspBadge: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.accent,
    backgroundColor: colors.primaryLight,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: radii.sm,
    marginRight: spacing.sm,
  },
  stakeBadge: {
    fontSize: 10,
    color: colors.textSecondary,
    backgroundColor: colors.background,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: radii.sm,
    marginRight: 5,
  },
  runnerPnl: {
    fontSize: 11,
    fontWeight: "700",
    marginRight: spacing.sm,
  },
});
