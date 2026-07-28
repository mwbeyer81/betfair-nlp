import React, { useEffect, useState } from "react";
import { View, StyleSheet, SafeAreaView, ScrollView, TouchableOpacity } from "react-native";
import { Text, Button, ActivityIndicator } from "react-native-paper";
import { chatApi, SavedFilterSet, SavedFilterSetSplit, LiveFilterResult } from "../services/chatApi";
import { SplitDetailPanel } from "./SplitDetailPanel";
import { PnlConvergencePanel } from "./PnlConvergencePanel";
import { AppHeader } from "./AppHeader";
import { buildFilterSummaryFromParams, formatPnl, formatPct } from "../utils/ispFormat";
import { buildHierarchy, collectHierarchyNodeKeys } from "../utils/raceHierarchy";
import { colors, radii, spacing } from "../theme";
import type { Route } from "../hooks/useRouter";

interface LivePnlStats {
  staked: number;
  returns: number;
  pnl: number;
  count: number;
}

function sumPnlStats(items: LiveFilterResult[]): LivePnlStats {
  return items.reduce(
    (acc, item) => ({
      staked: acc.staked + item.pnlStats.staked,
      returns: acc.returns + item.pnlStats.returns,
      pnl: acc.pnl + item.pnlStats.pnl,
      count: acc.count + item.pnlStats.count,
    }),
    { staked: 0, returns: 0, pnl: 0, count: 0 }
  );
}

