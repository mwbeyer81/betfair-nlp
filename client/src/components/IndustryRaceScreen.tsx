import React, { useState, useEffect } from "react";
import { View, ScrollView, StyleSheet, SafeAreaView } from "react-native";
import { Text, Appbar, Button, ActivityIndicator } from "react-native-paper";
import { chatApi, IspRace, IspRunner } from "../services/chatApi";
import { colors, statusPill, radii, spacing } from "../theme";
import {
  stakeToWin1,
  formatGbp,
  formatPnl,
  formatPct,
  formatIsp,
  computeRangePnl,
  runnerPnl,
  formatRaceTime,
  formatRaceDate,
  OddsMode,
} from "../utils/ispFormat";

interface IndustryRaceScreenProps {
  raceId: number;
  onNavigateToMeeting: (meetingId: string) => void;
  onNavigateToIsp: () => void;
}

export const IndustryRaceScreen: React.FC<IndustryRaceScreenProps> = ({
  raceId,
  onNavigateToMeeting,
  onNavigateToIsp,
}) => {
  const [race, setRace] = useState<IspRace | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [oddsMode, setOddsMode] = useState<OddsMode>("fraction");

  useEffect(() => {
    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const data = await chatApi.getIspRace(raceId);
        setRace(data);
      } catch {
        setError("Failed to load race");
      } finally {
        setIsLoading(false);
      }
    })();
  }, [raceId]);

  const racePnl = race ? computeRangePnl([race]) : { staked: 0, returns: 0, pnl: 0, count: 0 };

  return (
    <SafeAreaView testID="industry-race-screen" style={styles.screen}>
      <Appbar.Header style={styles.appbar}>
        <Appbar.Content
          title={race ? `${race.course} ${formatRaceTime(race.raceTime)}` : "Race"}
          subtitle={race ? `${formatRaceDate(race.raceTime)} · ${race.raceType}` : undefined}
          titleStyle={styles.appbarTitle}
          subtitleStyle={styles.appbarSubtitle}
        />
        <Button
          testID="industry-race-back"
          mode="contained"
          compact
          buttonColor={colors.accent}
          onPress={() => (race ? onNavigateToMeeting(race.meetingId) : onNavigateToIsp())}
          style={styles.headerButton}
          labelStyle={styles.headerButtonLabel}
        >
          ← Meeting
        </Button>
      </Appbar.Header>

      <View testID="industry-race-toolbar" style={styles.toolbar}>
        <Button
          testID="industry-race-odds-mode-toggle"
          mode="outlined"
          compact
          onPress={() => setOddsMode(m => (m === "fraction" ? "decimal" : "fraction"))}
          style={styles.toolbarButton}
          labelStyle={styles.toolbarButtonLabel}
        >
          {oddsMode === "fraction" ? "Odds: Fraction" : "Odds: Decimal"}
        </Button>
      </View>

      {!isLoading && race && (
        <View testID="industry-race-header" style={styles.raceInfoBar}>
          <Text style={styles.raceInfoName}>{race.raceName}</Text>
          <Text style={styles.raceInfoMeta}>{race.ran} runners</Text>
        </View>
      )}

      {!isLoading && racePnl.staked > 0 && (
        <View testID="industry-race-pnl-bar" style={styles.pnlBar}>
          <Text style={styles.pnlLabel}>Stake to win £1 per runner</Text>
          <View style={styles.pnlStats}>
            <Text testID="industry-race-pnl-count" style={styles.pnlStat}>
              <Text style={styles.pnlStatLabel}>Horses </Text>{racePnl.count}
            </Text>
            <Text style={styles.pnlStat}>
              <Text style={styles.pnlStatLabel}>Staked </Text>{formatGbp(racePnl.staked)}
            </Text>
            <Text style={styles.pnlStat}>
              <Text style={styles.pnlStatLabel}>Return </Text>{formatGbp(racePnl.returns)}
            </Text>
            <Text testID="industry-race-pnl" style={[styles.pnlValue, racePnl.pnl >= 0 ? styles.pnlPos : styles.pnlNeg]}>
              {formatPnl(racePnl.pnl)}{" "}
              <Text style={[styles.pnlPct, racePnl.pnl >= 0 ? styles.pnlPos : styles.pnlNeg]}>
                ({formatPct(racePnl.pnl, racePnl.staked)})
              </Text>
            </Text>
          </View>
        </View>
      )}

      <View style={styles.body}>
        {isLoading && (
          <View testID="industry-race-loading" style={styles.centered}>
            <ActivityIndicator size="large" animating color={colors.primary} />
            <Text variant="bodyMedium" style={styles.loadingText}>
              Loading race…
            </Text>
          </View>
        )}

        {error && !isLoading && (
          <View testID="industry-race-error" style={styles.centered}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {!isLoading && !error && race && (
          <ScrollView testID="industry-race-list" style={styles.list}>
            {race.runners.length === 0 && (
              <Text style={styles.emptyText}>No runners found.</Text>
            )}
            {race.runners.map((runner: IspRunner) => (
              <View
                key={runner.id}
                testID={`industry-race-item-${runner.id}`}
                style={styles.runnerRow}
              >
                <Text style={styles.priority}>{runner.sortPriority}.</Text>
                <Text style={styles.runnerName} numberOfLines={1}>
                  {runner.name}
                </Text>
                {runner.isp != null && (
                  <Text testID={`industry-race-isp-${runner.id}`} style={styles.bspBadge}>
                    ISP {formatIsp(runner, oddsMode)}
                  </Text>
                )}
                {runner.isp != null && (
                  <Text style={styles.stakeBadge}>
                    Bet {formatGbp(stakeToWin1(runner.isp))}
                  </Text>
                )}
                {runnerPnl(runner) != null && (
                  <Text
                    style={[styles.runnerPnl, runnerPnl(runner)! >= 0 ? styles.pnlPos : styles.pnlNeg]}
                  >
                    {formatPnl(runnerPnl(runner)!)}
                  </Text>
                )}
                <View
                  style={[
                    styles.statusBadge,
                    { backgroundColor: (statusPill[runner.status] ?? statusPill.HIDDEN).bg },
                  ]}
                >
                  <Text style={[styles.statusText, { color: (statusPill[runner.status] ?? statusPill.HIDDEN).fg }]}>
                    {runner.status}
                  </Text>
                </View>
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
    backgroundColor: colors.background,
  },
  appbar: {
    backgroundColor: colors.primary,
    elevation: 4,
  },
  appbarTitle: {
    color: "white",
    fontSize: 18,
    fontWeight: "700",
  },
  appbarSubtitle: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 11,
  },
  headerButton: {
    marginHorizontal: 3,
    borderRadius: radii.md,
  },
  headerButtonLabel: {
    fontSize: 11,
    fontWeight: "600",
  },
  toolbar: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  toolbarButton: {
    borderRadius: radii.sm,
    borderColor: colors.primary,
  },
  toolbarButtonLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.primary,
  },
  raceInfoBar: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md - 2,
    backgroundColor: colors.primaryLight,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  raceInfoName: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.accent,
  },
  raceInfoMeta: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  pnlBar: {
    backgroundColor: colors.text,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 4,
  },
  pnlLabel: {
    fontSize: 11,
    color: "rgba(255,255,255,0.5)",
    marginRight: spacing.sm,
  },
  pnlStats: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    flexShrink: 1,
    minWidth: 0,
    gap: 10,
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
  pnlPct: {
    fontSize: 12,
    fontWeight: "400",
    opacity: 0.8,
  },
  pnlPos: {
    color: colors.pnlPositive,
  },
  pnlNeg: {
    color: colors.pnlNegative,
  },
  body: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xxl,
    gap: spacing.md,
  },
  loadingText: {
    color: colors.textSecondary,
  },
  errorText: {
    color: colors.danger,
    fontSize: 16,
  },
  list: {
    flex: 1,
    ...({ overscrollBehavior: "contain" } as any),
  },
  emptyText: {
    padding: spacing.xl,
    color: colors.textTertiary,
    fontSize: 16,
    textAlign: "center",
  },
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
  },
  priority: {
    fontSize: 12,
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
    paddingVertical: 2,
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
    fontSize: 11,
    color: colors.textSecondary,
    backgroundColor: colors.background,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: radii.sm,
    marginRight: spacing.sm,
  },
  runnerPnl: {
    fontSize: 12,
    fontWeight: "700",
    marginRight: spacing.sm,
  },
});
