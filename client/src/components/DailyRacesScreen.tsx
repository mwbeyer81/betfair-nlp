import React, { useState, useEffect, useMemo } from "react";
import {
  View,
  ScrollView,
  TextInput as RNTextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  KeyboardTypeOptions,
} from "react-native";
import { Text, Button, Chip, Checkbox, ActivityIndicator } from "react-native-paper";
import { chatApi, DailyRace } from "../services/chatApi";
import { colors, radii, spacing } from "../theme";
import { PageContainer } from "./PageContainer";
import { AppHeader } from "./AppHeader";
import type { Route } from "../hooks/useRouter";
import { buildDailyRacesPicks, DailyRacesFilters } from "../utils/dailyRaceFormat";
import { fairDecimalOdds, toFractionalOdds } from "../utils/oddsFormat";
import {
  urlIntParam,
  urlFloatParam,
  urlStringParam,
  urlSetParam,
  updateUrlParams,
  dailyRacesUrlHasAnyParams,
} from "../utils/dailyRacesUrlParams";

interface DailyRacesScreenProps {
  navigate: (to: Route, query?: string) => void;
  isAuthenticated: boolean;
  onLogout?: () => void;
  onNavigateToEvent: (eventId: string) => void;
  onNavigateToRace: (raceId: string) => void;
  // "YYYY-MM-DD" — omit to let the backend default to its own current date.
  date?: string;
}

interface EventGroup {
  eventId: string;
  course: string;
  date: string;
  races: DailyRace[];
}

function groupByEvent(races: DailyRace[]): EventGroup[] {
  const byId = new Map<string, EventGroup>();
  for (const race of races) {
    const existing = byId.get(race.eventId);
    if (existing) {
      existing.races.push(race);
    } else {
      byId.set(race.eventId, { eventId: race.eventId, course: race.course, date: race.date, races: [race] });
    }
  }
  return Array.from(byId.values()).sort((a, b) => a.course.localeCompare(b.course));
}

const FILTER_DEFAULTS = {
  minModelWinProbability: 0,
  trainerFormMinWinRate: 0,
  minFieldSize: 1,
  maxFieldSize: 40,
};

function distinctValues(races: DailyRace[], pick: (race: DailyRace) => string | null): string[] {
  const values = new Set<string>();
  for (const race of races) {
    const value = pick(race);
    if (value) values.add(value);
  }
  return Array.from(values).sort();
}

