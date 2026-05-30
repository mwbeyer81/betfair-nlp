import React from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { Runner } from "../services/chatApi";

interface RunnersPanelProps {
  eventId: string;
  eventName: string;
  runners: Runner[];
  isLoading: boolean;
  error: string | null;
  onClose: () => void;
}

const STATUS_COLOR: Record<string, string> = {
  ACTIVE: "#28a745",
  WINNER: "#ffc107",
  LOSER: "#dc3545",
  HIDDEN: "#6c757d",
};

export const RunnersPanel: React.FC<RunnersPanelProps> = ({
  eventId,
  eventName,
  runners,
  isLoading,
  error,
  onClose,
}) => {
  return (
    <View testID="runners-panel" style={styles.panel}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>
            {eventName}
          </Text>
          <Text style={styles.subtitle}>
            Runners · {runners.length} unique
          </Text>
        </View>
        <TouchableOpacity
          testID="runners-panel-close"
          onPress={onClose}
          style={styles.closeButton}
        >
          <Text style={styles.closeText}>✕</Text>
        </TouchableOpacity>
      </View>

      {isLoading && (
        <View testID="runners-loading" style={styles.centered}>
          <ActivityIndicator size="small" color="#28a745" />
          <Text style={styles.loadingText}>Loading runners...</Text>
        </View>
      )}

      {error && !isLoading && (
        <View testID="runners-error" style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {!isLoading && !error && (
        <ScrollView testID="runners-list" style={styles.list}>
          {runners.length === 0 && (
            <Text style={styles.emptyText}>No runners found.</Text>
          )}
          {runners.map((runner) => (
            <View
              key={runner.id}
              testID={`runner-item-${runner.id}`}
              style={styles.item}
            >
              <View style={styles.itemRow}>
                <Text style={styles.priority}>{runner.sortPriority}.</Text>
                <Text style={styles.runnerName} numberOfLines={1}>
                  {runner.name}
                </Text>
                <View
                  style={[
                    styles.statusBadge,
                    { backgroundColor: STATUS_COLOR[runner.status] ?? "#6c757d" },
                  ]}
                >
                  <Text style={styles.statusText}>{runner.status}</Text>
                </View>
              </View>
              <Text style={styles.meta}>ID: {runner.id}</Text>
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
    maxHeight: 350,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
    backgroundColor: "#f0fff4",
  },
  headerText: {
    flex: 1,
    marginRight: 8,
  },
  title: {
    fontSize: 15,
    fontWeight: "600",
    color: "#222",
  },
  subtitle: {
    fontSize: 12,
    color: "#888",
    marginTop: 1,
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
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 2,
  },
  priority: {
    fontSize: 12,
    color: "#999",
    width: 22,
  },
  runnerName: {
    fontSize: 13,
    fontWeight: "600",
    color: "#222",
    flex: 1,
    marginRight: 8,
  },
  statusBadge: {
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  statusText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "600",
  },
  meta: {
    fontSize: 11,
    color: "#aaa",
    marginLeft: 22,
  },
});
