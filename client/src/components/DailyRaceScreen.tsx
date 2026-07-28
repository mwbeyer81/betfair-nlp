import React, { useState, useEffect } from "react";
import { View, ScrollView, TouchableOpacity, StyleSheet, SafeAreaView } from "react-native";
import { Text, ActivityIndicator } from "react-native-paper";
import { chatApi, DailyRace } from "../services/chatApi";
import { colors, radii, spacing } from "../theme";
import { PageContainer } from "./PageContainer";
import { AppHeader } from "./AppHeader";
import { fairDecimalOdds, toFractionalOdds } from "../utils/oddsFormat";
import type { Route } from "../hooks/useRouter";

const FORM_TOOLTIP =
  "Recent finishing positions, oldest to newest (left to right). A dash marks the start of a new season. 0 means finished outside the top 9.";
const MODEL_TOOLTIP =
  "Our model's estimated chance this horse wins the race, based on its recent form. Percentages across all runners in a race add up to about 100%.";
const FAIR_ODDS_TOOLTIP =
  "The odds at which backing this horse would break even long-run, based on the model's chance. If a bookmaker offers higher odds than this, it may be worth backing; lower, and it likely isn't.";

interface DailyRaceScreenProps {
  navigate: (to: Route, query?: string) => void;
  isAuthenticated: boolean;
  onLogout?: () => void;
  raceId: string;
  onNavigateToEvent: (eventId: string) => void;
  onNavigateToRunner: (raceId: string, runnerId: string) => void;
}

