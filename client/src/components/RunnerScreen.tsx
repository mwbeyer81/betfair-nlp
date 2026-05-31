import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  SafeAreaView,
} from "react-native";
import { chatApi, PriceUpdate } from "../services/chatApi";

interface RunnerScreenProps {
  eventId: string;
  runnerId: number;
  runnerName: string;
  onBack: () => void;
}

export const RunnerScreen: React.FC<RunnerScreenProps> = ({
  eventId,
  runnerId,
  runnerName,
  onBack,
}) => {
  const [updates, setUpdates] = useState<PriceUpdate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    load(sort);
  }, [eventId, runnerId]);

  async function load(s: "asc" | "desc") {
    setIsLoading(true);
    setError(null);
    try {
      setUpdates(await chatApi.getRunnerPriceUpdates(eventId, runnerId, s));
    } catch {
      setError("Failed to load price updates");
    } finally {
      setIsLoading(false);
    }
  }

  function changeSort(s: "asc" | "desc") {
    setSort(s);
    load(s);
  }

  return (
    <SafeAreaView testID="runner-screen" style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity
          testID="runner-screen-back"
          style={styles.backButton}
          onPress={onBack}
        >
          <Text style={styles.backText}>← Runners</Text>
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>{runnerName}</Text>
          {!isLoading && (
            <Text style={styles.subtitle}>{updates.length} price updates</Text>
          )}
        </View>
      </View>

      <View style={styles.sortRow}>
        <TouchableOpacity
          testID="runner-screen-sort-desc"
          style={[styles.sortBtn, sort === "desc" && styles.sortBtnActive]}
          onPress={() => changeSort("desc")}
        >
          <Text style={[styles.sortBtnText, sort === "desc" && styles.sortBtnTextActive]}>
            Newest first
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID="runner-screen-sort-asc"
          style={[styles.sortBtn, sort === "asc" && styles.sortBtnActive]}
          onPress={() => changeSort("asc")}
        >
          <Text style={[styles.sortBtnText, sort === "asc" && styles.sortBtnTextActive]}>
            Oldest first
          </Text>
        </TouchableOpacity>
      </View>

      {isLoading && (
        <View testID="runner-screen-loading" style={styles.centered}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>Loading price updates…</Text>
        </View>
      )}

      {error && !isLoading && (
        <View testID="runner-screen-error" style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {!isLoading && !error && (
        <ScrollView testID="runner-screen-list" style={styles.list}>
          {updates.length === 0 && (
            <Text style={styles.emptyText}>No price updates found.</Text>
          )}
          {updates.map((u, i) => {
            const ts = u.timestamp
              ? new Date(u.timestamp).toLocaleString("en-GB", {
                  dateStyle: "short",
                  timeStyle: "medium",
                })
              : "—";
            return (
              <View
                key={u._id ?? `${u.changeId}-${i}`}
                testID={`runner-screen-item-${i}`}
                style={styles.item}
              >
                <Text style={styles.price}>£{u.lastTradedPrice.toFixed(2)}</Text>
                <Text style={styles.timestamp}>{ts}</Text>
              </View>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#f8f9fa",
  },
  header: {
    backgroundColor: "#007AFF",
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  backButton: {
    backgroundColor: "#0056b3",
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  backText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: "#fff",
  },
  subtitle: {
    fontSize: 12,
    color: "rgba(255,255,255,0.8)",
    marginTop: 2,
  },
  sortRow: {
    flexDirection: "row",
    padding: 10,
    gap: 8,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e9ecef",
  },
  sortBtn: {
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#dee2e6",
    backgroundColor: "#f8f9fa",
  },
  sortBtnActive: {
    backgroundColor: "#007AFF",
    borderColor: "#007AFF",
  },
  sortBtnText: {
    fontSize: 12,
    color: "#666",
    fontWeight: "500",
  },
  sortBtnTextActive: {
    color: "#fff",
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: "#666",
  },
  errorText: {
    color: "#d9534f",
    fontSize: 16,
  },
  list: {
    flex: 1,
  },
  emptyText: {
    padding: 24,
    color: "#999",
    fontSize: 16,
    textAlign: "center",
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  price: {
    fontSize: 22,
    fontWeight: "700",
    color: "#222",
  },
  timestamp: {
    fontSize: 13,
    color: "#888",
  },
});
