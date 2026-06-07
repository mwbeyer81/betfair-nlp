import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
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

function formatPct(pnl: number, staked: number): string {
  if (staked === 0) return "";
  const pct = (pnl / staked) * 100;
  return pct >= 0 ? `+${pct.toFixed(1)}%` : `${pct.toFixed(1)}%`;
}

function computeRangePnl(races: RaceWithEvent[]): PnlStats {
  let staked = 0, returns = 0;
  for (const race of races) {
    for (const runner of race.runners) {
      if (runner.bsp != null && runner.bsp > 1) {
        const stake = 1 / (runner.bsp - 1);
        staked += stake;
        if (runner.status === "WINNER") returns += stake + 1;
      }
    }
  }
  return { staked, returns, pnl: returns - staked };
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

function formatRaceDate(isoTime: string): string {
  try {
    return new Date(isoTime).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "Europe/London",
    });
  } catch {
    return "";
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
  const [minRunners, setMinRunners] = useState(1);
  const [maxRunners, setMaxRunners] = useState(20);
  const [draftMin, setDraftMin] = useState("1");
  const [draftMax, setDraftMax] = useState("20");
  const [fromRow, setFromRow] = useState(1);
  const [toRow, setToRow] = useState<number | null>(null);
  const [draftFrom, setDraftFrom] = useState("1");
  const [draftTo, setDraftTo] = useState("0");
  const [minBsp, setMinBsp] = useState(1);
  const [maxBsp, setMaxBsp] = useState(1000);
  const [draftMinBsp, setDraftMinBsp] = useState("1");
  const [draftMaxBsp, setDraftMaxBsp] = useState("1000");
  const [selectedCountries, setSelectedCountries] = useState<Set<string>>(new Set());
  const [availableCountries, setAvailableCountries] = useState<string[]>([]);
  const [fetchTrigger, setFetchTrigger] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalRaces, setTotalRaces] = useState(0);
  const [totalRunners, setTotalRunners] = useState(0);
  const [pnlStats, setPnlStats] = useState<PnlStats>({ staked: 0, returns: 0, pnl: 0 });
  const PAGE_SIZE = 20;

  function applyFilter() {
    const min = Math.max(1, parseInt(draftMin) || 1);
    const max = Math.max(min, Math.min(30, parseInt(draftMax) || 30));
    setDraftMin(String(min));
    setDraftMax(String(max));
    setMinRunners(min);
    setMaxRunners(max);

    const from = Math.max(1, parseInt(draftFrom) || 1);
    const toRaw = Math.max(from, parseInt(draftTo) || totalRaces);
    const to = toRaw >= totalRaces ? null : toRaw;
    setDraftFrom(String(from));
    setDraftTo(String(to ?? totalRaces));
    setFromRow(from);
    setToRow(to);

    const minB = Math.max(1, parseFloat(draftMinBsp) || 1);
    const maxB = Math.max(minB, parseFloat(draftMaxBsp) || 1000);
    setDraftMinBsp(String(minB));
    setDraftMaxBsp(String(maxB));
    setMinBsp(minB);
    setMaxBsp(maxB);

    setFetchTrigger(t => t + 1);
  }

  // Fetch all available countries once on mount
  useEffect(() => {
    chatApi.getRunnerCountries().then(setAvailableCountries).catch(() => {});
  }, []);

  // Reload races from page 1 on mount and whenever Apply is pressed (fetchTrigger changes)
  useEffect(() => {
    (async () => {
      setIsLoading(true);
      setError(null);
      setRaces([]);
      try {
        const result = await chatApi.getAllRunners(1, PAGE_SIZE, minRunners, maxRunners, [...selectedCountries]);
        setRaces(result.data);
        setPage(1);
        setTotalPages(result.totalPages);
        setTotalRaces(result.total);
        setTotalRunners(result.totalRunners);
        setPnlStats(result.pnlStats);
        // Only seed the "to row" input when no explicit row range is active
        if (toRow == null) setDraftTo(String(result.total));
      } catch {
        setError("Failed to load runners");
      } finally {
        setIsLoading(false);
      }
    })();
  }, [fetchTrigger]);

  async function loadMore() {
    if (isLoadingMore || page >= totalPages) return;
    setIsLoadingMore(true);
    try {
      const next = page + 1;
      const result = await chatApi.getAllRunners(next, PAGE_SIZE, minRunners, maxRunners, [...selectedCountries]);
      setRaces(prev => [...prev, ...result.data]);
      setPage(next);
      setTotalPages(result.totalPages);
    } catch {
      // silently ignore load-more errors
    } finally {
      setIsLoadingMore(false);
    }
  }


  const visibleRaces = races
    .map(race => ({
      ...race,
      runners: race.runners.filter(r => {
        if (r.bsp == null) return showNoBsp;
        return r.bsp >= minBsp && r.bsp <= maxBsp;
      }),
    }))
    .filter(race => race.runners.length > 0);

  const visibleRunners = visibleRaces.reduce((sum, r) => sum + r.runners.length, 0);

  const hasRowRange = fromRow > 1 || toRow != null;
  const hasSpFilter = minBsp > 1 || maxBsp < 1000;
  const hasCountryFilter = selectedCountries.size > 0;
  const effectiveToRow = toRow ?? visibleRaces.length;
  const selectedRaces = visibleRaces.filter((_, i) => i + 1 >= fromRow && i + 1 <= effectiveToRow);
  const displayRaces = hasRowRange ? selectedRaces : visibleRaces;
  const displayPnl = (hasRowRange || hasSpFilter || hasCountryFilter) ? computeRangePnl(selectedRaces) : pnlStats;

  const byEvent = displayRaces.reduce<Record<string, { eventName: string; races: RaceWithEvent[] }>>(
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
              {visibleRunners}/{totalRunners} runners · {displayRaces.length}/{totalRaces} races
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

      <View testID="all-runners-filter-bar" style={styles.filterBar}>
        <Text style={styles.filterLabel}>Runners per race</Text>
        <View style={styles.filterStepper}>
          <Text style={styles.filterStepperLabel}>Min</Text>
          <TouchableOpacity
            testID="all-runners-min-dec"
            style={styles.stepBtn}
            onPress={() => setDraftMin(v => String(Math.max(1, (parseInt(v) || 1) - 1)))}
          >
            <Text style={styles.stepBtnText}>−</Text>
          </TouchableOpacity>
          <TextInput
            testID="all-runners-min-value"
            style={styles.stepInput}
            value={draftMin}
            onChangeText={setDraftMin}
            keyboardType="numeric"
            maxLength={2}
          />
          <TouchableOpacity
            testID="all-runners-min-inc"
            style={styles.stepBtn}
            onPress={() => setDraftMin(v => String((parseInt(v) || 1) + 1))}
          >
            <Text style={styles.stepBtnText}>+</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.filterStepper}>
          <Text style={styles.filterStepperLabel}>Max</Text>
          <TouchableOpacity
            testID="all-runners-max-dec"
            style={styles.stepBtn}
            onPress={() => setDraftMax(v => String(Math.max(1, (parseInt(v) || 30) - 1)))}
          >
            <Text style={styles.stepBtnText}>−</Text>
          </TouchableOpacity>
          <TextInput
            testID="all-runners-max-value"
            style={styles.stepInput}
            value={draftMax}
            onChangeText={setDraftMax}
            keyboardType="numeric"
            maxLength={2}
          />
          <TouchableOpacity
            testID="all-runners-max-inc"
            style={styles.stepBtn}
            onPress={() => setDraftMax(v => String(Math.min(30, (parseInt(v) || 30) + 1)))}
          >
            <Text style={styles.stepBtnText}>+</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.filterDivider} />
        <View style={styles.filterStepper}>
          <Text style={styles.filterStepperLabel}>SP</Text>
          <TextInput
            testID="all-runners-min-bsp"
            style={styles.priceInput}
            value={draftMinBsp}
            onChangeText={setDraftMinBsp}
            keyboardType="numeric"
            maxLength={7}
          />
          <Text style={styles.filterStepperLabel}>–</Text>
          <TextInput
            testID="all-runners-max-bsp"
            style={styles.priceInput}
            value={draftMaxBsp}
            onChangeText={setDraftMaxBsp}
            keyboardType="numeric"
            maxLength={7}
          />
        </View>
        <View style={styles.filterDivider} />
        <View style={styles.filterStepper}>
          <Text style={styles.filterStepperLabel}>Race</Text>
          <TextInput
            testID="all-runners-from-row"
            style={styles.stepInput}
            value={draftFrom}
            onChangeText={setDraftFrom}
            keyboardType="numeric"
            maxLength={4}
          />
          <Text style={styles.filterStepperLabel}>to</Text>
          <TextInput
            testID="all-runners-to-row"
            style={styles.stepInput}
            value={draftTo}
            onChangeText={setDraftTo}
            keyboardType="numeric"
            maxLength={4}
          />
        </View>
        <TouchableOpacity
          testID="all-runners-filter-apply"
          style={styles.applyBtn}
          onPress={applyFilter}
        >
          <Text style={styles.applyBtnText}>Apply</Text>
        </TouchableOpacity>
      </View>

      {!isLoading && availableCountries.length > 0 && (
        <ScrollView
          horizontal
          testID="all-runners-country-bar"
          style={styles.countryBar}
          contentContainerStyle={styles.countryBarContent}
          showsHorizontalScrollIndicator={false}
        >
          {availableCountries.map(code => {
            const active = selectedCountries.has(code);
            return (
              <TouchableOpacity
                key={code}
                testID={`all-runners-country-${code}`}
                style={[styles.countryChip, active && styles.countryChipActive]}
                onPress={() => {
                  setSelectedCountries(prev => {
                    const next = new Set(prev);
                    if (next.has(code)) next.delete(code); else next.add(code);
                    return next;
                  });
                  setFetchTrigger(t => t + 1);
                }}
              >
                <Text style={[styles.countryChipText, active && styles.countryChipTextActive]}>
                  {code}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {!isLoading && displayPnl.staked > 0 && (
        <View testID="all-runners-pnl-bar" style={styles.pnlBar}>
          <Text style={styles.pnlLabel}>
            {[
              hasCountryFilter && [...selectedCountries].join("/"),
              hasSpFilter && `SP ${minBsp}–${maxBsp}`,
              hasRowRange && `races ${fromRow}–${effectiveToRow}`,
            ].filter(Boolean).join(" · ") || "Stake to win £1 per runner"}
          </Text>
          <View style={styles.pnlStats}>
            <Text style={styles.pnlStat}>
              <Text style={styles.pnlStatLabel}>Staked </Text>{formatGbp(displayPnl.staked)}
            </Text>
            <Text style={styles.pnlStat}>
              <Text style={styles.pnlStatLabel}>Return </Text>{formatGbp(displayPnl.returns)}
            </Text>
            <Text testID="all-runners-pnl" style={[styles.pnlValue, displayPnl.pnl >= 0 ? styles.pnlPos : styles.pnlNeg]}>
              {formatPnl(displayPnl.pnl)} <Text style={styles.pnlPct}>({formatPct(displayPnl.pnl, displayPnl.staked)})</Text>
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
            {displayRaces.length === 0 && (
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
                      <Text style={styles.raceDate}>{formatRaceDate(race.marketTime)}</Text>
                      <Text style={styles.raceType}>{race.marketType}</Text>
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
  filterBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: "#f0f4ff",
    borderBottomWidth: 1,
    borderBottomColor: "#dde3f0",
  },
  filterLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#4a5568",
    marginRight: 4,
  },
  filterStepper: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  filterStepperLabel: {
    fontSize: 11,
    color: "#718096",
    marginRight: 2,
  },
  stepBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#007AFF",
    alignItems: "center",
    justifyContent: "center",
  },
  stepBtnText: {
    color: "#fff",
    fontSize: 16,
    lineHeight: 20,
    fontWeight: "700",
  },
  stepInput: {
    fontSize: 14,
    fontWeight: "700",
    color: "#222",
    width: 32,
    textAlign: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#aaa",
    paddingVertical: 2,
  },
  applyBtn: {
    backgroundColor: "#007AFF",
    paddingVertical: 5,
    paddingHorizontal: 14,
    borderRadius: 6,
    marginLeft: 6,
  },
  priceInput: {
    fontSize: 14,
    fontWeight: "700",
    color: "#222",
    width: 48,
    textAlign: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#aaa",
    paddingVertical: 2,
  },
  countryBar: {
    backgroundColor: "#f8f9fa",
    borderBottomWidth: 1,
    borderBottomColor: "#e9ecef",
    maxHeight: 40,
  },
  countryBarContent: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 6,
  },
  countryChip: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#ced4da",
    backgroundColor: "#fff",
  },
  countryChipActive: {
    backgroundColor: "#007AFF",
    borderColor: "#007AFF",
  },
  countryChipText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#495057",
  },
  countryChipTextActive: {
    color: "#fff",
  },
  filterDivider: {
    width: 1,
    height: 20,
    backgroundColor: "#c8d0e0",
    marginHorizontal: 6,
  },
  raceIncludedWrap: {
    borderLeftWidth: 3,
    borderLeftColor: "#007AFF",
  },
  includedBadge: {
    fontSize: 10,
    fontWeight: "700",
    color: "#007AFF",
    backgroundColor: "#e8f0fe",
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    marginRight: 4,
  },
  applyBtnText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
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
  pnlPct: {
    fontSize: 12,
    fontWeight: "400",
    opacity: 0.8,
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
  raceDate: {
    fontSize: 11,
    color: "#888",
    marginLeft: 4,
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
  racePnl: {
    fontSize: 11,
    fontWeight: "700",
    marginLeft: 8,
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
