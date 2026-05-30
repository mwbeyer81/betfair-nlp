import React from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { PriceUpdate } from "../services/chatApi";

interface PriceUpdatesPanelProps {
  eventId: string;
  eventName: string;
  updates: PriceUpdate[];
  isLoading: boolean;
  error: string | null;
  onClose: () => void;
  sort?: "asc" | "desc";
  onSortChange?: (sort: "asc" | "desc") => void;
}

export const PriceUpdatesPanel: React.FC<PriceUpdatesPanelProps> = ({
  eventId,
  eventName,
  updates,
  isLoading,
  error,
  onClose,
  sort = "desc",
  onSortChange,
}) => {
  return (
    <View testID="price-updates-panel" style={styles.panel}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>
            {eventName}
          </Text>
          <Text style={styles.subtitle}>
            Price updates · {updates.length} records
          </Text>
        </View>
        <TouchableOpacity
          testID="price-updates-close"
          onPress={onClose}
          style={styles.closeButton}
        >
          <Text style={styles.closeText}>✕</Text>
        </TouchableOpacity>
      </View>

      {onSortChange && (
        <View style={styles.sortRow}>
          <TouchableOpacity
            testID="price-updates-sort-desc"
            style={[styles.sortButton, sort === "desc" && styles.sortButtonActive]}
            onPress={() => onSortChange("desc")}
          >
            <Text style={[styles.sortButtonText, sort === "desc" && styles.sortButtonTextActive]}>
              Newest
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="price-updates-sort-asc"
            style={[styles.sortButton, sort === "asc" && styles.sortButtonActive]}
            onPress={() => onSortChange("asc")}
          >
            <Text style={[styles.sortButtonText, sort === "asc" && styles.sortButtonTextActive]}>
              Oldest
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {isLoading && (
        <View testID="price-updates-loading" style={styles.centered}>
          <ActivityIndicator size="small" color="#007AFF" />
          <Text style={styles.loadingText}>Loading price updates...</Text>
        </View>
      )}

      {error && !isLoading && (
        <View testID="price-updates-error" style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {!isLoading && !error && (
        <ScrollView testID="price-updates-list" style={styles.list}>
          {updates.length === 0 && (
            <Text style={styles.emptyText}>No price updates found.</Text>
          )}
          {updates.map((update, index) => {
            const ts = update.timestamp
              ? new Date(update.timestamp).toLocaleString("en-GB", {
                  dateStyle: "short",
                  timeStyle: "medium",
                })
              : "—";
            return (
              <View
                key={update._id ?? `${update.changeId}-${update.runnerId}-${index}`}
                testID={`price-update-item-${index}`}
                style={styles.item}
              >
                <View style={styles.itemRow}>
                  <Text style={styles.runnerName} numberOfLines={1}>
                    {update.runnerName}
                  </Text>
                  <Text style={styles.price}>{update.lastTradedPrice}</Text>
                </View>
                <Text style={styles.meta}>Market: {update.marketId}</Text>
                <Text style={styles.meta}>{ts}</Text>
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
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  itemRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 2,
  },
  runnerName: {
    fontSize: 13,
    fontWeight: "600",
    color: "#222",
    flex: 1,
    marginRight: 8,
  },
  price: {
    fontSize: 14,
    fontWeight: "700",
    color: "#007AFF",
  },
  meta: {
    fontSize: 11,
    color: "#888",
    marginBottom: 1,
  },
  sortRow: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingVertical: 6,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
    backgroundColor: "#fafafa",
  },
  sortButton: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#ccc",
    backgroundColor: "#fff",
  },
  sortButtonActive: {
    backgroundColor: "#007AFF",
    borderColor: "#007AFF",
  },
  sortButtonText: {
    fontSize: 12,
    color: "#555",
    fontWeight: "500",
  },
  sortButtonTextActive: {
    color: "#fff",
  },
});
