import React, { useEffect, useMemo, useState } from "react";
import { View, ScrollView, StyleSheet, SafeAreaView } from "react-native";
import { Text, Button, ActivityIndicator, Surface, SegmentedButtons, Chip } from "react-native-paper";
import { chatApi, BetOrder, BetOrderStatus, BetOrderType } from "../services/chatApi";
import { PageContainer } from "./PageContainer";
import { AppHeader } from "./AppHeader";
import { DateRangePicker } from "./DateRangePicker";
import { colors, radii, spacing, statusPill } from "../theme";
import {
  BET_ORDER_STATUS_LABEL,
  formatBetOrderCondition,
  formatBetOrderResult,
  computeBetsPnl,
  betRaceDate,
} from "../utils/betOrderFormat";
import type { Route } from "../hooks/useRouter";

type BetsFilter = "all" | "real" | "sandbox";

// A bet's result bucket for the Outcome filter. Anything without a
// settled result is "UNSETTLED" — never inferred as a loss, same rule as
// formatBetOrderResult.
type BetOutcomeKey = "WON" | "LOST" | "VOID" | "UNSETTLED";

const OUTCOME_LABEL: Record<string, string> = {
  WON: "Won",
  LOST: "Lost",
  VOID: "Void",
  UNSETTLED: "No result yet",
};

const TYPE_LABEL: Record<BetOrderType, string> = {
  instant: "Instant",
  scheduled: "Scheduled",
};

function outcomeKey(bet: BetOrder): string {
  if (bet.betOutcome == null || bet.settledProfit == null) return "UNSETTLED";
  return bet.betOutcome;
}

function formatSignedPounds(value: number): string {
  return `${value >= 0 ? "+" : "-"}£${Math.abs(value).toFixed(2)}`;
}

interface ScheduledBetsScreenProps {
  navigate: (to: Route, query?: string) => void;
  isAuthenticated: boolean;
  onLogout?: () => void;
  onBack: () => void;
}

