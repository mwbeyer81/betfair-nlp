import React, { useState, useEffect } from "react";
import { View, ScrollView, TouchableOpacity, StyleSheet, SafeAreaView } from "react-native";
import { Text, Button, ActivityIndicator } from "react-native-paper";
import { chatApi, IspRace, IspRunner } from "../services/chatApi";
import { colors, statusPill, radii, spacing } from "../theme";
import { PageContainer } from "./PageContainer";
import { AppHeader } from "./AppHeader";
import type { Route } from "../hooks/useRouter";
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
  raceYearKey,
  raceMonthKey,
  raceMonthLabel,
  raceDayKey,
  toFormCategory,
  OddsMode,
  modelBeatsSp,
  impliedProbabilityPct,
} from "../utils/ispFormat";
import {
  urlIntParam,
  urlFloatParam,
  urlStringParam,
  urlToRowParam,
  urlCountriesParam,
  urlSetParam,
  urlSortParam,
  updateUrlParams,
} from "../utils/ispUrlParams";

const PAGE_SIZE = 20;

interface MeetingNode {
  meetingId: string;
  course: string;
  races: IspRace[];
}
interface DayNode {
  key: string;
  label: string;
  races: IspRace[];
  meetings: MeetingNode[];
}
interface MonthNode {
  key: string;
  label: string;
  races: IspRace[];
  days: DayNode[];
}
interface YearNode {
  key: string;
  races: IspRace[];
  months: MonthNode[];
}

function getOrCreate<K, V>(map: Map<K, V>, key: K, create: () => V): V {
  const existing = map.get(key);
  if (existing) return existing;
  const created = create();
  map.set(key, created);
  return created;
}

// Groups races into a Year → Month → Day → Meeting tree for the collapsible
// results list. Uses Map (not plain objects) at every level — year keys
// like "2015" are numeric-looking strings, and JS reorders integer-like
// object keys ascending regardless of insertion order, which would silently
// break the "Last → First" sort toggle at the year level.
function buildRaceHierarchy(races: IspRace[]): YearNode[] {
  const years = new Map<string, { races: IspRace[]; months: Map<string, { label: string; races: IspRace[]; days: Map<string, { label: string; races: IspRace[]; meetings: Map<string, MeetingNode> }> }> }>();

  for (const race of races) {
    const yearKey = raceYearKey(race.raceTime);
    const monthKey = raceMonthKey(race.raceTime);
    const dayKey = raceDayKey(race.raceTime);

    const year = getOrCreate(years, yearKey, () => ({ races: [], months: new Map() }));
    year.races.push(race);

    const month = getOrCreate(year.months, monthKey, () => ({ label: raceMonthLabel(race.raceTime), races: [], days: new Map() }));
    month.races.push(race);

    const day = getOrCreate(month.days, dayKey, () => ({ label: formatRaceDate(race.raceTime), races: [], meetings: new Map() }));
    day.races.push(race);

    const meeting = getOrCreate(day.meetings, race.meetingId, () => ({ meetingId: race.meetingId, course: race.course, races: [] }));
    meeting.races.push(race);
  }

  return Array.from(years.entries()).map(([yearKey, year]) => ({
    key: yearKey,
    races: year.races,
    months: Array.from(year.months.entries()).map(([monthKey, month]) => ({
      key: monthKey,
      label: month.label,
      races: month.races,
      days: Array.from(month.days.entries()).map(([dayKey, day]) => ({
        key: dayKey,
        label: day.label,
        races: day.races,
        meetings: Array.from(day.meetings.values()),
      })),
    })),
  }));
}

function collectHierarchyNodeKeys(years: YearNode[]): string[] {
  const keys: string[] = [];
  for (const year of years) {
    keys.push(`year:${year.key}`);
    for (const month of year.months) {
      keys.push(`month:${month.key}`);
      for (const day of month.days) {
        keys.push(`day:${day.key}`);
        for (const meeting of day.meetings) {
          keys.push(`meeting:${meeting.meetingId}`);
        }
      }
    }
  }
  return keys;
}

interface IspRacesScreenProps {
  navigate: (to: Route, query?: string) => void;
  isAuthenticated: boolean;
  onLogout?: () => void;
  onRequestAuth?: () => void;
  onBack: () => void;
  onNavigateToMeeting: (meetingId: string) => void;
  onNavigateToRace: (raceId: number) => void;
  onNavigateToRunner: (raceId: number, runnerId: number) => void;
  onNavigateToTrainer: (trainer: string, formCategory: "Flat" | "Jumps") => void;
}

