import React from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { EventGroup } from "../services/chatApi";

interface EventGroupsPanelProps {
  groups: EventGroup[];
  isLoading: boolean;
  error: string | null;
  onClose: () => void;
  onViewDocs: (eventId: string, eventName: string) => void;
}

export const EventGroupsPanel: React.FC<EventGroupsPanelProps> = ({
  groups,
  isLoading,
  error,
  onClose,
  onViewDocs,
}) => {
  return (
    <View testID="events-panel" style={styles.panel}>
      <View style={styles.header}>
        <Text style={styles.title}>Events</Text>
        <TouchableOpacity
          testID="events-panel-close"
          onPress={onClose}
          style={styles.closeButton}
        >
          <Text style={styles.closeText}>✕</Text>
        </TouchableOpacity>
      </View>

      {isLoading && (
        <View testID="event-group-loading" style={styles.centered}>
          <ActivityIndicator size="small" color="#007AFF" />
          <Text style={styles.loadingText}>Loading events...</Text>
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
              <Text style={styles.eventName}>{group.eventName}</Text>
              <Text style={styles.meta}>ID: {group.eventId}</Text>
              <Text style={styles.meta}>
                Markets: {group.marketIds.join(", ")}
              </Text>
              <TouchableOpacity
                testID={`event-docs-badge-${group.eventId}`}
                style={styles.badge}
                onPress={() => onViewDocs(group.eventId, group.eventName)}
              >
                <Text style={styles.badgeText}>{group.count} docs</Text>
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
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
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  title: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
  },
  closeButton: {
    padding: 4,
  },
  closeText: {
    fontSize: 16,
    color: "#666",
  },
  centered: {
    alignItems: "center",
    padding: 16,
  },
  loadingText: {
    marginTop: 8,
    color: "#666",
    fontSize: 14,
  },
  errorText: {
    color: "#d9534f",
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
    fontSize: 15,
    fontWeight: "600",
    color: "#222",
    marginBottom: 4,
  },
  meta: {
    fontSize: 12,
    color: "#666",
    marginBottom: 2,
  },
  badge: {
    alignSelf: "flex-start",
    marginTop: 4,
    backgroundColor: "#007AFF",
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "600",
  },
});
