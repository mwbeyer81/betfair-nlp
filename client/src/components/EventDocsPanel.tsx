import React, { useState, useMemo } from "react";
import {
  View,
  ScrollView,
  StyleSheet,
} from "react-native";
import {
  Text,
  IconButton,
  Button,
  ActivityIndicator,
  Surface,
  Divider,
} from "react-native-paper";
import { MarketDefinitionDoc } from "../services/chatApi";

function formatIfTimestamp(value: string): string {
  const n = Number(value);
  if (isNaN(n)) return value;
  if (n >= 1e12 && n < 1e13) return new Date(n).toLocaleString("en-GB");
  if (n >= 1e9 && n < 1e10) return new Date(n * 1000).toLocaleString("en-GB");
  return n.toLocaleString();
}

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
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");

  const sortedDocs = useMemo(
    () =>
      [...docs].sort((a, b) =>
        sortDir === "desc"
          ? Number(b.changeId) - Number(a.changeId)
          : Number(a.changeId) - Number(b.changeId)
      ),
    [docs, sortDir]
  );

  return (
    <Surface testID="event-docs-panel" style={styles.panel} elevation={3}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text variant="bodyMedium" style={styles.title} numberOfLines={1}>
            {eventName}
          </Text>
          <Text variant="bodySmall" style={styles.subtitle}>
            {docs.length} documents
          </Text>
        </View>
        <Button
          testID="event-docs-sort-toggle"
          mode="outlined"
          compact
          onPress={() => setSortDir(d => (d === "desc" ? "asc" : "desc"))}
          style={styles.sortButton}
          labelStyle={styles.sortButtonLabel}
        >
          Change {sortDir === "desc" ? "↓" : "↑"}
        </Button>
        <IconButton
          testID="event-docs-close"
          icon="close"
          size={20}
          onPress={onClose}
          style={styles.closeButton}
        />
      </View>

      <Divider />

      {isLoading && (
        <View testID="event-docs-loading" style={styles.centered}>
          <ActivityIndicator size="small" animating />
          <Text variant="bodySmall" style={styles.loadingText}>
            Loading documents…
          </Text>
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
          {sortedDocs.map((doc, index) => {
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
                  <Text variant="bodySmall" style={styles.changeId} numberOfLines={1}>
                    Change: {formatIfTimestamp(doc.changeId)}
                  </Text>
                  <View
                    testID={`event-doc-status-${index}`}
                    style={[styles.statusBadge, { backgroundColor: statusColor }]}
                  >
                    <Text style={styles.statusText}>{doc.status}</Text>
                  </View>
                </View>
                <Text variant="bodySmall" style={styles.meta}>
                  Type: {doc.marketType}
                </Text>
                <Text variant="bodySmall" style={styles.meta}>
                  Market time: {marketDate}
                </Text>
                <Text variant="bodySmall" style={styles.meta}>
                  Active runners: {doc.numberOfActiveRunners}
                </Text>
                {doc.runners && doc.runners.length > 0 && (
                  <Text variant="bodySmall" style={styles.runners} numberOfLines={2}>
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
    </Surface>
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
    alignItems: "center",
    paddingLeft: 16,
    paddingRight: 4,
    paddingVertical: 6,
    backgroundColor: "#f8f9fa",
  },
  headerText: {
    flex: 1,
    marginRight: 8,
  },
  title: {
    fontWeight: "600",
    color: "#222",
  },
  subtitle: {
    color: "#888",
    marginTop: 1,
  },
  sortButton: {
    borderRadius: 6,
    marginRight: 4,
  },
  sortButtonLabel: {
    fontSize: 12,
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
    color: "#666",
    marginBottom: 2,
  },
  runners: {
    color: "#888",
    fontStyle: "italic",
    marginTop: 2,
  },
});