export const DailyRaceScreen: React.FC<DailyRaceScreenProps> = ({
  navigate,
  isAuthenticated,
  onLogout,
  raceId,
  onNavigateToEvent,
  onNavigateToRunner,
}) => {
  const [race, setRace] = useState<DailyRace | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openTooltip, setOpenTooltip] = useState<string | null>(null);

  const toggleTooltip = (key: string) => setOpenTooltip(current => (current === key ? null : key));

  // Small "?" badge signalling a pill has more info behind a tap — same
  // circular-outline pattern as ModelPerformanceDashboard.tsx /
  // IndustrySpScreen.tsx's own renderTooltipToggle, reused here rather than
  // invented fresh. Unlike those two (standalone toggle buttons), this one
  // sits inside a row that's itself one big TouchableOpacity, so it needs
  // its own stopPropagation to avoid also triggering onNavigateToRunner.
  const renderTooltipToggle = (key: string, testID: string) => (
    <TouchableOpacity
      testID={testID}
      onPress={(e: any) => { e?.stopPropagation?.(); toggleTooltip(key); }}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      style={styles.tooltipToggle}
    >
      <Text style={styles.tooltipToggleText}>?</Text>
    </TouchableOpacity>
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const data = await chatApi.getDailyRace(raceId);
        if (!cancelled) setRace(data);
      } catch {
        if (!cancelled) setError("Failed to load race");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [raceId]);

  return (
    <SafeAreaView testID="daily-race-screen" style={styles.screen}>
      <AppHeader
        navigate={navigate}
        isAuthenticated={isAuthenticated}
        onLogout={onLogout}
        onBack={race ? () => onNavigateToEvent(race.eventId) : undefined}
        subtitle={race ? `${race.raceName} · ${race.course} · ${race.offTime}` : "Race"}
        testIdPrefix="daily-race"
      />

      <View style={styles.body}>
        {isLoading && (
          <View testID="daily-race-loading" style={styles.centered}>
            <ActivityIndicator size="large" animating color={colors.primary} />
            <Text variant="bodyMedium" style={styles.loadingText}>Loading race…</Text>
          </View>
        )}

        {error && !isLoading && (
          <View testID="daily-race-error" style={styles.centered}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {!isLoading && !error && race && (
          <ScrollView testID="daily-race-list" style={styles.list}>
            <PageContainer>
              <View style={styles.raceHeader}>
                <Text style={styles.raceMeta}>{race.going ?? "—"} · {race.distanceF ? `${race.distanceF}f` : "—"} · {race.raceClass ?? "—"}</Text>
              </View>
              {race.runners.length === 0 && (
                <Text testID="daily-race-empty" style={styles.emptyText}>No runners declared.</Text>
              )}
              {race.runners.map(runner => (
                <TouchableOpacity
                  key={runner.runnerId}
                  testID={`daily-race-item-${runner.runnerId}`}
                  style={styles.runnerRow}
                  onPress={() => onNavigateToRunner(race.raceId, runner.runnerId)}
                >
                  <Text style={styles.number}>{runner.number ?? "—"}</Text>
                  <Text testID={`daily-race-item-horse-${runner.runnerId}`} style={styles.horseName} numberOfLines={1}>
                    {runner.horse}
                  </Text>
                  {runner.jockey && (
                    <Text style={styles.badge} numberOfLines={1}>{runner.jockey}</Text>
                  )}
                  {runner.trainer && (
                    <Text style={styles.badge} numberOfLines={1}>{runner.trainer}</Text>
                  )}
                  {runner.draw && (
                    <Text style={styles.drawBadge}>Draw {runner.draw}</Text>
                  )}
                  {runner.form && (
                    <View style={styles.pillGroup}>
                      <TouchableOpacity
                        testID={`daily-race-item-form-${runner.runnerId}`}
                        onPress={(e: any) => { e?.stopPropagation?.(); toggleTooltip(`${runner.runnerId}:form`); }}
                      >
                        <Text style={styles.formBadge}>{runner.form}</Text>
                      </TouchableOpacity>
                      {renderTooltipToggle(`${runner.runnerId}:form`, `daily-race-item-form-tooltip-toggle-${runner.runnerId}`)}
                    </View>
                  )}
                  {runner.modelWinProbability != null && (
                    <View style={styles.pillGroup}>
                      <TouchableOpacity
                        onPress={(e: any) => { e?.stopPropagation?.(); toggleTooltip(`${runner.runnerId}:model`); }}
                      >
                        <Text testID={`daily-race-item-model-${runner.runnerId}`} style={styles.modelBadge}>
                          Model {runner.modelWinProbability.toFixed(0)}%
                        </Text>
                      </TouchableOpacity>
                      {renderTooltipToggle(`${runner.runnerId}:model`, `daily-race-item-model-tooltip-toggle-${runner.runnerId}`)}
                    </View>
                  )}
                  {runner.modelWinProbability != null && fairDecimalOdds(runner.modelWinProbability) != null && (
                    <View style={styles.pillGroup}>
                      <TouchableOpacity
                        onPress={(e: any) => { e?.stopPropagation?.(); toggleTooltip(`${runner.runnerId}:fairOdds`); }}
                      >
                        <Text testID={`daily-race-item-fair-odds-${runner.runnerId}`} style={styles.fairOddsBadge}>
                          Fair {toFractionalOdds(fairDecimalOdds(runner.modelWinProbability)!)} ({fairDecimalOdds(runner.modelWinProbability)!.toFixed(2)})
                        </Text>
                      </TouchableOpacity>
                      {renderTooltipToggle(`${runner.runnerId}:fairOdds`, `daily-race-item-fair-odds-tooltip-toggle-${runner.runnerId}`)}
                    </View>
                  )}
                  {openTooltip === `${runner.runnerId}:form` && (
                    <Text testID={`daily-race-item-form-tooltip-${runner.runnerId}`} style={styles.tooltipText}>
                      {FORM_TOOLTIP}
                    </Text>
                  )}
                  {openTooltip === `${runner.runnerId}:model` && (
                    <View testID={`daily-race-item-model-tooltip-${runner.runnerId}`} style={styles.tooltipBlock}>
                      <Text style={styles.tooltipText}>{MODEL_TOOLTIP}</Text>
                      {runner.modelTopFactors?.map((factor, index) => (
                        <Text
                          key={index}
                          testID={`daily-race-item-model-factor-${runner.runnerId}-${index}`}
                          style={styles.tooltipText}
                        >
                          {factor.direction === "positive" ? "▲ " : "▼ "}
                          {factor.label}
                        </Text>
                      ))}
                    </View>
                  )}
                  {openTooltip === `${runner.runnerId}:fairOdds` && (
                    <Text testID={`daily-race-item-fair-odds-tooltip-${runner.runnerId}`} style={styles.tooltipText}>
                      {FAIR_ODDS_TOOLTIP}
                    </Text>
                  )}
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
  raceHeader: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  raceMeta: { fontSize: 12, color: colors.textSecondary },
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
    gap: spacing.sm,
  },
  // Groups a pill with its "?" tooltip-toggle icon into one flex item, so
  // flexWrap on runnerRow breaks the line between groups, never between a
  // pill and its own icon (that used to happen — the icon would wrap onto
  // its own line, orphaned from the pill it belonged to).
  pillGroup: { flexDirection: "row", alignItems: "center", gap: 4 },
  number: { fontSize: 12, color: colors.textTertiary, width: 22 },
  horseName: { fontSize: 13, fontWeight: "600", color: colors.text, maxWidth: 160 },
  badge: { fontSize: 11, color: colors.textSecondary, maxWidth: 140 },
  drawBadge: { fontSize: 11, color: colors.textTertiary, backgroundColor: colors.background, paddingHorizontal: 5, paddingVertical: 1, borderRadius: radii.sm },
  formBadge: { fontSize: 11, fontWeight: "600", color: colors.accent, backgroundColor: colors.primaryLight, paddingHorizontal: 5, paddingVertical: 1, borderRadius: radii.sm },
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
  },
  fairOddsBadge: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.info,
    backgroundColor: colors.infoLight,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: radii.sm,
  },
  tooltipText: {
    width: "100%",
    fontSize: 11,
    color: colors.textSecondary,
    paddingTop: 2,
  },
  tooltipBlock: {
    width: "100%",
  },
  tooltipToggle: {
    width: 16,
    height: 16,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.textTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  tooltipToggleText: {
    fontSize: 9,
    lineHeight: 11,
    fontWeight: "700",
    color: colors.textSecondary,
  },
});
