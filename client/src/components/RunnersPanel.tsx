import React from "react";
import {
  View,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import {
  Text,
  IconButton,
  ActivityIndicator,
  Surface,
  Divider,
} from "react-native-paper";
import { Race, Runner } from "../services/chatApi";
import { colors, statusPill, radii, spacing } from "../theme";

interface RunnersPanelProps {
  eventId: string;
  eventName: string;
  races: Race[];
  isLoading: boolean;
  error: string | null;
  onClose: () => void;
  onRunnerSelect?: (runnerId: number, runnerName: string) => void;
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

export const RunnersPanel: React.FC<RunnersPanelProps> = ({
  eventId,
  eventName,
  races,
  isLoading,
  error,
  onClose,
  onRunnerSelect,
}) => {
  const totalRunners = races.reduce((sum, r) => sum + r.runners.length, 0);
  const subtitle =
    races.length === 1
      ? `Runners · ${totalRunners} runners`
      : `${races.length} races · ${totalRunners} runners`;

  return (
    <Surface testID="runners-panel" style={styles.panel} elevation={3}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text variant="bodyMedium" style={styles.title} numberOfLines={1}>
            {eventName}
          </Text>
          <Text variant="bodySmall" style={styles.subtitle}>
            {subtitle}
          </Text>
        </View>
        <IconButton
          testID="runners-panel-close"
          icon="close"
          size={20}
          onPress={onClose}
          style={styles.closeButton}
        />
      </View>

      <Divider />

      {isLoading && (
        <View testID="runners-loading" style={styles.centered}>
          <ActivityIndicator size="small" animating color={colors.primary} />
          <Text variant="bodySmall" style={styles.loadingText}>
            Loading runners…
          </Text>
        </View>
      )}

      {error && !isLoading && (
        <View testID="runners-error" style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {!isLoading && !error && (
        <ScrollView testID="runners-list" style={styles.list}>
          {races.length === 0 && (
            <Text style={styles.emptyText}>No runners found.</Text>
          )}
          {races.map((race) => (
            <View key={race.marketId} testID={`race-section-${race.marketId}`}>
              {races.length > 1 && (
                <View style={styles.raceHeader}>
                  <Text style={styles.raceTime}>{formatRaceTime(race.marketTime)}</Text>
                  <Text style={styles.raceType}>{race.marketType}</Text>
                  <Text style={styles.raceCount}>{race.runners.length} runners</Text>
                </View>
              )}
              {race.runners.map((runner: Runner) => (
                <TouchableOpacity
                  key={runner.id}
                  testID={`runner-item-${runner.id}`}
                  style={styles.item}
                  onPress={() => onRunnerSelect?.(runner.id, runner.name)}
                  activeOpacity={onRunnerSelect ? 0.7 : 1}
                >
                  <View style={styles.itemRow}>
                    <Text style={styles.priority}>{runner.sortPriority}.</Text>
                    <Text style={styles.runnerName} numberOfLines={1}>
                      {runner.name}
                    </Text>
                    {runner.bsp != null && (
                      <Text testID={`runner-bsp-${runner.id}`} style={styles.bspBadge}>
                        SP {runner.bsp}
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
                    {onRunnerSelect && <Text style={styles.chevron}>›</Text>}
                  </View>
                  <Text style={styles.meta}>ID: {runner.id}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ))}
        </ScrollView>
      )}
    </Surface>
  );
};

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    maxHeight: 400,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingLeft: spacing.lg,
    paddingRight: spacing.xs,
    paddingVertical: 6,
    backgroundColor: "#EEF2FF",
  },
  headerText: {
    flex: 1,
    minWidth: 0,
    marginRight: spacing.sm,
  },
  title: {
    fontWeight: "600",
    color: colors.text,
  },
  subtitle: {
    color: colors.textSecondary,
    marginTop: 1,
  },
  closeButton: {
    margin: 0,
  },
  centered: {
    alignItems: "center",
    padding: spacing.lg,
    gap: spacing.sm,
  },
  loadingText: {
    color: colors.textSecondary,
  },
  errorText: {
    color: colors.danger,
    fontSize: 14,
  },
  list: {
    flex: 1,
  },
  emptyText: {
    padding: spacing.lg,
    color: colors.textTertiary,
    fontSize: 14,
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
  raceType: {
    fontSize: 11,
    color: colors.textSecondary,
    backgroundColor: colors.surface,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radii.sm,
  },
  raceCount: {
    fontSize: 11,
    color: colors.textTertiary,
    marginLeft: "auto",
  },
  item: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 2,
  },
  priority: {
    fontSize: 12,
    color: colors.textTertiary,
    width: 22,
  },
  runnerName: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.text,
    flex: 1,
    minWidth: 0,
    marginRight: spacing.sm,
  },
  statusBadge: {
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
  },
  statusText: {
    fontSize: 10,
    fontWeight: "600",
  },
  meta: {
    fontSize: 11,
    color: colors.textTertiary,
    marginLeft: 22,
  },
  chevron: {
    fontSize: 18,
    color: colors.textTertiary,
    marginLeft: spacing.sm,
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
});
