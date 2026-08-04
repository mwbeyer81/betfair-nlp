import React, { useState, useEffect } from "react";
import {
  View,
  ScrollView,
  TextInput as RNTextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
} from "react-native";
import {
  Text,
  Button,
  Chip,
  ActivityIndicator,
  Portal,
  Dialog,
  Surface,
} from "react-native-paper";
import { chatApi, RaceWithEvent, Runner, PnlStats, BrierStats, RunnerFilterBounds } from "../services/chatApi";
import { BrierScore } from "./BrierScore";
import { exportToCsv, exportToXlsx } from "../utils/exportRunners";
import { PageContainer } from "./PageContainer";
import { AppHeader } from "./AppHeader";
import { colors, statusPill, radii, spacing } from "../theme";
import type { Route } from "../hooks/useRouter";

interface AllRunnersScreenProps {
  navigate: (to: Route, query?: string) => void;
  isAuthenticated: boolean;
  onLogout?: () => void;
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

function formatPct(pnl: number, staked: number): string {
  if (staked === 0) return "";
  const pct = (pnl / staked) * 100;
  return pct >= 0 ? `+${pct.toFixed(1)}%` : `${pct.toFixed(1)}%`;
}

function computeRangePnl(races: RaceWithEvent[]): PnlStats {
  let staked = 0, returns = 0, count = 0;
  for (const race of races) {
    for (const runner of race.runners) {
      if (runner.bsp != null && runner.bsp > 1) {
        count++;
        const stake = 1 / (runner.bsp - 1);
        staked += stake;
        if (runner.status === "WINNER") returns += stake + 1;
      }
    }
  }
  return { staked, returns, pnl: returns - staked, count };
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
      hour12: false,
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
  navigate,
  isAuthenticated,
  onLogout,
}) => {
  const [races, setRaces] = useState<RaceWithEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
  const [minRunnersInRange, setMinRunnersInRange] = useState(1);
  const [maxRunnersInRange, setMaxRunnersInRange] = useState(30);
  const [draftMinRIR, setDraftMinRIR] = useState("1");
  const [draftMaxRIR, setDraftMaxRIR] = useState("30");
  const [selectedCountries, setSelectedCountries] = useState<Set<string>>(new Set());
  const [availableCountries, setAvailableCountries] = useState<string[]>([]);
  const [fetchTrigger, setFetchTrigger] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalRaces, setTotalRaces] = useState(0);
  const [totalRunners, setTotalRunners] = useState(0);
  const [pnlStats, setPnlStats] = useState<PnlStats>({ staked: 0, returns: 0, pnl: 0 });
  // Market-only on this screen: the Betfair-SP dataset has no model column
  // (ml/train_and_predict.py scores the industry-SP collection), so this is
  // how well the exchange's own closing prices predicted the results.
  const [brier, setBrier] = useState<BrierStats | undefined>(undefined);
  const [filterBounds, setFilterBounds] = useState<RunnerFilterBounds | null>(null);
  const [showExportModal, setShowExportModal] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const PAGE_SIZE = 20;

  function applyFilter() {
    const maxRunnersLimit = filterBounds?.maxRunnersPerRace ?? 100;
    const maxBspLimit = filterBounds?.maxBsp ?? 100000;

    const min = Math.max(1, parseInt(draftMin) || 1);
    const max = Math.max(min, Math.min(maxRunnersLimit, parseInt(draftMax) || maxRunnersLimit));
    setDraftMin(String(min));
    setDraftMax(String(max));
    setMinRunners(min);
    setMaxRunners(max);

    const from = Math.max(1, parseInt(draftFrom) || 1);
    const toRaw = Math.min(totalRaces, Math.max(from, parseInt(draftTo) || totalRaces));
    const to = toRaw >= totalRaces ? null : toRaw;
    setDraftFrom(String(from));
    setDraftTo(String(to ?? totalRaces));
    setFromRow(from);
    setToRow(to);

    const minB = Math.max(1, parseFloat(draftMinBsp) || 1);
    const maxB = Math.min(maxBspLimit, Math.max(minB, parseFloat(draftMaxBsp) || maxBspLimit));
    setDraftMinBsp(String(minB));
    setDraftMaxBsp(String(maxB));
    setMinBsp(minB);
    setMaxBsp(maxB);

    const minRIR = Math.max(1, parseInt(draftMinRIR) || 1);
    const maxRIR = Math.max(minRIR, Math.min(maxRunnersLimit, parseInt(draftMaxRIR) || maxRunnersLimit));
    setDraftMinRIR(String(minRIR));
    setDraftMaxRIR(String(maxRIR));
    setMinRunnersInRange(minRIR);
    setMaxRunnersInRange(maxRIR);

    setFetchTrigger(t => t + 1);
  }

  useEffect(() => {
    chatApi.getRunnerCountries().then(setAvailableCountries).catch(() => {});
    chatApi.getRunnerFilterBounds().then(setFilterBounds).catch(() => {});
  }, []);

  useEffect(() => {
    (async () => {
      setIsLoading(true);
      setError(null);
      setRaces([]);
      try {
        const result = await chatApi.getAllRunners(1, PAGE_SIZE, minRunners, maxRunners, [...selectedCountries], minBsp, maxBsp, sortOrder, minRunnersInRange, maxRunnersInRange, fromRow, toRow ?? undefined);
        setRaces(result.data);
        setPage(1);
        setTotalPages(result.totalPages);
        setTotalRaces(result.total);
        setTotalRunners(result.totalRunners);
        setPnlStats(result.pnlStats ?? { staked: 0, returns: 0, pnl: 0 });
        setBrier(result.brier);
        if (toRow == null) setDraftTo(String(result.total));
      } catch {
        setError("Failed to load runners");
      } finally {
        setIsLoading(false);
      }
    })();
  }, [fetchTrigger, sortOrder]);

  async function loadMore() {
    if (isLoadingMore || page >= totalPages) return;
    setIsLoadingMore(true);
    try {
      const next = page + 1;
      const result = await chatApi.getAllRunners(next, PAGE_SIZE, minRunners, maxRunners, [...selectedCountries], minBsp, maxBsp, sortOrder, minRunnersInRange, maxRunnersInRange, fromRow, toRow ?? undefined);
      setRaces(prev => [...prev, ...result.data]);
      setPage(next);
      setTotalPages(result.totalPages);
    } catch {
      // silently ignore
    } finally {
      setIsLoadingMore(false);
    }
  }

  async function handleExport(format: 'csv' | 'xlsx') {
    setShowExportModal(false);
    setIsExporting(true);
    try {
      const allData = await chatApi.getAllRunners(
        1, Math.max(totalRaces, 1), minRunners, maxRunners, [...selectedCountries], minBsp, maxBsp, sortOrder, minRunnersInRange, maxRunnersInRange, fromRow, toRow ?? undefined
      );
      const exportRaces = allData.data.filter(race => race.runners.length > 0);
      if (format === 'csv') exportToCsv(exportRaces, pnlStats);
      else exportToXlsx(exportRaces, pnlStats);
    } catch {
      // silently fail
    } finally {
      setIsExporting(false);
    }
  }

  const visibleRaces = races.filter(race => race.runners.length > 0);
  const visibleRunners = visibleRaces.reduce((sum, r) => sum + r.runners.length, 0);

  const hasRowRange = fromRow > 1 || toRow != null;
  const effectiveToRow = toRow ?? totalRaces;
  const displayRaces = visibleRaces;
  const displayPnl = pnlStats;

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
      <AppHeader
        navigate={navigate}
        isAuthenticated={isAuthenticated}
        onLogout={onLogout}
        subtitle={
          !isLoading
            ? `All Runners · ${visibleRunners}/${totalRunners} runners · ${displayRaces.length}/${totalRaces} races`
            : "All Runners"
        }
        testIdPrefix="all-runners"
        extraActions={wrap => (
          <>
            <Button
              testID="all-runners-sort-toggle"
              mode="outlined"
              compact
              onPress={wrap(() => setSortOrder(o => o === "asc" ? "desc" : "asc"))}
              style={styles.headerButton}
              labelStyle={styles.headerButtonLabel}
            >
              {sortOrder === "asc" ? "First → Last" : "Last → First"}
            </Button>
            {!isLoading && displayRaces.length > 0 && (
              <Button
                testID="all-runners-export-btn"
                mode="contained"
                compact
                buttonColor={colors.success}
                onPress={wrap(() => !isExporting && setShowExportModal(true))}
                disabled={isExporting}
                style={styles.headerButton}
                labelStyle={styles.headerButtonLabel}
                loading={isExporting}
              >
                Export
              </Button>
            )}
          </>
        )}
      />

      {/* Filter bar — kept as custom for density */}
      <PageContainer maxWidth={1200}>
      <View testID="all-runners-filter-bar" style={styles.filterBar}>
        <View style={styles.filterStepper}>
          <Text style={styles.filterStepperLabel}>SP</Text>
          <RNTextInput
            testID="all-runners-min-bsp"
            style={styles.priceInput}
            value={draftMinBsp}
            onChangeText={setDraftMinBsp}
            keyboardType="numeric"
            maxLength={7}
          />
          <Text style={styles.filterStepperLabel}>–</Text>
          <RNTextInput
            testID="all-runners-max-bsp"
            style={styles.priceInput}
            value={draftMaxBsp}
            onChangeText={setDraftMaxBsp}
            keyboardType="numeric"
            maxLength={7}
          />
          {filterBounds != null && (
            <Text testID="all-runners-sp-bound" style={styles.boundsHint}>
              ({filterBounds.minBsp.toFixed(1)}–{Math.ceil(filterBounds.maxBsp)})
            </Text>
          )}
        </View>
        <View style={styles.filterDivider} />
        <Text style={styles.filterLabel}>Runners</Text>
        <View style={styles.filterStepper}>
          <Text style={styles.filterStepperLabel}>Min</Text>
          <TouchableOpacity
            testID="all-runners-min-dec"
            style={[styles.stepBtn, (parseInt(draftMin) || 1) <= 1 && styles.stepBtnDisabled]}
            disabled={(parseInt(draftMin) || 1) <= 1}
            onPress={() => setDraftMin(v => String(Math.max(1, (parseInt(v) || 1) - 1)))}
          >
            <Text style={styles.stepBtnText}>-</Text>
          </TouchableOpacity>
          <RNTextInput
            testID="all-runners-min-value"
            style={styles.stepInput}
            value={draftMin}
            onChangeText={setDraftMin}
            keyboardType="numeric"
            maxLength={3}
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
            onPress={() => setDraftMax(v => String(Math.max(1, (parseInt(v) || 20) - 1)))}
          >
            <Text style={styles.stepBtnText}>-</Text>
          </TouchableOpacity>
          <RNTextInput
            testID="all-runners-max-value"
            style={styles.stepInput}
            value={draftMax}
            onChangeText={setDraftMax}
            keyboardType="numeric"
            maxLength={3}
          />
          <TouchableOpacity
            testID="all-runners-max-inc"
            style={[styles.stepBtn, filterBounds != null && (parseInt(draftMax) || 0) >= filterBounds.maxRunnersPerRace && styles.stepBtnDisabled]}
            disabled={filterBounds != null && (parseInt(draftMax) || 0) >= filterBounds.maxRunnersPerRace}
            onPress={() => setDraftMax(v => String(Math.min(filterBounds?.maxRunnersPerRace ?? 100, (parseInt(v) || 20) + 1)))}
          >
            <Text style={styles.stepBtnText}>+</Text>
          </TouchableOpacity>
          {filterBounds != null && (
            <Text testID="all-runners-max-bound" style={styles.boundsHint}>of {filterBounds.maxRunnersPerRace}</Text>
          )}
        </View>
        <View style={styles.filterDivider} />
        <View style={styles.filterStepper}>
          <Text testID="all-runners-in-sp-label" style={styles.filterStepperLabel}># in SP</Text>
          <TouchableOpacity
            testID="all-runners-min-rir-dec"
            style={styles.stepBtn}
            onPress={() => setDraftMinRIR(v => String(Math.max(1, (parseInt(v) || 1) - 1)))}
          >
            <Text style={styles.stepBtnText}>-</Text>
          </TouchableOpacity>
          <RNTextInput
            testID="all-runners-min-rir-value"
            style={styles.stepInput}
            value={draftMinRIR}
            onChangeText={setDraftMinRIR}
            keyboardType="numeric"
            maxLength={2}
          />
          <TouchableOpacity
            testID="all-runners-min-rir-inc"
            style={styles.stepBtn}
            onPress={() => setDraftMinRIR(v => String((parseInt(v) || 1) + 1))}
          >
            <Text style={styles.stepBtnText}>+</Text>
          </TouchableOpacity>
          <Text style={styles.filterStepperLabel}>to</Text>
          <TouchableOpacity
            testID="all-runners-max-rir-dec"
            style={styles.stepBtn}
            onPress={() => setDraftMaxRIR(v => String(Math.max(1, (parseInt(v) || 30) - 1)))}
          >
            <Text style={styles.stepBtnText}>-</Text>
          </TouchableOpacity>
          <RNTextInput
            testID="all-runners-max-rir-value"
            style={styles.stepInput}
            value={draftMaxRIR}
            onChangeText={setDraftMaxRIR}
            keyboardType="numeric"
            maxLength={2}
          />
          <TouchableOpacity
            testID="all-runners-max-rir-inc"
            style={[styles.stepBtn, filterBounds != null && (parseInt(draftMaxRIR) || 0) >= filterBounds.maxRunnersPerRace && styles.stepBtnDisabled]}
            disabled={filterBounds != null && (parseInt(draftMaxRIR) || 0) >= filterBounds.maxRunnersPerRace}
            onPress={() => setDraftMaxRIR(v => String(Math.min(filterBounds?.maxRunnersPerRace ?? 100, (parseInt(v) || 30) + 1)))}
          >
            <Text style={styles.stepBtnText}>+</Text>
          </TouchableOpacity>
          {filterBounds != null && (
            <Text testID="all-runners-max-rir-bound" style={styles.boundsHint}>of {filterBounds.maxRunnersPerRace}</Text>
          )}
        </View>
        <View style={styles.filterDivider} />
        <View style={styles.filterStepper}>
          <Text style={styles.filterStepperLabel}>Race</Text>
          <RNTextInput
            testID="all-runners-from-row"
            style={styles.raceInput}
            value={draftFrom}
            onChangeText={setDraftFrom}
            keyboardType="numeric"
            maxLength={5}
          />
          <Text style={styles.filterStepperLabel}>–</Text>
          <RNTextInput
            testID="all-runners-to-row"
            style={styles.raceInput}
            value={draftTo}
            onChangeText={setDraftTo}
            keyboardType="numeric"
            maxLength={5}
          />
          {totalRaces > 0 && (
            <Text testID="all-runners-race-bound" style={styles.boundsHint}>/{totalRaces}</Text>
          )}
        </View>
        <Button
          testID="all-runners-filter-apply"
          mode="contained"
          compact
          onPress={applyFilter}
          style={styles.applyBtn}
          labelStyle={styles.applyBtnLabel}
        >
          Apply
        </Button>
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
              <Chip
                key={code}
                testID={`all-runners-country-${code}`}
                compact
                mode={active ? "flat" : "outlined"}
                selected={active}
                onPress={() => {
                  setSelectedCountries(prev => {
                    const next = new Set(prev);
                    if (next.has(code)) next.delete(code); else next.add(code);
                    return next;
                  });
                  const minRIR = Math.max(1, parseInt(draftMinRIR) || 1);
                  const maxRIR = Math.max(minRIR, Math.min(filterBounds?.maxRunnersPerRace ?? 100, parseInt(draftMaxRIR) || 100));
                  setDraftMinRIR(String(minRIR));
                  setDraftMaxRIR(String(maxRIR));
                  setMinRunnersInRange(minRIR);
                  setMaxRunnersInRange(maxRIR);
                  setFetchTrigger(t => t + 1);
                }}
                style={active ? styles.countryChipActive : styles.countryChip}
                textStyle={active ? styles.countryChipTextActive : styles.countryChipText}
              >
                {code}
              </Chip>
            );
          })}
        </ScrollView>
      )}
      </PageContainer>

      {!isLoading && displayPnl.staked > 0 && (
        <View testID="all-runners-pnl-bar" style={styles.pnlBar}>
          <Text style={styles.pnlLabel}>
            {hasRowRange ? `races ${fromRow}–${effectiveToRow}` : "Stake to win £1 per runner"}
          </Text>
          <View style={styles.pnlStats}>
            {displayPnl.count != null && (
              <Text testID="all-runners-pnl-count" style={styles.pnlStat}>
                <Text style={styles.pnlStatLabel}>Horses </Text>{displayPnl.count}
              </Text>
            )}
            <Text style={styles.pnlStat}>
              <Text style={styles.pnlStatLabel}>Staked </Text>{formatGbp(displayPnl.staked)}
            </Text>
            <Text style={styles.pnlStat}>
              <Text style={styles.pnlStatLabel}>Return </Text>{formatGbp(displayPnl.returns)}
            </Text>
            <Text testID="all-runners-pnl" style={[styles.pnlValue, displayPnl.pnl >= 0 ? styles.pnlPos : styles.pnlNeg]}>
              {formatPnl(displayPnl.pnl)} <Text style={styles.pnlPct}>({formatPct(displayPnl.pnl, displayPnl.staked)})</Text>
            </Text>
            <BrierScore brier={brier} tone="dark" testID="all-runners-brier" label="Brier (SP)" />
          </View>
        </View>
      )}

      <View style={styles.body}>
        {isLoading && (
          <View testID="all-runners-loading" style={styles.centered}>
            <ActivityIndicator size="large" animating color={colors.primary} />
            <Text variant="bodyMedium" style={styles.loadingText}>
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
          <PageContainer maxWidth={1200}>
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
            {page < totalPages && (
              <Button
                testID="all-runners-load-more"
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

      <Portal>
        <Dialog
          visible={showExportModal}
          onDismiss={() => setShowExportModal(false)}
        >
          <Dialog.Title>Export Runners</Dialog.Title>
          <Dialog.Content>
            <Text testID="all-runners-export-modal" variant="bodyMedium">
              All {totalRaces} races matching current filter
            </Text>
          </Dialog.Content>
          <Dialog.Actions style={styles.exportActions}>
            <Button
              testID="all-runners-export-csv"
              mode="contained"
              onPress={() => handleExport('csv')}
              style={styles.exportDialogButton}
            >
              Download CSV
            </Button>
            <Button
              testID="all-runners-export-xlsx"
              mode="contained"
              buttonColor="#1d6f42"
              onPress={() => handleExport('xlsx')}
              style={styles.exportDialogButton}
            >
              Download Excel (.xlsx)
            </Button>
            <Button
              testID="all-runners-export-cancel"
              mode="text"
              onPress={() => setShowExportModal(false)}
              style={{ borderRadius: radii.button }}
            >
              Cancel
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  headerButton: {
    marginHorizontal: 3,
    borderRadius: radii.button,
  },
  headerButtonLabel: {
    fontSize: 11,
    fontWeight: "600",
  },
  filterBar: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.primaryLight,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  filterLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textSecondary,
    marginRight: 4,
  },
  filterStepper: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  filterStepperLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    marginRight: 2,
  },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  stepBtnDisabled: {
    backgroundColor: colors.primaryMuted,
    opacity: 0.6,
  },
  boundsHint: {
    fontSize: 10,
    color: colors.textTertiary,
    marginLeft: 3,
    fontWeight: "500",
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
    color: colors.text,
    width: 36,
    textAlign: "center",
    borderBottomWidth: 1,
    borderBottomColor: colors.textTertiary,
    paddingVertical: 2,
  },
  raceInput: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.text,
    minWidth: 52,
    textAlign: "center",
    borderBottomWidth: 1,
    borderBottomColor: colors.textTertiary,
    paddingVertical: 2,
    paddingHorizontal: 2,
  },
  priceInput: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.text,
    minWidth: 60,
    textAlign: "center",
    borderBottomWidth: 1,
    borderBottomColor: colors.textTertiary,
    paddingVertical: 2,
    paddingHorizontal: 2,
  },
  applyBtn: {
    borderRadius: radii.button,
    marginLeft: 6,
  },
  applyBtnLabel: {
    fontSize: 13,
    fontWeight: "700",
  },
  countryBar: {
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    maxHeight: 44,
  },
  countryBarContent: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    gap: 6,
  },
  countryChip: {
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  countryChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  countryChipText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textSecondary,
  },
  countryChipTextActive: {
    color: "#fff",
  },
  filterDivider: {
    width: 1,
    height: 20,
    backgroundColor: colors.border,
    marginHorizontal: 6,
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
    backgroundColor: colors.primaryLight,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  eventName: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.accent,
  },
  raceHeader: {
    flexDirection: "row",
    alignItems: "center",
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
    borderRadius: radii.button,
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
  exportActions: {
    flexDirection: "column",
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  exportDialogButton: {
    width: "100%",
    borderRadius: radii.button,
  },
});