// A read-only view of whatever filters were applied on the Industry SP
// filters screen (/isp) — it reads the committed filter values straight out
// of the URL rather than offering its own editing UI.
export const IspRacesScreen: React.FC<IspRacesScreenProps> = ({
  navigate,
  isAuthenticated,
  onLogout,
  onRequestAuth,
  onBack,
  onNavigateToMeeting,
  onNavigateToRace,
  onNavigateToRunner,
  onNavigateToTrainer,
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
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(new Set());

  const minRunners = urlIntParam("minRunners", 1);
  const maxRunners = urlIntParam("maxRunners", 20);
  const fromRow = urlIntParam("fromRow", 1);
  const toRow = urlToRowParam();
  const minIsp = urlFloatParam("minIsp", 1);
  const maxIsp = urlFloatParam("maxIsp", 1000);
  const minRunnersInRange = urlIntParam("minInIspRange", 1);
  const maxRunnersInRange = urlIntParam("maxInIspRange", 30);
  const minDate = urlStringParam("minDate", "");
  const maxDate = urlStringParam("maxDate", "");
  const countries = [...urlCountriesParam()];
  const courses = [...urlSetParam("courses")];
  const goings = [...urlSetParam("goings")];
  const raceClasses = [...urlSetParam("raceClasses")];
  const raceTypes = [...urlSetParam("raceTypes")];
  const trainer = urlStringParam("trainer", "") || undefined;
  const jockey = urlStringParam("jockey", "") || undefined;
  // "Has trainer form" (IndustrySpScreen) only writes hasTrainerForm=true to
  // the URL, not the raw minTrainerFormRunners/maxTrainerFormRunners the API
  // actually takes — this screen derives them itself rather than reading
  // stale param names, the same way applyFilter() does on that screen.
  const trainerFormMinWinRate = urlFloatParam("trainerFormMinWinRate", 0);
  const hasTrainerForm = urlStringParam("hasTrainerForm", "") === "true";
  const minTrainerFormRunners = hasTrainerForm ? 1 : 0;
  const maxTrainerFormRunners = 100;
  const minModelWinProbability = urlFloatParam("minModelWinProbability", 0);
  const onlyModelBeatsSp = urlStringParam("onlyModelBeatsSp", "") === "true";

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
        const result = await chatApi.getIndustrySp(1, PAGE_SIZE, minRunners, maxRunners, countries, minIsp, maxIsp, sortOrder, minRunnersInRange, maxRunnersInRange, fromRow, toRow ?? undefined, minDate || undefined, maxDate || undefined, courses, goings, raceClasses, raceTypes, trainer, jockey, trainerFormMinWinRate, minTrainerFormRunners, maxTrainerFormRunners, undefined, minModelWinProbability, onlyModelBeatsSp);
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
      const result = await chatApi.getIndustrySp(next, PAGE_SIZE, minRunners, maxRunners, countries, minIsp, maxIsp, sortOrder, minRunnersInRange, maxRunnersInRange, fromRow, toRow ?? undefined, minDate || undefined, maxDate || undefined, courses, goings, raceClasses, raceTypes, trainer, jockey, trainerFormMinWinRate, minTrainerFormRunners, maxTrainerFormRunners, undefined, minModelWinProbability, onlyModelBeatsSp);
      setRaces(prev => [...prev, ...result.data]);
      setPage(next);
      setTotalPages(result.totalPages);
    } catch {
      // silently ignore
    } finally {
      setIsLoadingMore(false);
    }
  }

  // With "Has trainer form" (or the model win-probability threshold) active,
  // the backend only guarantees a race has *at least one* qualifying runner
  // for each filter independently — it still returns every runner in the
  // race, most of which typically won't themselves qualify. Narrowing to
  // just the qualifying ones here (rather than showing the full field) is
  // what actually delivers "only see horses that have recent trainer form
  // available" (or a high model win probability), not just "races
  // containing such a horse somewhere". When both filters are active at
  // once, a runner must satisfy both to display — a rare edge case where a
  // matching race could show zero runners if no single runner satisfies
  // both independently-satisfied thresholds, but that's a predictable,
  // correct outcome rather than silently ignoring one filter.
  function qualifyingRunners(race: IspRace): IspRunner[] {
    return race.runners.filter(r => {
      if (hasTrainerForm && !(r.trainerFormWinRate != null && r.trainerFormWinRate >= trainerFormMinWinRate)) {
        return false;
      }
      if (minModelWinProbability > 0 && !(r.modelWinProbability != null && r.modelWinProbability >= minModelWinProbability)) {
        return false;
      }
      if (onlyModelBeatsSp && !modelBeatsSp(r)) {
        return false;
      }
      return true;
    });
  }

  const visibleRaces = races.filter(race => qualifyingRunners(race).length > 0);
  const visibleRunners = visibleRaces.reduce((sum, r) => sum + qualifyingRunners(r).length, 0);

  const hierarchy = buildRaceHierarchy(visibleRaces);
  const allNodeKeys = collectHierarchyNodeKeys(hierarchy);
  const isAllCollapsed = allNodeKeys.length > 0 && allNodeKeys.every(k => collapsedKeys.has(k));

  function toggleNode(key: string) {
    setCollapsedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function toggleCollapseAll() {
    setCollapsedKeys(isAllCollapsed ? new Set() : new Set(allNodeKeys));
  }

  // Same staking math as the per-race P&L badge (ispFormat.computeRangePnl),
  // rolled up over every qualifying runner across a whole year/month/day/
  // meeting's races — reuses qualifyingRunners so a group total always
  // matches the sum of the individual race/runner rows rendered under it.
  function groupPnl(races: IspRace[]) {
    return computeRangePnl(races.map(race => ({ ...race, runners: qualifyingRunners(race) })));
  }

  return (
    <SafeAreaView testID="industry-sp-races-screen" style={styles.screen}>
      <AppHeader
        navigate={navigate}
        isAuthenticated={isAuthenticated}
        onLogout={onLogout}
        onRequestAuth={onRequestAuth}
        onBack={onBack}
        subtitle={
          !isLoading
            ? `Races · ${visibleRunners} runners · ${visibleRaces.length}/${totalRaces} races`
            : "Races"
        }
        testIdPrefix="industry-sp-races"
      />

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
        <Button
          testID="industry-sp-collapse-all-toggle"
          mode="outlined"
          compact
          onPress={toggleCollapseAll}
          style={styles.toolbarButtonOutlined}
          labelStyle={styles.toolbarButtonOutlinedLabel}
        >
          {isAllCollapsed ? "Expand All" : "Collapse All"}
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
          <PageContainer>
            {visibleRaces.length === 0 && (
              <Text style={styles.emptyText}>No races found.</Text>
            )}
            {hierarchy.map(year => {
              const yearKey = `year:${year.key}`;
              const yearCollapsed = collapsedKeys.has(yearKey);
              const yearPnl = groupPnl(year.races);
              return (
                <View key={year.key} testID={`industry-sp-year-${year.key}`}>
                  <TouchableOpacity
                    testID={`industry-sp-year-toggle-${year.key}`}
                    style={styles.yearHeader}
                    onPress={() => toggleNode(yearKey)}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: !yearCollapsed }}
                  >
                    <Text style={[styles.groupChevron, styles.groupChevronLight]}>{yearCollapsed ? "▸" : "▾"}</Text>
                    <Text style={styles.yearLabel}>{year.key}</Text>
                    <Text style={[styles.groupCount, styles.groupCountLight]}>{year.races.length} races</Text>
                    {yearPnl.staked > 0 && (
                      <Text testID={`industry-sp-year-pnl-${year.key}`} style={[styles.groupPnl, yearPnl.pnl >= 0 ? styles.pnlPos : styles.pnlNeg]}>
                        {formatPnl(yearPnl.pnl)} ({formatPct(yearPnl.pnl, yearPnl.staked)})
                      </Text>
                    )}
                  </TouchableOpacity>

                  {!yearCollapsed && year.months.map(month => {
                    const monthKey = `month:${month.key}`;
                    const monthCollapsed = collapsedKeys.has(monthKey);
                    const monthPnl = groupPnl(month.races);
                    return (
                      <View key={month.key} testID={`industry-sp-month-${month.key}`}>
                        <TouchableOpacity
                          testID={`industry-sp-month-toggle-${month.key}`}
                          style={styles.monthHeader}
                          onPress={() => toggleNode(monthKey)}
                          accessibilityRole="button"
                          accessibilityState={{ expanded: !monthCollapsed }}
                        >
                          <Text style={[styles.groupChevron, styles.groupChevronLight]}>{monthCollapsed ? "▸" : "▾"}</Text>
                          <Text style={styles.monthLabel}>{month.label}</Text>
                          <Text style={[styles.groupCount, styles.groupCountLight]}>{month.races.length} races</Text>
                          {monthPnl.staked > 0 && (
                            <Text testID={`industry-sp-month-pnl-${month.key}`} style={[styles.groupPnl, monthPnl.pnl >= 0 ? styles.pnlPos : styles.pnlNeg]}>
                              {formatPnl(monthPnl.pnl)} ({formatPct(monthPnl.pnl, monthPnl.staked)})
                            </Text>
                          )}
                        </TouchableOpacity>

                        {!monthCollapsed && month.days.map(day => {
                          const dayKey = `day:${day.key}`;
                          const dayCollapsed = collapsedKeys.has(dayKey);
                          const dayPnl = groupPnl(day.races);
                          return (
                            <View key={day.key} testID={`industry-sp-day-${day.key}`}>
                              <TouchableOpacity
                                testID={`industry-sp-day-toggle-${day.key}`}
                                style={styles.dayHeader}
                                onPress={() => toggleNode(dayKey)}
                                accessibilityRole="button"
                                accessibilityState={{ expanded: !dayCollapsed }}
                              >
                                <Text style={styles.groupChevron}>{dayCollapsed ? "▸" : "▾"}</Text>
                                <Text style={styles.dayLabel}>{day.label}</Text>
                                <Text style={styles.groupCount}>{day.races.length} races</Text>
                                {dayPnl.staked > 0 && (
                                  <Text testID={`industry-sp-day-pnl-${day.key}`} style={[styles.groupPnl, dayPnl.pnl >= 0 ? styles.pnlPos : styles.pnlNeg]}>
                                    {formatPnl(dayPnl.pnl)} ({formatPct(dayPnl.pnl, dayPnl.staked)})
                                  </Text>
                                )}
                              </TouchableOpacity>

                              {!dayCollapsed && day.meetings.map(meeting => {
                                const meetingKey = `meeting:${meeting.meetingId}`;
                                const meetingCollapsed = collapsedKeys.has(meetingKey);
                                const meetingPnl = groupPnl(meeting.races);
                                return (
                                  <View key={meeting.meetingId} testID={`industry-sp-meeting-${meeting.meetingId}`}>
                                    <View style={styles.eventHeader}>
                                      <TouchableOpacity
                                        testID={`industry-sp-meeting-toggle-${meeting.meetingId}`}
                                        onPress={() => toggleNode(meetingKey)}
                                        accessibilityRole="button"
                                        accessibilityState={{ expanded: !meetingCollapsed }}
                                      >
                                        <Text style={styles.groupChevron}>{meetingCollapsed ? "▸" : "▾"}</Text>
                                      </TouchableOpacity>
                                      <TouchableOpacity
                                        testID={`industry-sp-meeting-link-${meeting.meetingId}`}
                                        onPress={() => onNavigateToMeeting(meeting.meetingId)}
                                      >
                                        <Text style={styles.eventName}>{meeting.course}</Text>
                                      </TouchableOpacity>
                                      <Text style={styles.groupCount}>{meeting.races.length} races</Text>
                                      {meetingPnl.staked > 0 && (
                                        <Text testID={`industry-sp-meeting-pnl-${meeting.meetingId}`} style={[styles.groupPnl, meetingPnl.pnl >= 0 ? styles.pnlPos : styles.pnlNeg]}>
                                          {formatPnl(meetingPnl.pnl)} ({formatPct(meetingPnl.pnl, meetingPnl.staked)})
                                        </Text>
                                      )}
                                    </View>
                                    {!meetingCollapsed && meeting.races.map(race => (
                                      <View key={race.raceId}>
                                        <TouchableOpacity
                                          testID={`industry-sp-race-${race.raceId}`}
                                          style={styles.raceHeader}
                                          onPress={() => onNavigateToRace(race.raceId)}
                                        >
                                          <Text style={styles.raceTime}>{formatRaceTime(race.raceTime)}</Text>
                                          <Text style={styles.raceType}>{race.raceType}</Text>
                                          <Text style={styles.raceCount}>{qualifyingRunners(race).length} runners</Text>
                                          {(() => {
                                            const rp = computeRangePnl([{ ...race, runners: qualifyingRunners(race) }]);
                                            if (rp.staked === 0) return null;
                                            return (
                                              <Text style={[styles.racePnl, rp.pnl >= 0 ? styles.pnlPos : styles.pnlNeg]}>
                                                {formatPnl(rp.pnl)} ({formatPct(rp.pnl, rp.staked)})
                                              </Text>
                                            );
                                          })()}
                                        </TouchableOpacity>
                                        {qualifyingRunners(race).map((runner: IspRunner) => (
                                          <TouchableOpacity
                                            key={runner.id}
                                            testID={`industry-sp-item-${runner.id}`}
                                            style={styles.runnerRow}
                                            onPress={() => onNavigateToRunner(race.raceId, runner.id)}
                                          >
                                            <Text style={styles.priority}>{runner.sortPriority}.</Text>
                                            <Text testID={`industry-sp-item-name-${runner.id}`} style={styles.runnerName} numberOfLines={1}>
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
                                            {runner.trainer && (
                                              <TouchableOpacity
                                                onPress={(e) => { e.stopPropagation(); onNavigateToTrainer(runner.trainer!, toFormCategory(race.raceType)); }}
                                              >
                                                <Text testID={`industry-sp-item-trainer-${runner.id}`} style={styles.trainerBadge} numberOfLines={1}>
                                                  {runner.trainer}
                                                  {runner.trainerFormRuns != null && runner.trainerFormRuns > 0 && runner.trainerFormWinRate != null && (
                                                    <Text testID={`industry-sp-item-trainer-form-${runner.id}`} style={styles.trainerFormBadge}>
                                                      {` · ${runner.trainerFormWins}/${runner.trainerFormRuns} · ${runner.trainerFormWinRate.toFixed(0)}%`}
                                                    </Text>
                                                  )}
                                                </Text>
                                              </TouchableOpacity>
                                            )}
                                            {runner.modelWinProbability != null && (
                                              <Text testID={`industry-sp-item-model-${runner.id}`} style={styles.modelBadge}>
                                                Model {runner.modelWinProbability.toFixed(0)}%
                                                {runner.isp != null && runner.isp > 0 && (
                                                  <Text testID={`industry-sp-item-implied-sp-${runner.id}`} style={styles.impliedSpBadge}>
                                                    {` · SP ${impliedProbabilityPct(runner.isp).toFixed(0)}%`}
                                                  </Text>
                                                )}
                                              </Text>
                                            )}
                                            {modelBeatsSp(runner) && (
                                              <Text testID={`industry-sp-item-value-${runner.id}`} style={styles.valueBadge}>
                                                Value
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
                                          </TouchableOpacity>
                                        ))}
                                      </View>
                                    ))}
                                  </View>
                                );
                              })}
                            </View>
                          );
                        })}
                      </View>
                    );
                  })}
                </View>
              );
            })}
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
  yearHeader: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.text,
    gap: spacing.sm,
  },
  yearLabel: {
    fontSize: 16,
    fontWeight: "700",
    color: "#fff",
  },
  monthHeader: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md - 2,
    backgroundColor: colors.accent,
    gap: spacing.sm,
  },
  monthLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: "#fff",
  },
  dayHeader: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  dayLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.text,
  },
  groupChevron: {
    fontSize: 12,
    color: colors.textSecondary,
    width: 14,
  },
  groupChevronLight: {
    color: "rgba(255,255,255,0.8)",
  },
  groupCount: {
    fontSize: 11,
    color: colors.textTertiary,
    marginLeft: "auto",
  },
  groupCountLight: {
    color: "rgba(255,255,255,0.7)",
  },
  groupPnl: {
    fontSize: 11,
    fontWeight: "700",
    marginLeft: spacing.sm,
  },
  eventHeader: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md - 2,
    backgroundColor: colors.primaryLight,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  eventName: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.accent,
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
  // Deliberately not flex:1 — in a flexWrap row, a flex-grow item gets
  // squeezed toward minWidth (effectively invisible) as more badges are
  // added to the same row, rather than wrapping itself; a fixed maxWidth
  // (matching trainerBadge's own cap) makes it wrap as a whole instead.
  // Deliberately not flex:1 — in a flexWrap row, a flex-grow item gets
  // squeezed toward minWidth (effectively invisible) as more badges are
  // added to the same row, rather than wrapping itself; a fixed maxWidth
  // (matching trainerBadge's own cap) makes it wrap as a whole instead.
  runnerName: {
    fontSize: 13,
    fontWeight: "500",
    color: colors.text,
    maxWidth: 160,
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
  trainerBadge: {
    fontSize: 11,
    color: colors.textSecondary,
    marginRight: spacing.sm,
    maxWidth: 160,
  },
  trainerFormBadge: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.textTertiary,
  },
  modelBadge: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.accent,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: radii.sm,
    marginRight: spacing.sm,
  },
  impliedSpBadge: {
    fontWeight: "500",
    color: colors.textTertiary,
  },
  valueBadge: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.success,
    backgroundColor: colors.successLight,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: radii.sm,
    marginRight: spacing.sm,
  },
  pnlPos: {
    color: colors.pnlPositive,
  },
  pnlNeg: {
    color: colors.pnlNegative,
  },
});