export const DailyRacesScreen: React.FC<DailyRacesScreenProps> = ({
  navigate,
  isAuthenticated,
  onLogout,
  onNavigateToEvent,
  onNavigateToRace,
  date,
}) => {
  const [races, setRaces] = useState<DailyRace[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filtersVisible, setFiltersVisible] = useState(true);
  const [hasAppliedOnce, setHasAppliedOnce] = useState(() => dailyRacesUrlHasAnyParams());

  // Draft (uncommitted) filter state — mirrors IndustrySpScreen's
  // draft/applied split: typing or toggling a filter only affects these
  // values until Apply commits them below.
  const [draftMinModelWinProbability, setDraftMinModelWinProbability] = useState(() =>
    String(urlFloatParam("minModelWinProbability", FILTER_DEFAULTS.minModelWinProbability))
  );
  const [draftTrainerFormMinWinRate, setDraftTrainerFormMinWinRate] = useState(() =>
    String(urlFloatParam("trainerFormMinWinRate", FILTER_DEFAULTS.trainerFormMinWinRate))
  );
  const [draftHasTrainerForm, setDraftHasTrainerForm] = useState(() => urlStringParam("hasTrainerForm", "") === "true");
  const [draftMinFieldSize, setDraftMinFieldSize] = useState(() =>
    String(urlIntParam("minFieldSize", FILTER_DEFAULTS.minFieldSize))
  );
  const [draftMaxFieldSize, setDraftMaxFieldSize] = useState(() =>
    String(urlIntParam("maxFieldSize", FILTER_DEFAULTS.maxFieldSize))
  );
  const [draftSelectedCourses, setDraftSelectedCourses] = useState(() => urlSetParam("courses"));
  const [draftSelectedGoings, setDraftSelectedGoings] = useState(() => urlSetParam("goings"));
  const [draftSelectedRaceClasses, setDraftSelectedRaceClasses] = useState(() => urlSetParam("raceClasses"));
  const [draftSelectedRaceTypes, setDraftSelectedRaceTypes] = useState(() => urlSetParam("raceTypes"));
  const [draftSelectedRegions, setDraftSelectedRegions] = useState(() => urlSetParam("regions"));
  const [draftTrainerSearch, setDraftTrainerSearch] = useState(() => urlStringParam("trainer", ""));
  const [draftJockeySearch, setDraftJockeySearch] = useState(() => urlStringParam("jockey", ""));

  // Applied (committed) filter state — what the picks list is actually
  // built from. Only changes via applyFilter()/resetFilters().
  const [minModelWinProbability, setMinModelWinProbability] = useState(() =>
    urlFloatParam("minModelWinProbability", FILTER_DEFAULTS.minModelWinProbability)
  );
  const [trainerFormMinWinRate, setTrainerFormMinWinRate] = useState(() =>
    urlFloatParam("trainerFormMinWinRate", FILTER_DEFAULTS.trainerFormMinWinRate)
  );
  const [minTrainerFormRunners, setMinTrainerFormRunners] = useState(() =>
    urlStringParam("hasTrainerForm", "") === "true" ? 1 : 0
  );
  const [minFieldSize, setMinFieldSize] = useState(() => urlIntParam("minFieldSize", FILTER_DEFAULTS.minFieldSize));
  const [maxFieldSize, setMaxFieldSize] = useState(() => urlIntParam("maxFieldSize", FILTER_DEFAULTS.maxFieldSize));
  const [selectedCourses, setSelectedCourses] = useState(() => urlSetParam("courses"));
  const [selectedGoings, setSelectedGoings] = useState(() => urlSetParam("goings"));
  const [selectedRaceClasses, setSelectedRaceClasses] = useState(() => urlSetParam("raceClasses"));
  const [selectedRaceTypes, setSelectedRaceTypes] = useState(() => urlSetParam("raceTypes"));
  const [selectedRegions, setSelectedRegions] = useState(() => urlSetParam("regions"));
  const [trainerSearch, setTrainerSearch] = useState(() => urlStringParam("trainer", ""));
  const [jockeySearch, setJockeySearch] = useState(() => urlStringParam("jockey", ""));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const data = await chatApi.getDailyRaces(date);
        if (!cancelled) setRaces(data);
      } catch {
        if (!cancelled) setError("Failed to load daily races");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [date]);

  const events = groupByEvent(races);

  const availableCourses = useMemo(() => distinctValues(races, r => r.course), [races]);
  const availableGoings = useMemo(() => distinctValues(races, r => r.going), [races]);
  const availableRaceClasses = useMemo(() => distinctValues(races, r => r.raceClass), [races]);
  const availableRaceTypes = useMemo(() => distinctValues(races, r => r.type), [races]);
  const availableRegions = useMemo(() => distinctValues(races, r => r.region), [races]);

  const activeFilters: DailyRacesFilters = useMemo(
    () => ({
      minModelWinProbability,
      trainerFormMinWinRate,
      minTrainerFormRunners,
      minFieldSize,
      maxFieldSize,
      selectedCourses,
      selectedGoings,
      selectedRaceClasses,
      selectedRaceTypes,
      selectedRegions,
      trainerSearch,
      jockeySearch,
    }),
    [
      minModelWinProbability, trainerFormMinWinRate, minTrainerFormRunners, minFieldSize, maxFieldSize,
      selectedCourses, selectedGoings, selectedRaceClasses, selectedRaceTypes, selectedRegions,
      trainerSearch, jockeySearch,
    ]
  );

  const picks = useMemo(
    () => (hasAppliedOnce ? buildDailyRacesPicks(races, activeFilters) : []),
    [races, activeFilters, hasAppliedOnce]
  );

  function applyFilter() {
    const nextMinModelWinProbability = parseFloat(draftMinModelWinProbability);
    const nextTrainerFormMinWinRate = parseFloat(draftTrainerFormMinWinRate);
    const nextMinFieldSize = parseInt(draftMinFieldSize, 10);
    const nextMaxFieldSize = parseInt(draftMaxFieldSize, 10);

    setMinModelWinProbability(Number.isFinite(nextMinModelWinProbability) ? nextMinModelWinProbability : FILTER_DEFAULTS.minModelWinProbability);
    setTrainerFormMinWinRate(Number.isFinite(nextTrainerFormMinWinRate) ? nextTrainerFormMinWinRate : FILTER_DEFAULTS.trainerFormMinWinRate);
    setMinTrainerFormRunners(draftHasTrainerForm ? 1 : 0);
    setMinFieldSize(Number.isFinite(nextMinFieldSize) ? nextMinFieldSize : FILTER_DEFAULTS.minFieldSize);
    setMaxFieldSize(Number.isFinite(nextMaxFieldSize) ? nextMaxFieldSize : FILTER_DEFAULTS.maxFieldSize);
    setSelectedCourses(new Set(draftSelectedCourses));
    setSelectedGoings(new Set(draftSelectedGoings));
    setSelectedRaceClasses(new Set(draftSelectedRaceClasses));
    setSelectedRaceTypes(new Set(draftSelectedRaceTypes));
    setSelectedRegions(new Set(draftSelectedRegions));
    setTrainerSearch(draftTrainerSearch);
    setJockeySearch(draftJockeySearch);
    setHasAppliedOnce(true);

    updateUrlParams({
      minModelWinProbability: draftMinModelWinProbability !== String(FILTER_DEFAULTS.minModelWinProbability) ? draftMinModelWinProbability : undefined,
      trainerFormMinWinRate: draftTrainerFormMinWinRate !== String(FILTER_DEFAULTS.trainerFormMinWinRate) ? draftTrainerFormMinWinRate : undefined,
      hasTrainerForm: draftHasTrainerForm ? "true" : undefined,
      minFieldSize: draftMinFieldSize !== String(FILTER_DEFAULTS.minFieldSize) ? draftMinFieldSize : undefined,
      maxFieldSize: draftMaxFieldSize !== String(FILTER_DEFAULTS.maxFieldSize) ? draftMaxFieldSize : undefined,
      courses: draftSelectedCourses.size > 0 ? Array.from(draftSelectedCourses).join(",") : undefined,
      goings: draftSelectedGoings.size > 0 ? Array.from(draftSelectedGoings).join(",") : undefined,
      raceClasses: draftSelectedRaceClasses.size > 0 ? Array.from(draftSelectedRaceClasses).join(",") : undefined,
      raceTypes: draftSelectedRaceTypes.size > 0 ? Array.from(draftSelectedRaceTypes).join(",") : undefined,
      regions: draftSelectedRegions.size > 0 ? Array.from(draftSelectedRegions).join(",") : undefined,
      trainer: draftTrainerSearch || undefined,
      jockey: draftJockeySearch || undefined,
    });
  }

  function resetFilters() {
    setDraftMinModelWinProbability(String(FILTER_DEFAULTS.minModelWinProbability));
    setDraftTrainerFormMinWinRate(String(FILTER_DEFAULTS.trainerFormMinWinRate));
    setDraftHasTrainerForm(false);
    setDraftMinFieldSize(String(FILTER_DEFAULTS.minFieldSize));
    setDraftMaxFieldSize(String(FILTER_DEFAULTS.maxFieldSize));
    setDraftSelectedCourses(new Set());
    setDraftSelectedGoings(new Set());
    setDraftSelectedRaceClasses(new Set());
    setDraftSelectedRaceTypes(new Set());
    setDraftSelectedRegions(new Set());
    setDraftTrainerSearch("");
    setDraftJockeySearch("");

    setMinModelWinProbability(FILTER_DEFAULTS.minModelWinProbability);
    setTrainerFormMinWinRate(FILTER_DEFAULTS.trainerFormMinWinRate);
    setMinTrainerFormRunners(0);
    setMinFieldSize(FILTER_DEFAULTS.minFieldSize);
    setMaxFieldSize(FILTER_DEFAULTS.maxFieldSize);
    setSelectedCourses(new Set());
    setSelectedGoings(new Set());
    setSelectedRaceClasses(new Set());
    setSelectedRaceTypes(new Set());
    setSelectedRegions(new Set());
    setTrainerSearch("");
    setJockeySearch("");
    setHasAppliedOnce(false);

    updateUrlParams({
      minModelWinProbability: undefined,
      trainerFormMinWinRate: undefined,
      hasTrainerForm: undefined,
      minFieldSize: undefined,
      maxFieldSize: undefined,
      courses: undefined,
      goings: undefined,
      raceClasses: undefined,
      raceTypes: undefined,
      regions: undefined,
      trainer: undefined,
      jockey: undefined,
    });
  }

  function toggleChipFilter(setDraftSelected: React.Dispatch<React.SetStateAction<Set<string>>>, value: string) {
    setDraftSelected(prev => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value); else next.add(value);
      return next;
    });
  }

  function renderRangeRow(opts: {
    filterKey: string;
    label: string;
    minValue: string;
    onMinChange: (v: string) => void;
    minTestId: string;
    maxValue: string;
    onMaxChange: (v: string) => void;
    maxTestId: string;
    keyboardType: KeyboardTypeOptions;
    maxLength: number;
  }) {
    const { filterKey, label, minValue, onMinChange, minTestId, maxValue, onMaxChange, maxTestId, keyboardType, maxLength } = opts;
    return (
      <View key={filterKey} testID={`daily-races-filter-row-${filterKey}`} style={styles.filterGridRow}>
        <View style={styles.filterGridLabel}>
          <Text style={styles.filterGridLabelText}>{label}</Text>
        </View>
        <RNTextInput
          testID={minTestId}
          style={styles.gridInput}
          value={minValue}
          onChangeText={onMinChange}
          keyboardType={keyboardType}
          maxLength={maxLength}
        />
        <Text style={styles.filterGridDash}>–</Text>
        <RNTextInput
          testID={maxTestId}
          style={styles.gridInput}
          value={maxValue}
          onChangeText={onMaxChange}
          keyboardType={keyboardType}
          maxLength={maxLength}
        />
      </View>
    );
  }

  function renderTextFilterRow(opts: { filterKey: string; label: string; value: string; onChange: (v: string) => void; testId: string; placeholder?: string }) {
    const { filterKey, label, value, onChange, testId, placeholder } = opts;
    return (
      <View key={filterKey} testID={`daily-races-filter-row-${filterKey}`} style={styles.filterGridRow}>
        <View style={styles.filterGridLabel}>
          <Text style={styles.filterGridLabelText}>{label}</Text>
        </View>
        <RNTextInput
          testID={testId}
          style={styles.textFilterInput}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>
    );
  }

  function renderCheckboxFilterRow(opts: { filterKey: string; label: string; testId: string; checked: boolean; onToggle: () => void }) {
    const { filterKey, label, testId, checked, onToggle } = opts;
    return (
      <View key={filterKey} testID={`daily-races-filter-row-${filterKey}`} style={styles.filterGridRow}>
        <TouchableOpacity
          testID={testId}
          accessibilityRole="checkbox"
          accessibilityState={{ checked }}
          aria-checked={checked}
          style={styles.checkboxRow}
          onPress={onToggle}
        >
          <Checkbox status={checked ? "checked" : "unchecked"} onPress={onToggle} />
          <Text style={styles.filterGridLabelText}>{label}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  function renderChipRow(opts: {
    filterKey: string;
    testId: string;
    label: string;
    values: string[];
    draftSelected: Set<string>;
    appliedSelected: Set<string>;
    onToggle: (value: string) => void;
  }) {
    const { filterKey, testId, label, values, draftSelected, appliedSelected, onToggle } = opts;
    if (values.length === 0) return null;
    return (
      <View key={filterKey} testID={`daily-races-filter-row-${filterKey}`} style={styles.chipFilterRow}>
        <Text style={styles.chipFilterLabel}>{label}</Text>
        <ScrollView
          horizontal
          testID={testId}
          style={styles.countryBar}
          contentContainerStyle={styles.countryBarContent}
          showsHorizontalScrollIndicator={false}
        >
          {values.map(value => {
            const inDraft = draftSelected.has(value);
            const applied = inDraft && appliedSelected.has(value);
            const pending = inDraft && !applied;
            const chipStyle = applied ? styles.countryChipActive : pending ? styles.countryChipPending : styles.countryChip;
            const textStyle = applied ? styles.countryChipTextActive : pending ? styles.countryChipTextPending : styles.countryChipText;
            return (
              <Chip
                key={value}
                testID={`${testId}-${value}`}
                accessibilityState={{ selected: inDraft, busy: pending }}
                compact
                mode={inDraft ? "flat" : "outlined"}
                selected={inDraft}
                onPress={() => onToggle(value)}
                style={chipStyle}
                textStyle={textStyle}
              >
                {pending ? `${value} •` : value}
              </Chip>
            );
          })}
        </ScrollView>
      </View>
    );
  }

  return (
    <SafeAreaView testID="daily-races-screen" style={styles.screen}>
      <AppHeader
        navigate={navigate}
        isAuthenticated={isAuthenticated}
        onLogout={onLogout}
        subtitle={!isLoading ? `Daily Races · ${events.length} events · ${races.length} races` : "Daily Races"}
        testIdPrefix="daily-races"
        extraActions={wrap => (
          <Button
            testID="daily-races-filters-toggle"
            mode="outlined"
            compact
            onPress={wrap(() => setFiltersVisible(v => !v))}
            style={styles.headerToggleButton}
            labelStyle={styles.headerToggleButtonLabel}
          >
            {filtersVisible ? "Hide filters ▾" : "Show filters ▸"}
          </Button>
        )}
      />

      <View style={styles.body}>
        {isLoading && (
          <View testID="daily-races-loading" style={styles.centered}>
            <ActivityIndicator size="large" animating color={colors.primary} />
            <Text variant="bodyMedium" style={styles.loadingText}>Loading today's races…</Text>
          </View>
        )}

        {error && !isLoading && (
          <View testID="daily-races-error" style={styles.centered}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {!isLoading && !error && (
          <ScrollView testID="daily-races-list" style={styles.list}>
            <PageContainer>
              {filtersVisible && (
                <View testID="daily-races-filter-bar" style={styles.filterGrid}>
                  {renderTextFilterRow({
                    filterKey: "minModelWinProbability",
                    label: "Model Win %",
                    value: draftMinModelWinProbability,
                    onChange: setDraftMinModelWinProbability,
                    testId: "daily-races-min-model-win-probability",
                  })}
                  {renderTextFilterRow({
                    filterKey: "trainerFormWinRate",
                    label: "Trainer Form Win %",
                    value: draftTrainerFormMinWinRate,
                    onChange: setDraftTrainerFormMinWinRate,
                    testId: "daily-races-trainer-form-min-win-rate",
                  })}
                  {renderCheckboxFilterRow({
                    filterKey: "hasTrainerForm",
                    label: "Has trainer form",
                    testId: "daily-races-has-trainer-form",
                    checked: draftHasTrainerForm,
                    onToggle: () => setDraftHasTrainerForm(v => !v),
                  })}
                  {renderRangeRow({
                    filterKey: "fieldSize",
                    label: "Field Size",
                    minValue: draftMinFieldSize,
                    onMinChange: setDraftMinFieldSize,
                    minTestId: "daily-races-min-field-size",
                    maxValue: draftMaxFieldSize,
                    onMaxChange: setDraftMaxFieldSize,
                    maxTestId: "daily-races-max-field-size",
                    keyboardType: "numeric",
                    maxLength: 3,
                  })}
                  {renderTextFilterRow({
                    filterKey: "trainer",
                    label: "Trainer",
                    value: draftTrainerSearch,
                    onChange: setDraftTrainerSearch,
                    testId: "daily-races-trainer-search",
                    placeholder: "Trainer name starts with…",
                  })}
                  {renderTextFilterRow({
                    filterKey: "jockey",
                    label: "Jockey",
                    value: draftJockeySearch,
                    onChange: setDraftJockeySearch,
                    testId: "daily-races-jockey-search",
                    placeholder: "Jockey name starts with…",
                  })}
                  {renderChipRow({
                    filterKey: "course",
                    testId: "daily-races-course",
                    label: "Course",
                    values: availableCourses,
                    draftSelected: draftSelectedCourses,
                    appliedSelected: selectedCourses,
                    onToggle: value => toggleChipFilter(setDraftSelectedCourses, value),
                  })}
                  {renderChipRow({
                    filterKey: "going",
                    testId: "daily-races-going",
                    label: "Going",
                    values: availableGoings,
                    draftSelected: draftSelectedGoings,
                    appliedSelected: selectedGoings,
                    onToggle: value => toggleChipFilter(setDraftSelectedGoings, value),
                  })}
                  {renderChipRow({
                    filterKey: "race-class",
                    testId: "daily-races-race-class",
                    label: "Class",
                    values: availableRaceClasses,
                    draftSelected: draftSelectedRaceClasses,
                    appliedSelected: selectedRaceClasses,
                    onToggle: value => toggleChipFilter(setDraftSelectedRaceClasses, value),
                  })}
                  {renderChipRow({
                    filterKey: "race-type",
                    testId: "daily-races-race-type",
                    label: "Type",
                    values: availableRaceTypes,
                    draftSelected: draftSelectedRaceTypes,
                    appliedSelected: selectedRaceTypes,
                    onToggle: value => toggleChipFilter(setDraftSelectedRaceTypes, value),
                  })}
                  {renderChipRow({
                    filterKey: "region",
                    testId: "daily-races-region",
                    label: "Region",
                    values: availableRegions,
                    draftSelected: draftSelectedRegions,
                    appliedSelected: selectedRegions,
                    onToggle: value => toggleChipFilter(setDraftSelectedRegions, value),
                  })}
                  <View style={styles.filterActions}>
                    <Button
                      testID="daily-races-filter-apply"
                      mode="contained"
                      compact
                      onPress={applyFilter}
                      style={styles.applyBtn}
                      labelStyle={styles.applyBtnLabel}
                    >
                      Apply
                    </Button>
                    <Button
                      testID="daily-races-filter-reset"
                      mode="outlined"
                      compact
                      onPress={resetFilters}
                      style={styles.resetBtn}
                      labelStyle={styles.resetBtnLabel}
                    >
                      Reset
                    </Button>
                  </View>
                </View>
              )}

              {hasAppliedOnce && (
                <View testID="daily-races-picks-list" style={styles.picksSection}>
                  <Text style={styles.picksHeading}>Today's Picks · {picks.length}</Text>
                  {picks.length === 0 && (
                    <Text testID="daily-races-picks-empty" style={styles.emptyText}>
                      No runners match these filters.
                    </Text>
                  )}
                  {picks.map(({ race, runner }) => (
                    <TouchableOpacity
                      key={runner.runnerId}
                      testID={`daily-races-pick-${runner.runnerId}`}
                      style={styles.pickRow}
                      onPress={() => onNavigateToRace(race.raceId)}
                    >
                      <Text style={styles.pickHorse} numberOfLines={1}>{runner.horse}</Text>
                      <Text style={styles.pickMeta} numberOfLines={1}>{race.course} · {race.offTime}</Text>
                      <Text testID={`daily-races-pick-model-${runner.runnerId}`} style={styles.pickModelBadge}>
                        Model {runner.modelWinProbability?.toFixed(0)}%
                      </Text>
                      {runner.modelWinProbability != null && fairDecimalOdds(runner.modelWinProbability) != null && (
                        <Text testID={`daily-races-pick-fair-odds-${runner.runnerId}`} style={styles.pickFairOddsBadge}>
                          Fair {toFractionalOdds(fairDecimalOdds(runner.modelWinProbability)!)} ({fairDecimalOdds(runner.modelWinProbability)!.toFixed(2)})
                        </Text>
                      )}
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <Text style={styles.eventsHeading}>Meetings</Text>
              {events.length === 0 && (
                <Text testID="daily-races-empty" style={styles.emptyText}>No races found for today.</Text>
              )}
              {events.map(event => (
                <TouchableOpacity
                  key={event.eventId}
                  testID={`daily-races-event-${event.eventId}`}
                  style={styles.eventRow}
                  onPress={() => onNavigateToEvent(event.eventId)}
                >
                  <Text style={styles.eventCourse}>{event.course}</Text>
                  <Text style={styles.eventDate}>{event.date}</Text>
                  <Text style={styles.eventCount}>{event.races.length} races</Text>
                </TouchableOpacity>
              ))}
            </PageContainer>
          </ScrollView>
        )}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xxl, gap: spacing.md },
  loadingText: { color: colors.textSecondary },
  errorText: { color: colors.danger, fontSize: 16 },
  list: { flex: 1, ...({ overscrollBehavior: "contain" } as any) },
  emptyText: { padding: spacing.xl, color: colors.textTertiary, fontSize: 16, textAlign: "center" },
  eventsHeading: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.textSecondary,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  eventRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
    borderRadius: radii.md,
    marginBottom: spacing.sm,
    marginHorizontal: spacing.lg,
  },
  eventCourse: { fontSize: 15, fontWeight: "700", color: colors.text },
  eventDate: { fontSize: 12, color: colors.textSecondary },
  eventCount: { fontSize: 12, color: colors.textTertiary, marginLeft: "auto" },

  headerToggleButton: {
    marginHorizontal: 3,
    borderRadius: radii.md,
    borderColor: "rgba(255,255,255,0.6)",
  },
  headerToggleButtonLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: "#fff",
  },
  filterGrid: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.primaryLight,
    borderRadius: radii.md,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  filterGridRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  filterGridLabel: {
    width: 120,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  filterGridLabelText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textSecondary,
    flexShrink: 1,
  },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 1,
  },
  gridInput: {
    width: 84,
    height: 40,
    fontSize: 16,
    fontWeight: "700",
    color: colors.text,
    textAlign: "center",
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: 4,
  },
  filterGridDash: {
    fontSize: 16,
    color: colors.textSecondary,
  },
  textFilterInput: {
    flex: 1,
    height: 40,
    fontSize: 14,
    fontWeight: "500",
    color: colors.text,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: 10,
  },
  chipFilterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  chipFilterLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.textSecondary,
    width: 60,
  },
  countryBar: {
    flex: 1,
    ...({ overscrollBehavior: "contain" } as any),
  },
  countryBarContent: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 4,
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
  countryChipPending: {
    backgroundColor: colors.textTertiary,
    borderColor: colors.textTertiary,
  },
  countryChipText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textSecondary,
  },
  countryChipTextActive: {
    color: "#fff",
  },
  countryChipTextPending: {
    color: "#fff",
  },
  filterActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  applyBtn: {
    borderRadius: radii.sm,
    flex: 1,
  },
  applyBtnLabel: {
    fontSize: 14,
    fontWeight: "700",
  },
  resetBtn: {
    borderRadius: radii.sm,
    borderColor: colors.primary,
  },
  resetBtnLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.primary,
  },

  picksSection: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  picksHeading: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  pickRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    rowGap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    borderRadius: radii.md,
    marginBottom: spacing.xs,
    gap: spacing.sm,
  },
  pickHorse: { fontSize: 13, fontWeight: "600", color: colors.text, maxWidth: 160 },
  pickMeta: { fontSize: 11, color: colors.textSecondary },
  pickModelBadge: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.accent,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: radii.sm,
  },
  pickFairOddsBadge: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.info,
    backgroundColor: colors.infoLight,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: radii.sm,
  },
});
