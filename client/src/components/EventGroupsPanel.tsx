import React from "react";
import {
  View,
  ScrollView,
  StyleSheet,
} from "react-native";
import {
  Text,
  Chip,
  IconButton,
  ActivityIndicator,
  Surface,
  Divider,
} from "react-native-paper";
import { EventGroup } from "../services/chatApi";
import { colors, radii, spacing } from "../theme";

interface EventGroupsPanelProps {
  groups: EventGroup[];
  isLoading: boolean;
  error: string | null;
  onClose: () => void;
  onViewDocs: (eventId: string, eventName: string) => void;
  onViewRunners: (eventId: string, eventName: string) => void;
  totalRaces?: number;
  totalRunners?: number;
  onViewAllRunners?: () => void;
}

export const EventGroupsPanel: React.FC<EventGroupsPanelProps> = ({
  groups,
  isLoading,
  error,
  onClose,
  onViewDocs,
  onViewRunners,
  totalRaces,
  totalRunners,
  onViewAllRunners,
}) => {
  return (
    <Surface testID="events-panel" style={styles.panel} elevation={3}>
      {(totalRaces !== undefined || totalRunners !== undefined) && (
        <View testID="events-stats-bar" style={styles.statsBar}>
          {onViewAllRunners ? (
            <Text
              testID="events-total-runners"
              style={[styles.statText, styles.statLinkText]}
              onPress={onViewAllRunners}
            >
              {totalRunners ?? "—"} runners
            </Text>
          ) : (
            <Text testID="events-total-runners" style={styles.statText}>
              {totalRunners ?? "—"} runners
            </Text>
          )}
          <Text style={styles.statDot}>·</Text>
          <Text testID="events-total-races" style={styles.statText}>
            {totalRaces ?? "—"} races
          </Text>
        </View>
      )}

      <View style={styles.header}>
        <Text variant="titleMedium" style={styles.title}>
          Events
        </Text>
        <IconButton
          testID="events-panel-close"
          icon="close"
          size={20}
          onPress={onClose}
          style={styles.closeButton}
        />
      </View>

      <Divider />

      {isLoading && (
        <View testID="event-group-loading" style={styles.centered}>
          <ActivityIndicator size="small" animating color={colors.primary} />
          <Text variant="bodySmall" style={styles.loadingText}>
            Loading events…
          </Text>
        </View>
      )}

      {error && !isLoading && (
        <View testID="event-group-error" style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {!isLoading && !error && (
        <ScrollView testID="event-group-list" style={styles.list}>
          {groups.length === 0 && (
            <Text style={styles.emptyText}>No events found.</Text>
          )}
          {groups.map(group => (
            <View
              key={group.eventId}
              testID={`event-group-item-${group.eventId}`}
              style={styles.item}
            >
              <Text variant="bodyMedium" style={styles.eventName}>
                {group.eventName}
              </Text>
              <Text variant="bodySmall" style={styles.meta}>
                ID: {group.eventId}
              </Text>
              <Text variant="bodySmall" style={styles.meta}>
                Markets: {group.marketIds.join(", ")}
              </Text>
              <View style={styles.badgeRow}>
                <Chip
                  testID={`event-docs-badge-${group.eventId}`}
                  compact
                  mode="flat"
                  onPress={() => onViewDocs(group.eventId, group.eventName)}
                  style={styles.docsChip}
                  textStyle={styles.docsChipText}
                >
                  {group.count} docs
                </Chip>
                <Chip
                  testID={`event-runners-badge-${group.eventId}`}
                  compact
                  mode="flat"
                  onPress={() => onViewRunners(group.eventId, group.eventName)}
                  style={styles.runnersChip}
                  textStyle={styles.runnersChipText}
                >
                  Runners
                </Chip>
              </View>
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
    maxHeight: 300,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingLeft: spacing.lg,
    paddingRight: spacing.xs,
    paddingVertical: spacing.xs,
  },
  title: {
    color: colors.text,
    fontWeight: "600",
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
  item: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  eventName: {
    fontWeight: "600",
    color: colors.text,
    marginBottom: 4,
  },
  meta: {
    color: colors.textSecondary,
    marginBottom: 2,
  },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: spacing.xs,
  },
  docsChip: {
    backgroundColor: colors.primaryLight,
    borderRadius: radii.pill,
  },
  runnersChip: {
    backgroundColor: colors.infoLight,
    borderRadius: radii.pill,
  },
  docsChipText: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: "600",
  },
  runnersChipText: {
    color: colors.info,
    fontSize: 11,
    fontWeight: "600",
  },
  statsBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 5,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  statText: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: "600",
  },
  statLinkText: {
    color: colors.primary,
    textDecorationLine: "underline",
  },
  statDot: {
    fontSize: 12,
    color: colors.textTertiary,
  },
});
