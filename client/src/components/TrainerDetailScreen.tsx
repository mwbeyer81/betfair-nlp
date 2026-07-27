import React, { useState, useEffect, useMemo } from "react";
import { View, ScrollView, TouchableOpacity, StyleSheet, SafeAreaView } from "react-native";
import { Text, Button, ActivityIndicator } from "react-native-paper";
import { chatApi, TrainerFormDoc, TrainerFormCategory } from "../services/chatApi";
import { colors, statusPill, radii, spacing } from "../theme";
import { PageContainer } from "./PageContainer";
import { DateRangePicker } from "./DateRangePicker";
import { AppHeader } from "./AppHeader";
import type { Route } from "../hooks/useRouter";

interface TrainerDetailScreenProps {
  navigate: (to: Route, query?: string) => void;
  isAuthenticated: boolean;
  onLogout?: () => void;
  onRequestAuth?: () => void;
  trainer: string;
  formCategory: TrainerFormCategory;
  onBack: () => void;
  onNavigateToRunner: (raceId: number, runnerId: number) => void;
}

const ABSOLUTE_MIN_DATE = "2015-01-01";
const ABSOLUTE_MAX_DATE = "2026-12-31";

export const TrainerDetailScreen: React.FC<TrainerDetailScreenProps> = ({
  navigate,
  isAuthenticated,
  onLogout,
  onRequestAuth,
  trainer,
  formCategory,
  onBack,
  onNavigateToRunner,
}) => {
  const [doc, setDoc] = useState<TrainerFormDoc | null | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fromDate, setFromDate] = useState(ABSOLUTE_MIN_DATE);
  const [toDate, setToDate] = useState(ABSOLUTE_MAX_DATE);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const data = await chatApi.getTrainerForm(trainer, formCategory);
        if (cancelled) return;
        setDoc(data);
        if (data && data.runs.length > 0) {
          setFromDate(data.runs[0].raceDate);
          setToDate(data.runs[data.runs.length - 1].raceDate);
        }
      } catch {
        if (!cancelled) setError("Failed to load trainer form");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [trainer, formCategory]);

  const filteredRuns = useMemo(() => {
    if (!doc) return [];
    return doc.runs.filter(r => r.raceDate >= fromDate && r.raceDate <= toDate).slice().reverse();
  }, [doc, fromDate, toDate]);

  const wins = filteredRuns.filter(r => r.status === "WINNER").length;
  const winRate = filteredRuns.length > 0 ? (wins / filteredRuns.length) * 100 : null;

  return (
    <SafeAreaView testID="trainer-detail-screen" style={styles.screen}>
      <AppHeader
        navigate={navigate}
        isAuthenticated={isAuthenticated}
        onLogout={onLogout}
        onRequestAuth={onRequestAuth}
        onBack={onBack}
        subtitle={`${trainer} · ${formCategory} form`}
        testIdPrefix="trainer-detail"
      />

      {isLoading && (
        <View testID="trainer-detail-loading" style={styles.centered}>
          <ActivityIndicator size="large" animating color={colors.primary} />
          <Text style={styles.loadingText}>Loading trainer form…</Text>
        </View>
      )}

      {error && !isLoading && (
        <View testID="trainer-detail-error" style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {!isLoading && !error && doc === null && (
        <View testID="trainer-detail-not-found" style={styles.centered}>
          <Text style={styles.errorText}>No form data found for this trainer.</Text>
        </View>
      )}

      {!isLoading && !error && doc && (
        <>
          <View testID="trainer-detail-filter-row" style={styles.filterRow}>
            <Text style={styles.filterLabel}>Date</Text>
            <DateRangePicker
              testID="trainer-detail-date-range-picker"
              fromDate={fromDate}
              toDate={toDate}
              minDate={ABSOLUTE_MIN_DATE}
              maxDate={ABSOLUTE_MAX_DATE}
              onChange={(from, to) => { setFromDate(from); setToDate(to); }}
            />
          </View>

          <View testID="trainer-detail-stats" style={styles.statsBar}>
            <Text testID="trainer-detail-runs" style={styles.statText}>
              <Text style={styles.statLabel}>Runs </Text>{filteredRuns.length}
            </Text>
            <Text testID="trainer-detail-wins" style={styles.statText}>
              <Text style={styles.statLabel}>Wins </Text>{wins}
            </Text>
            {winRate != null && (
              <Text testID="trainer-detail-win-rate" style={styles.statText}>
                <Text style={styles.statLabel}>Win rate </Text>{winRate.toFixed(1)}%
              </Text>
            )}
          </View>

          <ScrollView testID="trainer-detail-list" style={styles.list}>
            <PageContainer>
              {filteredRuns.length === 0 && (
                <Text style={styles.emptyText}>No runs in this date range.</Text>
              )}
              {filteredRuns.map(run => (
                <TouchableOpacity
                  key={`${run.raceId}-${run.runnerId}`}
                  testID={`trainer-detail-item-${run.raceId}-${run.runnerId}`}
                  style={styles.runRow}
                  onPress={() => onNavigateToRunner(run.raceId, run.runnerId)}
                >
                  <Text style={styles.runDate}>{run.raceDate}</Text>
                  <Text style={styles.runCourse} numberOfLines={1}>{run.course}</Text>
                  <Text style={styles.runHorse} numberOfLines={1}>{run.horseName}</Text>
                  <View style={[styles.statusBadge, { backgroundColor: (statusPill[run.status] ?? statusPill.HIDDEN).bg }]}>
                    <Text style={[styles.statusText, { color: (statusPill[run.status] ?? statusPill.HIDDEN).fg }]}>
                      {run.status}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </PageContainer>
          </ScrollView>
        </>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xxl, gap: spacing.md },
  loadingText: { color: colors.textSecondary },
  errorText: { color: colors.danger, fontSize: 16 },
  filterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  filterLabel: { fontSize: 12, fontWeight: "600", color: colors.textSecondary },
  statsBar: {
    flexDirection: "row",
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.primaryLight,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  statText: { fontSize: 13, color: colors.accent, fontWeight: "700" },
  statLabel: { color: colors.textSecondary, fontWeight: "400" },
  list: { flex: 1, ...({ overscrollBehavior: "contain" } as any) },
  emptyText: { padding: spacing.xl, color: colors.textTertiary, fontSize: 16, textAlign: "center" },
  runRow: {
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
  runDate: { fontSize: 12, color: colors.textSecondary },
  runCourse: { fontSize: 12, color: colors.text, flexShrink: 1, minWidth: 0 },
  runHorse: { fontSize: 13, fontWeight: "600", color: colors.text, flex: 1, minWidth: 0 },
  statusBadge: { borderRadius: radii.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  statusText: { fontSize: 10, fontWeight: "600" },
});
