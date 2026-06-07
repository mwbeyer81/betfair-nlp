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
            const prev = updates[sort === "desc" ? i + 1 : i - 1];
            const priceDiff = prev ? u.lastTradedPrice - prev.lastTradedPrice : 0;
            const directionLabel = !prev || priceDiff === 0 ? "–" : priceDiff < 0 ? "▼" : "▲";
            const directionStyle = priceDiff < 0 ? styles.directionDown
              : priceDiff > 0 ? styles.directionUp : styles.directionFlat;
            const impliedProb = (1 / u.lastTradedPrice * 100).toFixed(1);
            const volDelta = u.tradedVolume !== undefined && prev?.tradedVolume !== undefined
              ? Math.abs(u.tradedVolume - prev.tradedVolume) : undefined;
            return (
              <View
                key={u._id ?? `${u.changeId}-${i}`}
                testID={`runner-screen-item-${i}`}
                style={styles.item}
              >
                {/* Row 1: direction + price + implied prob + timestamp */}
                <View style={styles.itemRow}>
                  <Text testID={`runner-screen-direction-${i}`} style={[styles.direction, directionStyle]}>
                    {directionLabel}
                  </Text>
                  <Text style={styles.price}>{u.lastTradedPrice.toFixed(2)}</Text>
                  <Text testID={`runner-screen-prob-${i}`} style={styles.impliedProb}>{impliedProb}%</Text>
                  <Text style={styles.timestamp}>{ts}</Text>
                </View>
                {/* Row 2: order book + volume (shown when available) */}
                {(u.bestBackSize != null || u.bestLaySize != null || volDelta != null) && (
                  <View style={styles.dataRow}>
                    {u.bestBackSize != null && (
                      <Text testID={`runner-screen-back-${i}`} style={styles.backChip}>
                        Back £{u.bestBackSize.toFixed(0)} @ {u.bestBackPrice?.toFixed(2)}
                      </Text>
                    )}
                    {u.bestLaySize != null && (
                      <Text testID={`runner-screen-lay-${i}`} style={styles.layChip}>
                        Lay £{u.bestLaySize.toFixed(0)} @ {u.bestLayPrice?.toFixed(2)}
                      </Text>
                    )}
                    {volDelta != null && (
                      <Text testID={`runner-screen-volume-${i}`} style={styles.volumeChip}>
                        +£{volDelta.toFixed(0)} matched
                      </Text>
                    )}
                  </View>
                )}
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
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  dataRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 6,
    paddingLeft: 32,
  },
  direction: {
    fontSize: 18,
    fontWeight: "700",
    width: 24,
    textAlign: "center",
  },
  directionDown: { color: "#28a745" },
  directionUp:   { color: "#dc3545" },
  directionFlat: { color: "#aaa" },
  price: {
    fontSize: 22,
    fontWeight: "700",
    color: "#222",
    minWidth: 55,
  },
  impliedProb: {
    fontSize: 13,
    color: "#888",
    flex: 1,
  },
  timestamp: {
    fontSize: 12,
    color: "#aaa",
  },
  backChip: {
    fontSize: 12,
    fontWeight: "600",
    color: "#0056b3",
    backgroundColor: "#e8f0fe",
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 5,
  },
  layChip: {
    fontSize: 12,
    fontWeight: "600",
    color: "#842029",
    backgroundColor: "#f8d7da",
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 5,
  },
  volumeChip: {
    fontSize: 12,
    color: "#555",
    backgroundColor: "#f0f0f0",
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 5,
  },
});