// Year → Month → Day → Meeting rollup of a filter set's live, actual-results
// track record — the day-by-day counterpart to the Split A/B backtest cards
// above, built from real RacingAPI results the daily capture cron has
// upserted so far (see live-filter-result-dao.ts). Reuses the same
// buildHierarchy tree IspRacesScreen.tsx uses for the full race list, just
// grouping already-per-meeting rows instead of individual races — a meeting
// here has no further per-race drill-down (each row already is the finest
// granularity this endpoint returns), so meeting nodes render as leaves.
function LivePerformanceSection({ results }: { results: LiveFilterResult[] }) {
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(new Set());

  if (results.length === 0) {
    return (
      <View testID="saved-result-live-empty" style={styles.liveEmptyContainer}>
        <Text style={styles.liveEmptyText}>
          No live results captured yet — this fills in day by day as real
          races finish and match this filter.
        </Text>
      </View>
    );
  }

  const hierarchy = buildHierarchy(results, {
    dateTime: r => r.raceDate,
    meetingId: r => r.meetingId,
    meetingLabel: r => r.meetingName,
  });
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

  return (
    <View testID="saved-result-live-section">
      <View style={styles.liveSectionHeader}>
        <Text style={styles.liveSectionTitle}>Live Performance</Text>
        <TouchableOpacity testID="saved-result-live-collapse-all" onPress={toggleCollapseAll}>
          <Text style={styles.liveCollapseAllText}>{isAllCollapsed ? "Expand all" : "Collapse all"}</Text>
        </TouchableOpacity>
      </View>
      {hierarchy.map(year => {
        const yearKey = `year:${year.key}`;
        const yearCollapsed = collapsedKeys.has(yearKey);
        const yearPnl = sumPnlStats(year.items);
        return (
          <View key={year.key} testID={`saved-result-live-year-${year.key}`}>
            <TouchableOpacity
              testID={`saved-result-live-year-toggle-${year.key}`}
              style={styles.liveYearHeader}
              onPress={() => toggleNode(yearKey)}
              accessibilityRole="button"
              accessibilityState={{ expanded: !yearCollapsed }}
            >
              <Text style={styles.liveGroupChevron}>{yearCollapsed ? "▸" : "▾"}</Text>
              <Text style={styles.liveYearLabel}>{year.key}</Text>
              {yearPnl.staked > 0 && (
                <Text testID={`saved-result-live-year-pnl-${year.key}`} style={[styles.liveGroupPnl, yearPnl.pnl >= 0 ? styles.pnlPos : styles.pnlNeg]}>
                  {formatPnl(yearPnl.pnl)} ({formatPct(yearPnl.pnl, yearPnl.staked)})
                </Text>
              )}
            </TouchableOpacity>

            {!yearCollapsed && year.months.map(month => {
              const monthKey = `month:${month.key}`;
              const monthCollapsed = collapsedKeys.has(monthKey);
              const monthPnl = sumPnlStats(month.items);
              return (
                <View key={month.key} testID={`saved-result-live-month-${month.key}`}>
                  <TouchableOpacity
                    testID={`saved-result-live-month-toggle-${month.key}`}
                    style={styles.liveMonthHeader}
                    onPress={() => toggleNode(monthKey)}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: !monthCollapsed }}
                  >
                    <Text style={styles.liveGroupChevron}>{monthCollapsed ? "▸" : "▾"}</Text>
                    <Text style={styles.liveMonthLabel}>{month.label}</Text>
                    {monthPnl.staked > 0 && (
                      <Text testID={`saved-result-live-month-pnl-${month.key}`} style={[styles.liveGroupPnl, monthPnl.pnl >= 0 ? styles.pnlPos : styles.pnlNeg]}>
                        {formatPnl(monthPnl.pnl)} ({formatPct(monthPnl.pnl, monthPnl.staked)})
                      </Text>
                    )}
                  </TouchableOpacity>

                  {!monthCollapsed && month.days.map(day => {
                    const dayKey = `day:${day.key}`;
                    const dayCollapsed = collapsedKeys.has(dayKey);
                    const dayPnl = sumPnlStats(day.items);
                    return (
                      <View key={day.key} testID={`saved-result-live-day-${day.key}`}>
                        <TouchableOpacity
                          testID={`saved-result-live-day-toggle-${day.key}`}
                          style={styles.liveDayHeader}
                          onPress={() => toggleNode(dayKey)}
                          accessibilityRole="button"
                          accessibilityState={{ expanded: !dayCollapsed }}
                        >
                          <Text style={styles.liveGroupChevron}>{dayCollapsed ? "▸" : "▾"}</Text>
                          <Text style={styles.liveDayLabel}>{day.label}</Text>
                          {dayPnl.staked > 0 && (
                            <Text testID={`saved-result-live-day-pnl-${day.key}`} style={[styles.liveGroupPnl, dayPnl.pnl >= 0 ? styles.pnlPos : styles.pnlNeg]}>
                              {formatPnl(dayPnl.pnl)} ({formatPct(dayPnl.pnl, dayPnl.staked)})
                            </Text>
                          )}
                        </TouchableOpacity>

                        {!dayCollapsed && day.meetings.map(meeting => {
                          const meetingPnl = sumPnlStats(meeting.items);
                          return (
                            <View key={meeting.meetingId} testID={`saved-result-live-meeting-${meeting.meetingId}`} style={styles.liveMeetingRow}>
                              <Text style={styles.liveMeetingLabel}>{meeting.label}</Text>
                              {meetingPnl.staked > 0 ? (
                                <Text testID={`saved-result-live-meeting-pnl-${meeting.meetingId}`} style={[styles.liveGroupPnl, meetingPnl.pnl >= 0 ? styles.pnlPos : styles.pnlNeg]}>
                                  {formatPnl(meetingPnl.pnl)} ({formatPct(meetingPnl.pnl, meetingPnl.staked)})
                                </Text>
                              ) : (
                                <Text style={styles.liveMeetingEmptyText}>No qualifying bets</Text>
                              )}
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
    </View>
  );
}

interface SavedResultDetailScreenProps {
  navigate: (to: Route, query?: string) => void;
  isAuthenticated: boolean;
  onLogout?: () => void;
  id: string;
  onBack: () => void;
  onRestore: (filters: Record<string, string>) => void;
}

// The live Filters screen's own Split A/Split B card look (see
// IndustrySpScreen's renderSplitCard/splitCard styles) — mirrored here so a
// saved result reads as close as possible to what the user actually saw at
// save time, rather than a differently-shaped summary.
function SplitCard({
  id,
  label,
  split,
  onDetails,
  onGraph,
}: {
  id: "a" | "b";
  label: string;
  split: SavedFilterSetSplit;
  onDetails: () => void;
  onGraph: () => void;
}) {
  const effectiveTo = split.toRow ?? split.total;
  return (
    <View testID={`saved-result-split-card-${id}`} style={styles.splitCard}>
      <Text style={styles.splitCardLabel}>
        {label} — races {split.fromRow}–{effectiveTo}
      </Text>
      {split.pnlStats.staked > 0 ? (
        <Text testID={`saved-result-split-pnl-${id}`} style={[styles.pnlHeadline, split.pnlStats.pnl >= 0 ? styles.pnlPos : styles.pnlNeg]}>
          {formatPnl(split.pnlStats.pnl)}{" "}
          <Text style={[styles.pnlPct, split.pnlStats.pnl >= 0 ? styles.pnlPos : styles.pnlNeg]}>
            ({formatPct(split.pnlStats.pnl, split.pnlStats.staked)})
          </Text>
        </Text>
      ) : (
        <Text testID={`saved-result-split-empty-${id}`} style={styles.splitEmptyText}>
          No qualifying bets in this split.
        </Text>
      )}
      <View style={styles.splitButtonRow}>
        <Button
          testID={`saved-result-split-details-button-${id}`}
          mode="outlined"
          compact
          onPress={onDetails}
          style={styles.splitDetailsButton}
          labelStyle={styles.splitDetailsButtonLabel}
        >
          Details
        </Button>
        <Button
          testID={`saved-result-split-graph-button-${id}`}
          mode="outlined"
          compact
          onPress={onGraph}
          style={styles.splitDetailsButton}
          labelStyle={styles.splitDetailsButtonLabel}
        >
          Graph
        </Button>
      </View>
    </View>
  );
}

export const SavedResultDetailScreen: React.FC<SavedResultDetailScreenProps> = ({
  navigate,
  isAuthenticated,
  onLogout,
  id,
  onBack,
  onRestore,
}) => {
  const [result, setResult] = useState<SavedFilterSet | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailSplit, setDetailSplit] = useState<"a" | "b" | null>(null);
  const [graphSplit, setGraphSplit] = useState<"a" | "b" | null>(null);
  const [liveResults, setLiveResults] = useState<LiveFilterResult[]>([]);
  const [liveLoading, setLiveLoading] = useState(true);
  const [liveError, setLiveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    chatApi
      .getSavedFilterSet(id)
      .then(res => {
        if (!cancelled) setResult(res.data);
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load saved result.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Independent of the splitA/splitB fetch above — its own loading/error
  // state, so a failure here never blocks the backtest cards from showing.
  useEffect(() => {
    let cancelled = false;
    setLiveLoading(true);
    setLiveError(null);
    chatApi
      .getLiveFilterPerformance(id)
      .then(res => {
        if (!cancelled) setLiveResults(res.data);
      })
      .catch(err => {
        if (!cancelled) setLiveError(err instanceof Error ? err.message : "Failed to load live performance.");
      })
      .finally(() => {
        if (!cancelled) setLiveLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function handleDelete() {
    await chatApi.deleteSavedFilterSet(id);
    onBack();
  }

  const detailedSplit = detailSplit === "a" ? result?.splitA : detailSplit === "b" ? result?.splitB : null;
  const graphedSplit = graphSplit === "a" ? result?.splitA : graphSplit === "b" ? result?.splitB : null;
  // Same real bug as SavedResultsListScreen's isLegacyResult(): a result
  // saved before the Split A/B schema change has neither field at all.
  // Rendering the two SplitCards below on one of these threw mid-render
  // with no error boundary anywhere in the app to catch it — check this
  // before assuming result.splitA/splitB exist.
  const isLegacyResult = result != null && (result.splitA == null || result.splitB == null);

  return (
    <SafeAreaView testID="saved-result-detail-screen" style={styles.screen}>
      <AppHeader
        navigate={navigate}
        isAuthenticated={isAuthenticated}
        onLogout={onLogout}
        onBack={onBack}
        subtitle={result?.name ?? "Result"}
        testIdPrefix="saved-result-detail"
      />
      {loading && (
        <View testID="saved-result-detail-loading" style={styles.centered}>
          <ActivityIndicator size="large" animating color={colors.primary} />
        </View>
      )}
      {!loading && error && (
        <View testID="saved-result-detail-error" style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
          <Button mode="contained" onPress={onBack} style={styles.backButton}>
            ← Back to Results
          </Button>
        </View>
      )}
      {!loading && !error && result && isLegacyResult && (
        <View style={styles.detailContainer}>
          <View style={styles.centered}>
            <Text testID="saved-result-detail-legacy-notice" style={styles.legacyNoticeText}>
              This result was saved before this app's Split A/B update and
              can't be displayed. Delete it and save a fresh one from the
              Filters screen.
            </Text>
          </View>
          <View style={styles.actionsRow}>
            <Button testID="saved-result-detail-restore" mode="contained" buttonColor={colors.accent} onPress={() => onRestore(result.filters)} style={styles.actionButton}>
              Restore filters
            </Button>
            <Button testID="saved-result-detail-delete" mode="outlined" textColor={colors.danger} onPress={handleDelete} style={styles.actionButton}>
              Delete
            </Button>
          </View>
        </View>
      )}
      {!loading && !error && result && !isLegacyResult && graphedSplit == null && (
        <View style={styles.detailContainer}>
          {/* SplitDetailPanel is a full-screen position:"absolute" overlay by
              design (zIndex 100) — the action bar below sits in its own
              higher-zIndex absolute layer so it floats above it, rather than
              being a normal ScrollView sibling that the panel would cover. */}
          {detailedSplit != null && detailSplit != null && (
            <SplitDetailPanel
              id={detailSplit}
              label={detailSplit === "a" ? "Split A" : "Split B"}
              fromRow={detailedSplit.fromRow}
              toRow={detailedSplit.toRow ?? detailedSplit.total}
              totalRaces={detailedSplit.total}
              totalRunners={detailedSplit.totalRunners}
              pnl={detailedSplit.pnlStats}
              onClose={() => setDetailSplit(null)}
              onViewRaces={() => {}}
            />
          )}
          <ScrollView contentContainerStyle={styles.scrollContent}>
            <SplitCard
              id="a"
              label="Split A"
              split={result.splitA!}
              onDetails={() => setDetailSplit("a")}
              onGraph={() => setGraphSplit("a")}
            />
            <SplitCard
              id="b"
              label="Split B"
              split={result.splitB!}
              onDetails={() => setDetailSplit("b")}
              onGraph={() => setGraphSplit("b")}
            />
            {liveLoading && (
              <View testID="saved-result-live-loading" style={styles.liveStateContainer}>
                <ActivityIndicator size="small" animating color={colors.primary} />
              </View>
            )}
            {!liveLoading && liveError && (
              <View testID="saved-result-live-error" style={styles.liveStateContainer}>
                <Text style={styles.errorText}>{liveError}</Text>
              </View>
            )}
            {!liveLoading && !liveError && <LivePerformanceSection results={liveResults} />}
          </ScrollView>
          <View style={styles.actionsRow}>
            <Button testID="saved-result-detail-restore" mode="contained" buttonColor={colors.accent} onPress={() => onRestore(result.filters)} style={styles.actionButton}>
              Restore filters
            </Button>
            <Button testID="saved-result-detail-delete" mode="outlined" textColor={colors.danger} onPress={handleDelete} style={styles.actionButton}>
              Delete
            </Button>
          </View>
        </View>
      )}
      {!loading && !error && result && graphedSplit != null && (
        <PnlConvergencePanel
          points={graphedSplit.graphPoints}
          loading={false}
          error={null}
          filters={buildFilterSummaryFromParams(result.filters)}
          onClose={() => setGraphSplit(null)}
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md },
  errorText: { color: colors.danger },
  backButton: { marginTop: spacing.md },
  legacyNoticeText: { fontSize: 14, color: colors.textSecondary, textAlign: "center" },
  detailContainer: { flex: 1, position: "relative" },
  scrollContent: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl * 3 },
  splitCard: {
    backgroundColor: colors.text,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  splitCardLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "rgba(255,255,255,0.85)",
  },
  splitEmptyText: {
    fontSize: 12,
    color: "rgba(255,255,255,0.5)",
  },
  pnlHeadline: {
    fontSize: 18,
    fontWeight: "700",
  },
  pnlPct: {
    fontSize: 13,
    fontWeight: "400",
    opacity: 0.8,
  },
  pnlPos: {
    color: colors.pnlPositive,
  },
  pnlNeg: {
    color: colors.pnlNegative,
  },
  splitButtonRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  splitDetailsButton: {
    borderRadius: radii.sm,
    borderColor: "rgba(255,255,255,0.4)",
  },
  splitDetailsButtonLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: "#fff",
  },
  liveStateContainer: { alignItems: "center", padding: spacing.md },
  liveEmptyContainer: { padding: spacing.md },
  liveEmptyText: { fontSize: 13, color: colors.textSecondary, textAlign: "center" },
  liveSectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  liveSectionTitle: { fontSize: 16, fontWeight: "700", color: colors.text },
  liveCollapseAllText: { fontSize: 13, color: colors.primary, fontWeight: "600" },
  liveGroupChevron: { fontSize: 12, color: colors.textSecondary, marginRight: spacing.sm },
  liveGroupPnl: { fontSize: 13, fontWeight: "700", marginLeft: "auto" },
  liveYearHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
  },
  liveYearLabel: { fontSize: 15, fontWeight: "700", color: colors.text },
  liveMonthHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.xs,
    paddingLeft: spacing.md,
  },
  liveMonthLabel: { fontSize: 14, fontWeight: "600", color: colors.text },
  liveDayHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.xs,
    paddingLeft: spacing.lg,
  },
  liveDayLabel: { fontSize: 13, color: colors.textSecondary },
  liveMeetingRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.xs,
    paddingLeft: spacing.xl,
  },
  liveMeetingLabel: { fontSize: 13, color: colors.text },
  liveMeetingEmptyText: { fontSize: 12, color: colors.textSecondary, marginLeft: "auto" },
  actionsRow: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 200,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  actionButton: { flexGrow: 1, minWidth: 160 },
});
