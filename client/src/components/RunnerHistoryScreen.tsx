import React, { useState, useEffect } from "react";
import { View, ScrollView, TextInput as RNTextInput, TouchableOpacity, StyleSheet, SafeAreaView } from "react-native";
import { Text, Button, Chip, Checkbox, ActivityIndicator } from "react-native-paper";
import { chatApi, IspRace, IspFilterBounds } from "../services/chatApi";
import { colors, radii, spacing } from "../theme";
import { PageContainer } from "./PageContainer";
import { DateRangePicker } from "./DateRangePicker";
import { AppHeader } from "./AppHeader";
import type { Route } from "../hooks/useRouter";
import {
  formatGbp,
  formatPnl,
  formatPct,
  formatIsp,
  runnerPnl,
  stakeToWin1,
  formatRaceTime,
  formatRaceDate,
  OddsMode,
} from "../utils/ispFormat";

const PAGE_SIZE = 20;
const ABSOLUTE_MIN_DATE = "2015-01-01";
const ABSOLUTE_MAX_DATE = "2026-12-31";

interface RunnerHistoryScreenProps {
  navigate: (to: Route, query?: string) => void;
  isAuthenticated: boolean;
  onLogout?: () => void;
  onRequestAuth?: () => void;
  runnerName: string;
  onBack: () => void;
  onNavigateToRunner: (raceId: number, runnerId: number) => void;
}

