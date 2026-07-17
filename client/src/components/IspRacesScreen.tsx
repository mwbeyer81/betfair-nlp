import React, { useState, useEffect } from "react";
import { View, ScrollView, TouchableOpacity, StyleSheet, SafeAreaView } from "react-native";
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
import {
  urlIntParam,
  urlFloatParam,
  urlToRowParam,
  urlCountriesParam,
  urlSortParam,
  updateUrlParams,
} from "../utils/ispUrlParams";

const PAGE_SIZE = 20;

interface IspRacesScreenProps {
  onBack: () => void;
  onNavigateToMeeting: (meetingId: string) => void;
  onNavigateToRace: (raceId: number) => void;
}

// A read-only view of whatever filters were applied on the Industry SP
// filters screen (/isp) — it reads the committed filter values straight out
// of the URL rather than offering its own editing UI.
export const IspRacesScreen: React.FC<IspRacesScreenProps> = ({
  onBack,
  onNavigateToMeeting,
  onNavigateToRace,
}) => {
  const [races, setRaces] = useState<IspRace[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalRaces, setTotalRaces] = useState(0);
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">(() => urlSortParam());
  const [oddsMode, setOddsMode] = useState<OddsMode>("fraction");

  const minRunners = urlIntParam("minRunners", 1);
  const maxRunners = urlIntParam("maxRunners", 20);
  const fromRow = urlIntParam("fromRow", 1);
  const toRow = urlToRowParam();
  const minIsp = urlFloatParam("minIsp", 1);
  const maxIsp = urlFloatParam("maxIsp", 1000);
  const minRunnersInRange = urlIntParam("minInIspRange", 1);
  const maxRunnersInRange = urlIntParam("maxInIspRange", 30);
  const countries = [...urlCountriesParam()];

  useEffect(() => {
    updateUrlParams({ sort: sortOrder !== "asc" ? sortOrder : undefined });
  }, [sortOrder]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setError(null);
      setRaces([]);
      try {
        const result = await chatApi.getIndustrySp(1, PAGE_SIZE, minRunners, maxRunners, countries, minIsp, maxIsp, sortOrder, minRunnersInRange, maxRunnersInRange, fromRow, toRow ?? undefined);
        if (cancelled) return;
        setRaces(result.data);
        setPage(1);
        setTotalPages(result.totalPages);
        setTotalRaces(result.total);
      } catch {
        if (!cancelled) setError("Failed to load races");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Filter values are read once from the URL on mount — this screen has no
    // editing UI of its own, so only sortOrder (its one interactive control)
    // needs to retrigger the fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortOrder]);

  async function loadMore() {
    if (isLoadingMore || page >= totalPages) return;
    setIsLoadingMore(true);
    try {
      const next = page + 1;
      const result = await chatApi.getIndustrySp(next, PAGE_SIZE, minRunners, maxRunners, countries, minIsp, maxIsp, sortOrder, minRunnersInRange, maxRunnersInRange, fromRow, toRow ?? undefined);
      setRaces(prev => [...prev, ...result.data]);
      setPage(next);
      setTotalPages(result.totalPages);
    } catch {
      // silently ignore
    } finally {
      setIsLoadingMore(false);
    }
  }

  const visibleRaces = races.filter(race => race.runners.length > 0);
  const visibleRunners = visibleRaces.reduce((sum, r) => sum + r.runners.length, 0);

  const byMeeting = visibleRaces.reduce<Record<string, { meetingName: string; races: IspRace[] }>>(
    (acc, race) => {
      if (!acc[race.meetingId]) {
        acc[race.meetingId] = { meetingName: race.meetingName, races: [] };
      }
      acc[race.meetingId].races.push(race);
      return acc;
    },
    {}
  );

  return (
    <SafeAreaView testID="industry-sp-races-screen" style={styles.screen}>
      <Appbar.Header style={styles.appbar}>
        <Appbar.Content
          title="Races"
          subtitle={!isLoading ? `${visibleRunners} runners · ${visibleRaces.length}/${totalRaces} races` : undefined}
          titleStyle={styles.appbarTitle}
          subtitleStyle={styles.appbarSubtitle}
        />
        <Button
          testID="industry-sp-races-back"
          mode="contained"
          compact
          buttonColor={colors.primaryDark}
          onPress={onBack}
          style={styles.headerButton}
          labelStyle={styles.headerButtonLabel}
        >
          ← Filters
        </Button>
      </Appbar.Header>

      <View testID="industry-sp-races-toolbar" style={styles.toolbar}>
        <Button
          testID="industry-sp-sort-toggle"
          mode="contained-tonal"
          compact
          onPress={() => setSortOrder(o => (o === "asc" ? "desc" : "asc"))}
          style={styles.toolbarButton}
          labelStyle={styles.toolbarButtonLabel}
        >
          {sortOrder === "asc" ? "First → Last" : "Last → First"}
        </Button>
        <Button
          testID="industry-sp-odds-mode-toggle"
          mode="outlined"
          compact
          onPress={() => setOddsMode(m => (m === "fraction" ? "decimal" : "fraction"))}
          style={styles.toolbarButtonOutlined}
          labelStyle={styles.toolbarButtonOutlinedLabel}
        >
          {oddsMode === "fraction" ? "Odds: Fraction" : "Odds: Decimal"}
        </Button>
      </View>

      <View style={styles.body}>
        {isLoading && (
          <View testID="industry-sp-loading" style={styles.centered}>
            <ActivityIndicator size="large" animating color={colors.primary} />
            <Text variant="bodyMedium" style={styles.loadingText}>
              Loading races…
            </Text>
          </View>
        )}

        {error && !isLoading && (
          <View testID="industry-sp-error" style={styles.centered}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {!isLoading && !error && (
          <ScrollView testID="industry-sp-list" style={styles.list}>
            {visibleRaces.length === 0 && (
              <Text style={styles.emptyText}>No races found.</Text>
            )}
            {Object.entries(byMeeting).map(([meetingId, { meetingName, races: meetingRaces }]) => (
              <View key={meetingId} testID={`industry-sp-meeting-${meetingId}`}>
                <TouchableOpacity
                  testID={`industry-sp-meeting-link-${meetingId}`}
                  style={styles.eventHeader}
                  onPress={() => onNavigateToMeeting(meetingId)}
                >
                  <Text style={styles.eventName}>{meetingName}</Text>
                </TouchableOpacity>
                {meetingRaces.map(race => (
                  <View key={race.raceId}>
                    <TouchableOpacity
                      testID={`industry-sp-race-${race.raceId}`}
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
                        testID={`industry-sp-item-${runner.id}`}
                        style={styles.runnerRow}
                      >
                        <Text style={styles.priority}>{runner.sortPriority}.</Text>
                        <Text style={styles.runnerName} numberOfLines={1}>
                          {runner.name}
                        </Text>
                        {runner.isp != null && (
                          <Text testID={`industry-sp-isp-${runner.id}`} style={styles.bspBadge}>
                            ISP {formatIsp(runner, oddsMode)}
                          </Text>
                        )}
                        {runner.isp != null && (
                          <Text testID={`industry-sp-stake-${runner.id}`} style={styles.stakeBadge}>
                            Bet {formatGbp(stakeToWin1(runner.isp))}
                          </Text>
                        )}
                        {runnerPnl(runner) != null && (
                          <Text
                            testID={`industry-sp-pnl-item-${runner.id}`}
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
            {page < totalPages && (
              <Button
                testID="industry-sp-load-more"
                mode="contained-tonal"
                onPress={loadMore}
                disabled={isLoadingMore}
                loading={isLoadingMore}
                style={styles.loadMoreButton}
              >
                Load more ({totalRaces - races.length} remaining)
              </Button>
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
  },
  toolbarButtonLabel: {
    fontSize: 12,
    fontWeight: "700",
  },
  toolbarButtonOutlined: {
    borderRadius: radii.sm,
    borderColor: colors.primary,
  },
  toolbarButtonOutlinedLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.primary,
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
  eventHeader: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md - 2,
    backgroundColor: "#EEF2FF",
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  eventName: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.primaryDark,
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
  loadMoreButton: {
    margin: spacing.lg,
    borderRadius: radii.md,
  },
  bspBadge: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.primaryDark,
    backgroundColor: "#EEF2FF",
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
  pnlPos: {
    color: "#4ADE80",
  },
  pnlNeg: {
    color: "#F87171",
  },
});
