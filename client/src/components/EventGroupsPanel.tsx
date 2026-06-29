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
          <ActivityIndicator size="small" animating />
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
                  textStyle={styles.chipText}
                >
                  {group.count} docs
                </Chip>
                <Chip
                  testID={`event-runners-badge-${group.eventId}`}
                  compact
                  mode="flat"
                  onPress={() => onViewRunners(group.eventId, group.eventName)}
                  style={styles.runnersChip}
                  textStyle={styles.chipText}
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
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: "#e0e0e0",
    maxHeight: 300,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingLeft: 16,
    paddingRight: 4,
    paddingVertical: 4,
  },
  title: {
    color: "#333",
    fontWeight: "600",
  },
  closeButton: {
    margin: 0,
  },
  centered: {
    alignItems: "center",
    padding: 16,
    gap: 8,
  },
  loadingText: {
    color: "#666",
  },
  errorText: {
    color: "#dc3545",
    fontSize: 14,
  },
  list: {
    flex: 1,
  },
  emptyText: {
    padding: 16,
    color: "#999",
    fontSize: 14,
  },
  item: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  eventName: {
    fontWeight: "600",
    color: "#222",
    marginBottom: 4,
  },
  meta: {
    color: "#666",
    marginBottom: 2,
  },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 6,
  },
  docsChip: {
    backgroundColor: "#007AFF",
    borderRadius: 10,
  },
  runnersChip: {
    backgroundColor: "#28a745",
    borderRadius: 10,
  },
  chipText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "600",
  },
  statsBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 5,
    backgroundColor: "#f0f4ff",
    borderBottomWidth: 1,
    borderBottomColor: "#dde3f0",
  },
  statText: {
    fontSize: 12,
    color: "#4a5568",
    fontWeight: "600",
  },
  statLinkText: {
    color: "#007AFF",
    textDecorationLine: "underline",
  },
  statDot: {
    fontSize: 12,
    color: "#a0aec0",
  },
});
