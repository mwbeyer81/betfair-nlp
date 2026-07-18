import React, { useState, useEffect } from "react";
import { View, ScrollView, TouchableOpacity, StyleSheet, SafeAreaView } from "react-native";
import { Text, Appbar, Button, ActivityIndicator } from "react-native-paper";
import { chatApi, IspRace, IspRunner } from "../services/chatApi";
import { colors, statusPill, radii, spacing } from "../theme";
import { PageContainer } from "./PageContainer";
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

interface IndustryMeetingScreenProps {
  meetingId: string;
  onBack: () => void;
  onNavigateToRace: (raceId: number) => void;
}

export const IndustryMeetingScreen: React.FC<IndustryMeetingScreenProps> = ({
  meetingId,
  onBack,
  onNavigateToRace,
}) => {
  const [races, setRaces] = useState<IspRace[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [oddsMode, setOddsMode] = useState<OddsMode>("fraction");

  useEffect(() => {
    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const data = await chatApi.getIspMeeting(meetingId);
        setRaces(data);
      } catch {
        setError("Failed to load meeting");
      } finally {
        setIsLoading(false);
      }
    })();
  }, [meetingId]);

  const meetingName = races[0]?.meetingName ?? "";
  const meetingPnl = computeRangePnl(races);
  const totalRunners = races.reduce((sum, r) => sum + r.runners.length, 0);

  return (
    <SafeAreaView testID="industry-meeting-screen" style={styles.screen}>
      <Appbar.Header style={styles.appbar}>
        <Appbar.Content
          title={meetingName || "Meeting"}
          subtitle={!isLoading ? `${races.length} races · ${totalRunners} runners` : undefined}
          titleStyle={styles.appbarTitle}
          subtitleStyle={styles.appbarSubtitle}
        />
        <Button
          testID="industry-meeting-back"
          mode="contained"
          compact
          buttonColor={colors.accent}
          onPress={onBack}
          style={styles.headerButton}
          labelStyle={styles.headerButtonLabel}
        >
          ← Industry SP
        </Button>
      </Appbar.Header>

      <View testID="industry-meeting-toolbar" style={styles.toolbar}>
        <Button
          testID="industry-meeting-odds-mode-toggle"
          mode="outlined"
          compact
          onPress={() => setOddsMode(m => (m === "fraction" ? "decimal" : "fraction"))}
          style={styles.toolbarButton}
          labelStyle={styles.toolbarButtonLabel}
        >
          {oddsMode === "fraction" ? "Odds: Fraction" : "Odds: Decimal"}
        </Button>
      </View>

      {!isLoading && meetingPnl.staked > 0 && (
        <View testID="industry-meeting-pnl-bar" style={styles.pnlBar}>
          <Text style={styles.pnlLabel}>Stake to win £1 per runner</Text>
          <View style={styles.pnlStats}>
            <Text testID="industry-meeting-pnl-count" style={styles.pnlStat}>
              <Text style={styles.pnlStatLabel}>Horses </Text>{meetingPnl.count}
            </Text>
            <Text style={styles.pnlStat}>
              <Text style={styles.pnlStatLabel}>Staked </Text>{formatGbp(meetingPnl.staked)}
            </Text>
            <Text style={styles.pnlStat}>
              <Text style={styles.pnlStatLabel}>Return </Text>{formatGbp(meetingPnl.returns)}
            </Text>
            <Text testID="industry-meeting-pnl" style={[styles.pnlValue, meetingPnl.pnl >= 0 ? styles.pnlPos : styles.pnlNeg]}>
              {formatPnl(meetingPnl.pnl)}{" "}
              <Text style={[styles.pnlPct, meetingPnl.pnl >= 0 ? styles.pnlPos : styles.pnlNeg]}>
                ({formatPct(meetingPnl.pnl, meetingPnl.staked)})
              </Text>
            </Text>
          </View>
        </View>
      )}

      <View style={styles.body}>
        {isLoading && (
          <View testID="industry-meeting-loading" style={styles.centered}>
            <ActivityIndicator size="large" animating color={colors.primary} />
            <Text variant="bodyMedium" style={styles.loadingText}>
              Loading meeting…
            </Text>
          </View>
        )}

        {error && !isLoading && (
          <View testID="industry-meeting-error" style={styles.centered}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {!isLoading && !error && (
          <ScrollView testID="industry-meeting-list" style={styles.list}>
          <PageContainer>
            {races.length === 0 && (
              <Text style={styles.emptyText}>No races found.</Text>
            )}
            {races.map(race => (
              <View key={race.raceId}>
                <TouchableOpacity
                  testID={`industry-meeting-race-${race.raceId}`}
                  style={styles.raceHeader}
                  onPress={() => onNavigateToRace(race.raceId)}
                >
                  <Text style={styles.raceTime}>{formatRaceTime(race.raceTime)}</Text>
                  <Text style={styles.raceDate}>{formatRaceDate(race.raceTime)}</Text>
                  <Text style={styles.raceType}>{race.raceType}</Text>
                  <Text style={styles.raceCount}>{race.runners.length} runners</Text>
                  {(() => {
                    const rp = computeRangePnl([race]);
                    if (rp.staked === 0) return null;
                    return (
                      <Text style={[styles.racePnl, rp.pnl >= 0 ? styles.pnlPos : styles.pnlNeg]}>
                        {formatPnl(rp.pnl)} ({formatPct(rp.pnl, rp.staked)})
                      </Text>
                    );
                  })()}
                </TouchableOpacity>
                {race.runners.map((runner: IspRunner) => (
                  <View
                    key={runner.id}
                    testID={`industry-meeting-item-${runner.id}`}
                    style={styles.runnerRow}
                  >
                    <Text style={styles.priority}>{runner.sortPriority}.</Text>
                    <Text style={styles.runnerName} numberOfLines={1}>
                      {runner.name}
                    </Text>
                    {runner.isp != null && (
                      <Text testID={`industry-meeting-isp-${runner.id}`} style={styles.bspBadge}>
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
              </View>
            ))}
          </PageContainer>
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
  raceHeader: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    paddingHorizontal: spacing.lg,
    paddingVertical: 6,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  raceTime: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.text,
  },
  raceDate: {
    fontSize: 11,
    color: colors.textSecondary,
    marginLeft: 4,
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
  racePnl: {
    fontSize: 11,
    fontWeight: "700",
    marginLeft: spacing.sm,
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