// A small, self-contained filter bar covering the subset of the main
// filters screen's controls that make sense scoped to a single horse's
// history (course/going/class/type/date/ISP/trainer-form). Deliberately
// NOT sharing IndustrySpScreen's renderFilterRow/renderChipRow — those
// close over that screen's own tooltip state, and extracting them would
// mean touching an already-stable, fully-tested screen for a filter set
// that's a strict subset here anyway.
export const RunnerHistoryScreen: React.FC<RunnerHistoryScreenProps> = ({
  navigate,
  isAuthenticated,
  onLogout,
  onRequestAuth,
  runnerName,
  onBack,
  onNavigateToRunner,
}) => {
  const [races, setRaces] = useState<IspRace[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalRaces, setTotalRaces] = useState(0);
  const [oddsMode, setOddsMode] = useState<OddsMode>("fraction");
  const [filterBounds, setFilterBounds] = useState<IspFilterBounds | null>(null);

  const [availableCourses, setAvailableCourses] = useState<string[]>([]);
  const [availableGoings, setAvailableGoings] = useState<string[]>([]);
  const [availableRaceClasses, setAvailableRaceClasses] = useState<string[]>([]);
  const [availableRaceTypes, setAvailableRaceTypes] = useState<string[]>([]);

  const [draftSelectedCourses, setDraftSelectedCourses] = useState<Set<string>>(new Set());
  const [draftSelectedGoings, setDraftSelectedGoings] = useState<Set<string>>(new Set());
  const [draftSelectedRaceClasses, setDraftSelectedRaceClasses] = useState<Set<string>>(new Set());
  const [draftSelectedRaceTypes, setDraftSelectedRaceTypes] = useState<Set<string>>(new Set());
  const [selectedCourses, setSelectedCourses] = useState<Set<string>>(new Set());
  const [selectedGoings, setSelectedGoings] = useState<Set<string>>(new Set());
  const [selectedRaceClasses, setSelectedRaceClasses] = useState<Set<string>>(new Set());
  const [selectedRaceTypes, setSelectedRaceTypes] = useState<Set<string>>(new Set());

  const [draftMinDate, setDraftMinDate] = useState("");
  const [draftMaxDate, setDraftMaxDate] = useState("");
  const [minDate, setMinDate] = useState("");
  const [maxDate, setMaxDate] = useState("");
  const [draftMinIsp, setDraftMinIsp] = useState("1");
  const [draftMaxIsp, setDraftMaxIsp] = useState("1000");
  const [minIsp, setMinIsp] = useState(1);
  const [maxIsp, setMaxIsp] = useState(1000);
  const [draftTrainerFormMinWinRate, setDraftTrainerFormMinWinRate] = useState("0");
  const [trainerFormMinWinRate, setTrainerFormMinWinRate] = useState(0);
  // Independent of trainerFormMinWinRate — checking this alone (with the win
  // rate field left at its 0 default) means "any non-null sample", i.e.
  // "has trainer form available" per the literal ask; the win-rate field
  // only narrows further once raised above 0.
  const [draftHasTrainerForm, setDraftHasTrainerForm] = useState(false);
  const [hasTrainerForm, setHasTrainerForm] = useState(false);

  const [fetchTrigger, setFetchTrigger] = useState(0);

  useEffect(() => {
    chatApi.getIspFilterBounds().then(setFilterBounds).catch(() => {});
    chatApi.getIspCourses().then(setAvailableCourses).catch(() => {});
    chatApi.getIspGoings().then(setAvailableGoings).catch(() => {});
    chatApi.getIspRaceClasses().then(setAvailableRaceClasses).catch(() => {});
    chatApi.getIspRaceTypes().then(setAvailableRaceTypes).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await chatApi.getIndustrySp(
          1, PAGE_SIZE, 1, 100, [], minIsp, maxIsp, "asc", 0, 100,
          1, undefined, minDate || undefined, maxDate || undefined,
          [...selectedCourses], [...selectedGoings], [...selectedRaceClasses], [...selectedRaceTypes],
          undefined, undefined,
          trainerFormMinWinRate, hasTrainerForm ? 1 : 0, 100,
          runnerName
        );
        if (cancelled) return;
        setRaces(result.data);
        setPage(1);
        setTotalPages(result.totalPages);
        setTotalRaces(result.total);
      } catch {
        if (!cancelled) setError("Failed to load runner history");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runnerName, fetchTrigger]);

  async function loadMore() {
    if (page >= totalPages) return;
    const next = page + 1;
    const result = await chatApi.getIndustrySp(
      next, PAGE_SIZE, 1, 100, [], minIsp, maxIsp, "asc", 0, 100,
      1, undefined, minDate || undefined, maxDate || undefined,
      [...selectedCourses], [...selectedGoings], [...selectedRaceClasses], [...selectedRaceTypes],
      undefined, undefined,
      trainerFormMinWinRate, hasTrainerForm ? 1 : 0, 100,
      runnerName
    );
    setRaces(prev => [...prev, ...result.data]);
    setPage(next);
    setTotalPages(result.totalPages);
  }

  function applyFilter() {
    setSelectedCourses(new Set(draftSelectedCourses));
    setSelectedGoings(new Set(draftSelectedGoings));
    setSelectedRaceClasses(new Set(draftSelectedRaceClasses));
    setSelectedRaceTypes(new Set(draftSelectedRaceTypes));
    setMinDate(draftMinDate);
    setMaxDate(draftMaxDate);
    const maxIspLimit = filterBounds?.maxIsp ?? 100000;
    const minI = Math.max(1, parseFloat(draftMinIsp) || 1);
    const maxI = Math.min(maxIspLimit, Math.max(minI, parseFloat(draftMaxIsp) || maxIspLimit));
    setDraftMinIsp(String(minI));
    setDraftMaxIsp(String(maxI));
    setMinIsp(minI);
    setMaxIsp(maxI);
    const winRate = Math.min(100, Math.max(0, parseFloat(draftTrainerFormMinWinRate) || 0));
    setDraftTrainerFormMinWinRate(String(winRate));
    setTrainerFormMinWinRate(winRate);
    setHasTrainerForm(draftHasTrainerForm);
    setFetchTrigger(t => t + 1);
  }

  function resetFilter() {
    setDraftSelectedCourses(new Set());
    setDraftSelectedGoings(new Set());
    setDraftSelectedRaceClasses(new Set());
    setDraftSelectedRaceTypes(new Set());
    setSelectedCourses(new Set());
    setSelectedGoings(new Set());
    setSelectedRaceClasses(new Set());
    setSelectedRaceTypes(new Set());
    setDraftMinDate("");
    setDraftMaxDate("");
    setMinDate("");
    setMaxDate("");
    setDraftMinIsp("1");
    setDraftMaxIsp("1000");
    setMinIsp(1);
    setMaxIsp(1000);
    setDraftTrainerFormMinWinRate("0");
    setTrainerFormMinWinRate(0);
    setDraftHasTrainerForm(false);
    setHasTrainerForm(false);
    setFetchTrigger(t => t + 1);
  }

  function renderChipRow(label: string, testId: string, values: string[], draft: Set<string>, setDraft: (s: Set<string>) => void) {
    return (
      <View testID={`runner-history-filter-row-${testId}`} style={styles.chipRow}>
        <Text style={styles.chipLabel}>{label}</Text>
        {values.length === 0 ? (
          <Text style={styles.chipLoading}>Loading…</Text>
        ) : (
          <ScrollView horizontal testID={`runner-history-${testId}`} showsHorizontalScrollIndicator={false}>
            {values.map(value => {
              const active = draft.has(value);
              return (
                <Chip
                  key={value}
                  testID={`runner-history-${testId}-${value}`}
                  compact
                  mode={active ? "flat" : "outlined"}
                  selected={active}
                  onPress={() => {
                    const next = new Set(draft);
                    if (next.has(value)) next.delete(value); else next.add(value);
                    setDraft(next);
                  }}
                  style={styles.chip}
                >
                  {value}
                </Chip>
              );
            })}
          </ScrollView>
        )}
      </View>
    );
  }

  const runnerRunsInRace = (race: IspRace) =>
    race.runners.find(r => r.name.toLowerCase() === runnerName.toLowerCase());

  return (
    <SafeAreaView testID="runner-history-screen" style={styles.screen}>
      <AppHeader
        navigate={navigate}
        isAuthenticated={isAuthenticated}
        onLogout={onLogout}
        onRequestAuth={onRequestAuth}
        onBack={onBack}
        subtitle={`${runnerName} · Runner History`}
        testIdPrefix="runner-history"
      />

      <View testID="runner-history-filter-bar" style={styles.filterBar}>
        {renderChipRow("Course", "course", availableCourses, draftSelectedCourses, setDraftSelectedCourses)}
        {renderChipRow("Going", "going", availableGoings, draftSelectedGoings, setDraftSelectedGoings)}
        {renderChipRow("Class", "race-class", availableRaceClasses, draftSelectedRaceClasses, setDraftSelectedRaceClasses)}
        {renderChipRow("Type", "race-type", availableRaceTypes, draftSelectedRaceTypes, setDraftSelectedRaceTypes)}

        <View testID="runner-history-filter-row-date" style={styles.filterRow}>
          <Text style={styles.filterLabel}>Date</Text>
          <DateRangePicker
            testID="runner-history-date-range-picker"
            fromDate={draftMinDate || ABSOLUTE_MIN_DATE}
            toDate={draftMaxDate || ABSOLUTE_MAX_DATE}
            minDate={ABSOLUTE_MIN_DATE}
            maxDate={ABSOLUTE_MAX_DATE}
            onChange={(from, to) => { setDraftMinDate(from); setDraftMaxDate(to); }}
          />
        </View>

        <View testID="runner-history-filter-row-isp" style={styles.filterRow}>
          <Text style={styles.filterLabel}>ISP</Text>
          <RNTextInput
            testID="runner-history-min-isp"
            style={styles.gridInput}
            value={draftMinIsp}
            onChangeText={setDraftMinIsp}
            keyboardType="decimal-pad"
          />
          <Text style={styles.dash}>–</Text>
          <RNTextInput
            testID="runner-history-max-isp"
            style={styles.gridInput}
            value={draftMaxIsp}
            onChangeText={setDraftMaxIsp}
            keyboardType="decimal-pad"
          />
        </View>

        <View testID="runner-history-filter-row-has-trainer-form" style={styles.filterRow}>
          <TouchableOpacity
            testID="runner-history-has-trainer-form"
            accessibilityRole="checkbox"
            accessibilityState={{ checked: draftHasTrainerForm }}
            aria-checked={draftHasTrainerForm}
            style={styles.checkboxRow}
            onPress={() => setDraftHasTrainerForm(v => !v)}
          >
            <Checkbox status={draftHasTrainerForm ? "checked" : "unchecked"} onPress={() => setDraftHasTrainerForm(v => !v)} />
            <Text style={styles.filterLabel}>Has trainer form</Text>
          </TouchableOpacity>
        </View>

        <View testID="runner-history-filter-row-trainer-form" style={styles.filterRow}>
          <Text style={styles.filterLabel}>Trainer Form Win %</Text>
          <RNTextInput
            testID="runner-history-trainer-form-min-win-rate"
            style={styles.gridInput}
            value={draftTrainerFormMinWinRate}
            onChangeText={setDraftTrainerFormMinWinRate}
            keyboardType="decimal-pad"
          />
        </View>

        <View style={styles.filterActions}>
          <Button testID="runner-history-filter-apply" mode="contained" compact onPress={applyFilter} style={styles.applyBtn}>
            Apply
          </Button>
          <Button testID="runner-history-filter-reset" mode="outlined" compact onPress={resetFilter} style={styles.resetBtn}>
            Reset
          </Button>
        </View>
      </View>

      <View style={styles.body}>
        {isLoading && (
          <View testID="runner-history-loading" style={styles.centered}>
            <ActivityIndicator size="large" animating color={colors.primary} />
            <Text style={styles.loadingText}>Loading history…</Text>
          </View>
        )}

        {error && !isLoading && (
          <View testID="runner-history-error" style={styles.centered}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {!isLoading && !error && (
          <ScrollView testID="runner-history-list" style={styles.list}>
            <PageContainer>
              <Text style={styles.summary}>{totalRaces} race{totalRaces === 1 ? "" : "s"}</Text>
              {races.length === 0 && <Text style={styles.emptyText}>No races found for this runner.</Text>}
              {races.map(race => {
                const runner = runnerRunsInRace(race);
                if (!runner) return null;
                const pnl = runnerPnl(runner);
                return (
                  <TouchableOpacity
                    key={race.raceId}
                    testID={`runner-history-item-${race.raceId}`}
                    style={styles.raceRow}
                    onPress={() => onNavigateToRunner(race.raceId, runner.id)}
                  >
                    <Text style={styles.raceDate}>{formatRaceDate(race.raceTime)}</Text>
                    <Text style={styles.raceCourse} numberOfLines={1}>{race.course}</Text>
                    <Text style={styles.raceType}>{race.raceType}</Text>
                    {runner.isp != null && (
                      <Text style={styles.ispBadge}>ISP {formatIsp(runner, oddsMode)}</Text>
                    )}
                    {pnl != null && runner.isp != null && (
                      <Text style={[styles.racePnl, pnl >= 0 ? styles.pnlPos : styles.pnlNeg]}>
                        {formatPnl(pnl)} ({formatPct(pnl, stakeToWin1(runner.isp))})
                      </Text>
                    )}
                  </TouchableOpacity>
                );
              })}
              {page < totalPages && (
                <Button testID="runner-history-load-more" mode="contained-tonal" onPress={loadMore} style={styles.loadMoreButton}>
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
  screen: { flex: 1, backgroundColor: colors.background },
  filterBar: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  chipRow: { gap: 4 },
  chipLabel: { fontSize: 12, fontWeight: "600", color: colors.textSecondary },
  chipLoading: { fontSize: 12, color: colors.textTertiary },
  chip: { marginRight: 4 },
  filterRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" },
  filterLabel: { fontSize: 12, fontWeight: "600", color: colors.textSecondary, minWidth: 100 },
  checkboxRow: { flexDirection: "row", alignItems: "center", flexShrink: 1 },
  gridInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    fontSize: 13,
    width: 70,
    color: colors.text,
  },
  dash: { color: colors.textTertiary },
  filterActions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
  applyBtn: { borderRadius: radii.sm },
  resetBtn: { borderRadius: radii.sm },
  body: { flex: 1 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xxl, gap: spacing.md },
  loadingText: { color: colors.textSecondary },
  errorText: { color: colors.danger, fontSize: 16 },
  list: { flex: 1, ...({ overscrollBehavior: "contain" } as any) },
  summary: { padding: spacing.md, color: colors.textTertiary, fontSize: 12 },
  emptyText: { padding: spacing.xl, color: colors.textTertiary, fontSize: 16, textAlign: "center" },
  raceRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    rowGap: 4,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  raceDate: { fontSize: 12, color: colors.textSecondary },
  raceCourse: { fontSize: 13, fontWeight: "600", color: colors.text, flexShrink: 1, minWidth: 0 },
  raceType: {
    fontSize: 11,
    color: colors.textSecondary,
    backgroundColor: colors.background,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: radii.sm,
  },
  ispBadge: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.accent,
    backgroundColor: colors.primaryLight,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: radii.sm,
  },
  racePnl: { fontSize: 12, fontWeight: "700", marginLeft: "auto" },
  pnlPos: { color: colors.pnlPositive },
  pnlNeg: { color: colors.pnlNegative },
  loadMoreButton: { margin: spacing.lg, borderRadius: radii.md },
});
