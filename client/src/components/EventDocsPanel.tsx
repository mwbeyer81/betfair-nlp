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
import { colors, statusPill, radii, spacing } from "../theme";

function formatIfTimestamp(value: string): string {
  const n = Number(value);
  if (isNaN(n)) return value;
  if (n >= 1e12 && n < 1e13) return new Date(n).toLocaleString("en-GB");
  if (n >= 1e9 && n < 1e10) return new Date(n * 1000).toLocaleString("en-GB");
  return n.toLocaleString();
}

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
          <ActivityIndicator size="small" animating color={colors.primary} />
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
            const statusPillColors =
              statusPill[doc.status] ?? {
                bg: colors.background,
                fg: colors.textTertiary,
              };
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
                    style={[
                      styles.statusBadge,
                      { backgroundColor: statusPillColors.bg },
                    ]}
                  >
                    <Text style={[styles.statusText, { color: statusPillColors.fg }]}>
                      {doc.status}
                    </Text>
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
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    maxHeight: 350,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: spacing.lg,
    paddingRight: spacing.xs,
    paddingVertical: 6,
    backgroundColor: colors.background,
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
  sortButton: {
    borderRadius: radii.button,
    marginRight: spacing.xs,
  },
  sortButtonLabel: {
    fontSize: 12,
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
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  itemHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  changeId: {
    color: colors.textSecondary,
    fontFamily: "monospace",
    flex: 1,
    minWidth: 0,
    marginRight: spacing.sm,
  },
  statusBadge: {
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  statusText: {
    fontSize: 10,
    fontWeight: "600",
  },
  meta: {
    color: colors.textSecondary,
    marginBottom: 2,
  },
  runners: {
    color: colors.textTertiary,
    fontStyle: "italic",
    marginTop: 2,
  },
});
