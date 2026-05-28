import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from "react-native";

function formatIfTimestamp(value: string): string {
  const n = Number(value);
  if (isNaN(n)) return value;
  if (n >= 1e12 && n < 1e13) return new Date(n).toLocaleString("en-GB");
  if (n >= 1e9 && n < 1e10) return new Date(n * 1000).toLocaleString("en-GB");
  return n.toLocaleString();
}
import { MarketDefinitionDoc } from "../services/chatApi";

const STATUS_COLORS: Record<string, string> = {
  OPEN: "#28a745",
  SUSPENDED: "#ffc107",
  CLOSED: "#6c757d",
};

interface EventDocsPanelProps {
  eventId: string;
  eventName: string;
  docs: MarketDefinitionDoc[];
  isLoading: boolean;
  error: string | null;
  onClose: () => void;
}

export const EventDocsPanel: React.FC<EventDocsPanelProps> = ({
  eventId,
  eventName,
  docs,
  isLoading,
  error,
  onClose,
}) => {
  return (
    <View testID="event-docs-panel" style={styles.panel}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>
            {eventName}
          </Text>
          <Text style={styles.subtitle}>{docs.length} documents</Text>
        </View>
        <TouchableOpacity
          testID="event-docs-close"
          onPress={onClose}
          style={styles.closeButton}
        >
          <Text style={styles.closeText}>✕</Text>
        </TouchableOpacity>
      </View>

      {isLoading && (
        <View testID="event-docs-loading" style={styles.centered}>
          <ActivityIndicator size="small" color="#007AFF" />
          <Text style={styles.loadingText}>Loading documents...</Text>
        </View>
      )}

      {error && !isLoading && (
        <View testID="event-docs-error" style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {!isLoading && !error && (
        <ScrollView testID="event-docs-list" style={styles.list}>
          {docs.length === 0 && (
            <Text style={styles.emptyText}>No documents found.</Text>
          )}
          {docs.map((doc, index) => {
            const statusColor = STATUS_COLORS[doc.status] ?? "#999";
            const marketDate = doc.marketTime
              ? new Date(doc.marketTime).toLocaleString("en-GB", {
                  dateStyle: "short",
                  timeStyle: "short",
                })
              : "—";
            return (
              <View
                key={doc._id ?? doc.changeId ?? index}
                testID={`event-doc-item-${index}`}
                style={styles.item}
              >
                <View style={styles.itemHeader}>
                  <Text style={styles.changeId} numberOfLines={1}>
                    Change: {doc.changeId}
                  </Text>
                  <View
                    testID={`event-doc-status-${index}`}
                    style={[styles.statusBadge, { backgroundColor: statusColor }]}
                  >
                    <Text style={styles.statusText}>{doc.status}</Text>
                  </View>
                </View>
                <Text style={styles.meta}>Type: {doc.marketType}</Text>
                <Text style={styles.meta}>Market time: {marketDate}</Text>
                <Text style={styles.meta}>
                  Active runners: {doc.numberOfActiveRunners}
                </Text>
                {doc.runners && doc.runners.length > 0 && (
                  <Text style={styles.runners} numberOfLines={2}>
                    Runners:{" "}
                    {doc.runners
                      .sort((a, b) => a.sortPriority - b.sortPriority)
                      .slice(0, 5)
                      .map(r => r.name)
                      .join(", ")}
                    {doc.runners.length > 5 ? `… +${doc.runners.length - 5}` : ""}
                  </Text>
                )}
              </View>
            );
          })}
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
    backgroundColor: "#f8f9fa",
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
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  itemHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  changeId: {
    fontSize: 12,
    color: "#555",
    fontFamily: "monospace",
    flex: 1,
    marginRight: 8,
  },
  statusBadge: {
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  statusText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "600",
  },
  meta: {
    fontSize: 12,
    color: "#666",
    marginBottom: 2,
  },
  runners: {
    fontSize: 11,
    color: "#888",
    fontStyle: "italic",
    marginTop: 2,
  },
});