export const ScheduledBetsScreen: React.FC<ScheduledBetsScreenProps> = ({
  navigate,
  isAuthenticated,
  onLogout,
  onBack,
}) => {
  const [bets, setBets] = useState<BetOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<BetsFilter>("all");

  // Detail filters. Unlike the Industry SP screen (which batches every
  // change behind an Apply button because each apply is a fresh paged
  // query), these all run client-side over an already-loaded list — so
  // they apply on tap, and Reset is the only action button needed.
  const [showFilters, setShowFilters] = useState(false);
  const [minDate, setMinDate] = useState("");
  const [maxDate, setMaxDate] = useState("");
  const [selectedCourses, setSelectedCourses] = useState<Set<string>>(new Set());
  const [selectedStatuses, setSelectedStatuses] = useState<Set<string>>(new Set());
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());
  const [selectedOutcomes, setSelectedOutcomes] = useState<Set<string>>(new Set());

  // Real/sandbox is the tab, so it's applied first — every other filter's
  // chip options are then derived from (and every count describes) just
  // the bets that tab can show.
  const tabBets = useMemo(() => {
    if (filter === "sandbox") return bets.filter(b => b.sandbox === true);
    if (filter === "real") return bets.filter(b => b.sandbox !== true);
    return bets;
  }, [bets, filter]);

  const filteredBets = useMemo(() => {
    return tabBets.filter(bet => {
      const date = betRaceDate(bet);
      if (minDate && date < minDate) return false;
      if (maxDate && date > maxDate) return false;
      if (selectedCourses.size > 0 && !selectedCourses.has(bet.course)) return false;
      if (selectedStatuses.size > 0 && !selectedStatuses.has(bet.status)) return false;
      if (selectedTypes.size > 0 && !selectedTypes.has(bet.orderType)) return false;
      if (selectedOutcomes.size > 0 && !selectedOutcomes.has(outcomeKey(bet))) return false;
      return true;
    });
  }, [tabBets, minDate, maxDate, selectedCourses, selectedStatuses, selectedTypes, selectedOutcomes]);

  // The headline figure always describes exactly the list rendered below
  // it — tab and detail filters included — rather than a fixed "sandbox
  // only" total that wouldn't match what's on screen.
  const pnl = useMemo(() => computeBetsPnl(filteredBets), [filteredBets]);
  // On the All tab the single total mixes real money with simulated
  // money, which would be misleading on its own — so it's broken out.
  const realPnl = useMemo(() => computeBetsPnl(filteredBets.filter(b => b.sandbox !== true)), [filteredBets]);
  const sandboxPnl = useMemo(() => computeBetsPnl(filteredBets.filter(b => b.sandbox === true)), [filteredBets]);
  const showBreakdown =
    filter === "all" && realPnl.settledCount > 0 && sandboxPnl.settledCount > 0;

  // Array.from, not [...new Set(…)] — this bundle's transpile target
  // turns a spread of a Set into a single-element array holding the Set
  // itself, which silently renders one "[object Set]" chip per row.
  const availableCourses = useMemo(
    () => Array.from(new Set(tabBets.map(b => b.course))).sort((a, b) => a.localeCompare(b)),
    [tabBets]
  );
  const availableStatuses = useMemo(
    () => Array.from(new Set(tabBets.map(b => b.status))).sort((a, b) => a.localeCompare(b)),
    [tabBets]
  );
  const availableTypes = useMemo(
    () => Array.from(new Set(tabBets.map(b => b.orderType))).sort((a, b) => a.localeCompare(b)),
    [tabBets]
  );
  const availableOutcomes = useMemo(
    () => Array.from(new Set(tabBets.map(outcomeKey))).sort((a, b) => a.localeCompare(b)),
    [tabBets]
  );

  // The picker needs a concrete range to open on even when no date filter
  // is set ("" = unbounded), so it falls back to the span the bets
  // themselves cover.
  const dateBounds = useMemo(() => {
    const dates = bets.map(betRaceDate).sort();
    const today = new Date().toISOString().slice(0, 10);
    return { min: dates[0] ?? today, max: dates[dates.length - 1] ?? today };
  }, [bets]);

  const activeFilterCount =
    (minDate || maxDate ? 1 : 0) +
    (selectedCourses.size > 0 ? 1 : 0) +
    (selectedStatuses.size > 0 ? 1 : 0) +
    (selectedTypes.size > 0 ? 1 : 0) +
    (selectedOutcomes.size > 0 ? 1 : 0);

  function toggleChip(setSelected: React.Dispatch<React.SetStateAction<Set<string>>>, value: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  function resetFilters() {
    setMinDate("");
    setMaxDate("");
    setSelectedCourses(new Set());
    setSelectedStatuses(new Set());
    setSelectedTypes(new Set());
    setSelectedOutcomes(new Set());
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    chatApi
      .getBetOrders()
      .then(data => {
        if (!cancelled) setBets(data);
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load scheduled bets.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCancel(id: string) {
    setCancellingId(id);
    try {
      await chatApi.cancelBetOrder(id);
      setBets(prev => prev.map(b => (b.id === id ? { ...b, status: "cancelled" } : b)));
    } finally {
      setCancellingId(null);
    }
  }

  function renderChipRow(opts: {
    testId: string;
    label: string;
    values: string[];
    selected: Set<string>;
    labelFor?: (value: string) => string;
    onToggle: (value: string) => void;
  }) {
    if (opts.values.length === 0) return null;
    return (
      <View testID={`scheduled-bets-filter-row-${opts.testId}`} style={styles.filterRowBlock}>
        <Text style={styles.filterLabel}>{opts.label}</Text>
        <View style={styles.chipWrap}>
          {opts.values.map(value => {
            const active = opts.selected.has(value);
            return (
              <Chip
                key={value}
                testID={`scheduled-bets-filter-chip-${opts.testId}-${value}`}
                compact
                onPress={() => opts.onToggle(value)}
                style={active ? styles.chipActive : styles.chip}
                textStyle={active ? styles.chipTextActive : styles.chipText}
              >
                {opts.labelFor ? opts.labelFor(value) : value}
              </Chip>
            );
          })}
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView testID="scheduled-bets-screen" style={styles.screen}>
      <AppHeader
        navigate={navigate}
        isAuthenticated={isAuthenticated}
        onLogout={onLogout}
        onBack={onBack}
        subtitle="My Bets"
        testIdPrefix="scheduled-bets"
      />

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <PageContainer>
          {loading && (
            <View testID="scheduled-bets-loading" style={styles.centered}>
              <ActivityIndicator size="large" animating color={colors.primary} />
              <Text style={styles.loadingText}>Loading scheduled bets…</Text>
            </View>
          )}
          {!loading && error && (
            <View testID="scheduled-bets-error" style={styles.centered}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}
          {!loading && !error && bets.length === 0 && (
            <View testID="scheduled-bets-empty" style={styles.centered}>
              <Text style={styles.emptyText}>
                No bets yet — tap "Bet" on a Today's Pick to schedule one or place one instantly.
              </Text>
            </View>
          )}
          {!loading && !error && bets.length > 0 && (
            <View testID="scheduled-bets-filter" style={styles.filterRow}>
              <SegmentedButtons
                value={filter}
                onValueChange={value => setFilter(value as BetsFilter)}
                buttons={[
                  { value: "all", label: "All", testID: "scheduled-bets-filter-all" },
                  { value: "real", label: "Real", testID: "scheduled-bets-filter-real" },
                  { value: "sandbox", label: "Sandbox", testID: "scheduled-bets-filter-sandbox" },
                ]}
              />
            </View>
          )}
          {!loading && !error && bets.length > 0 && (
            <Surface testID="scheduled-bets-pnl" style={styles.pnlCard} elevation={1}>
              <Text testID="scheduled-bets-pnl-title" style={styles.pnlTitle}>
                {filter === "sandbox" ? "Sandbox P&L" : filter === "real" ? "Real P&L" : "P&L (all bets)"}
              </Text>
              <Text
                testID="scheduled-bets-pnl-value"
                style={[styles.pnlValue, { color: pnl.pnl >= 0 ? colors.success : colors.danger }]}
              >
                {formatSignedPounds(pnl.pnl)}
              </Text>
              <Text testID="scheduled-bets-pnl-meta" style={styles.pnlMeta}>
                {pnl.settledCount === 0
                  ? "No settled bets yet — nothing to total up."
                  : `Staked £${pnl.staked.toFixed(2)} across ${pnl.settledCount} settled bet${pnl.settledCount === 1 ? "" : "s"}`}
                {pnl.pendingCount > 0
                  ? ` (${pnl.pendingCount} more not settled yet — race hasn't run or result not captured)`
                  : ""}
              </Text>
              {showBreakdown && (
                <Text testID="scheduled-bets-pnl-breakdown" style={styles.pnlMeta}>
                  Real {formatSignedPounds(realPnl.pnl)} · Sandbox {formatSignedPounds(sandboxPnl.pnl)} (simulated)
                </Text>
              )}
            </Surface>
          )}
          {!loading && !error && bets.length > 0 && (
            <View style={styles.filterRow}>
              <Button
                testID="scheduled-bets-filters-toggle"
                mode="outlined"
                compact
                onPress={() => setShowFilters(v => !v)}
                style={styles.filtersToggle}
              >
                {showFilters ? "Hide filters" : "Filters"}
                {activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
              </Button>
            </View>
          )}
          {!loading && !error && bets.length > 0 && showFilters && (
            <Surface testID="scheduled-bets-filters" style={styles.filtersCard} elevation={1}>
              <View testID="scheduled-bets-filter-row-date" style={styles.filterRowBlock}>
                <Text style={styles.filterLabel}>Race date</Text>
                <DateRangePicker
                  testID="scheduled-bets-date-range-picker"
                  fromDate={minDate || dateBounds.min}
                  toDate={maxDate || dateBounds.max}
                  minDate={dateBounds.min}
                  maxDate={dateBounds.max}
                  onChange={(from, to) => {
                    setMinDate(from);
                    setMaxDate(to);
                  }}
                />
              </View>
              {renderChipRow({
                testId: "course",
                label: "Course",
                values: availableCourses,
                selected: selectedCourses,
                onToggle: value => toggleChip(setSelectedCourses, value),
              })}
              {renderChipRow({
                testId: "status",
                label: "Status",
                values: availableStatuses,
                selected: selectedStatuses,
                labelFor: value => BET_ORDER_STATUS_LABEL[value as BetOrderStatus] ?? value,
                onToggle: value => toggleChip(setSelectedStatuses, value),
              })}
              {renderChipRow({
                testId: "type",
                label: "Type",
                values: availableTypes,
                selected: selectedTypes,
                labelFor: value => TYPE_LABEL[value as BetOrderType] ?? value,
                onToggle: value => toggleChip(setSelectedTypes, value),
              })}
              {renderChipRow({
                testId: "outcome",
                label: "Outcome",
                values: availableOutcomes,
                selected: selectedOutcomes,
                labelFor: value => OUTCOME_LABEL[value] ?? value,
                onToggle: value => toggleChip(setSelectedOutcomes, value),
              })}
              <View style={styles.filterActions}>
                <Button
                  testID="scheduled-bets-filters-reset"
                  mode="outlined"
                  compact
                  disabled={activeFilterCount === 0}
                  onPress={resetFilters}
                  style={styles.resetBtn}
                >
                  Reset
                </Button>
              </View>
            </Surface>
          )}
          {!loading && !error && bets.length > 0 && filteredBets.length === 0 && (
            <View testID="scheduled-bets-filter-empty" style={styles.centered}>
              <Text style={styles.emptyText}>
                {activeFilterCount > 0
                  ? "No bets match these filters."
                  : `No ${filter} bets to show.`}
              </Text>
            </View>
          )}
          {!loading && !error && filteredBets.length > 0 && (
            <View testID="scheduled-bets-list" style={styles.list}>
              {filteredBets.map(bet => {
                const pill = statusPill[bet.status.toUpperCase()] ?? statusPill.HIDDEN;
                return (
                  <Surface key={bet.id} testID={`scheduled-bet-item-${bet.id}`} style={styles.card} elevation={1}>
                    <View style={styles.cardHeader}>
                      <Text variant="titleSmall" style={styles.horseName} numberOfLines={1}>
                        {bet.horse}
                      </Text>
                      <Text
                        testID={`scheduled-bet-order-type-${bet.id}`}
                        style={styles.orderTypeBadge}
                      >
                        {bet.orderType === "instant" ? "Instant" : "Scheduled"}
                      </Text>
                      {bet.sandbox && (
                        <Text testID={`scheduled-bet-sandbox-badge-${bet.id}`} style={styles.sandboxBadge}>
                          Sandbox
                        </Text>
                      )}
                      <Text
                        testID={`scheduled-bet-status-${bet.id}`}
                        style={[styles.statusBadge, { backgroundColor: pill.bg, color: pill.fg }]}
                      >
                        {BET_ORDER_STATUS_LABEL[bet.status]}
                      </Text>
                    </View>
                    <Text style={styles.meta}>{bet.course} · {bet.offTime}</Text>
                    <Text testID={`scheduled-bet-condition-${bet.id}`} style={styles.condition}>
                      {formatBetOrderCondition(bet)}
                    </Text>
                    {formatBetOrderResult(bet) && (
                      <Text
                        testID={`scheduled-bet-result-${bet.id}`}
                        style={[
                          styles.result,
                          { color: bet.betOutcome === "WON" ? colors.success : bet.betOutcome === "LOST" ? colors.danger : colors.textSecondary },
                        ]}
                      >
                        {formatBetOrderResult(bet)}
                      </Text>
                    )}
                    {bet.note && (
                      <Text testID={`scheduled-bet-note-${bet.id}`} style={styles.note}>
                        {bet.note}
                      </Text>
                    )}
                    {(bet.status === "pending" || bet.status === "unmatched") && (
                      <Button
                        testID={`scheduled-bet-cancel-${bet.id}`}
                        compact
                        mode="outlined"
                        loading={cancellingId === bet.id}
                        disabled={cancellingId === bet.id}
                        onPress={() => handleCancel(bet.id)}
                        style={styles.cancelButton}
                        textColor={colors.danger}
                      >
                        Cancel
                      </Button>
                    )}
                  </Surface>
                );
              })}
            </View>
          )}
        </PageContainer>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  centered: { alignItems: "center", justifyContent: "center", padding: spacing.xl },
  loadingText: { marginTop: spacing.sm, color: colors.textSecondary },
  errorText: { color: colors.danger },
  emptyText: { color: colors.textSecondary, textAlign: "center" },
  list: { padding: spacing.md, gap: spacing.md },
  card: { borderRadius: radii.md, padding: spacing.md, gap: spacing.xs },
  cardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  horseName: { flex: 1, fontWeight: "700" },
  statusBadge: {
    fontSize: 11,
    fontWeight: "700",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radii.sm,
    overflow: "hidden",
  },
  orderTypeBadge: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.textSecondary,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  sandboxBadge: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.warning,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.warning,
    overflow: "hidden",
  },
  meta: { fontSize: 12, color: colors.textSecondary },
  condition: { fontSize: 13, color: colors.text },
  result: { fontSize: 13, fontWeight: "700" },
  note: { fontSize: 12, color: colors.textSecondary, fontStyle: "italic" },
  filterRow: { paddingHorizontal: spacing.md, paddingTop: spacing.md },
  filtersToggle: { alignSelf: "flex-start", borderRadius: radii.button },
  filtersCard: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.md,
  },
  filterRowBlock: { gap: spacing.xs },
  filterLabel: { fontSize: 12, fontWeight: "700", color: colors.textSecondary },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.primary, borderWidth: 1, borderColor: colors.primary },
  chipText: { fontSize: 12, color: colors.text },
  chipTextActive: { fontSize: 12, color: colors.surface, fontWeight: "700" },
  filterActions: { flexDirection: "row", justifyContent: "flex-end" },
  resetBtn: { borderRadius: radii.button },
  pnlCard: {
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: 2,
  },
  pnlTitle: { fontSize: 12, fontWeight: "600", color: colors.textSecondary },
  pnlValue: { fontSize: 22, fontWeight: "800" },
  pnlMeta: { fontSize: 12, color: colors.textSecondary },
  cancelButton: {
    alignSelf: "flex-start",
    borderRadius: radii.button,
    borderColor: colors.danger,
    marginTop: spacing.xs,
  },
});
