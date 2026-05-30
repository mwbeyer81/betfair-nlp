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
import { EventDocsPanel } from "./EventDocsPanel";
import { PriceUpdatesPanel } from "./PriceUpdatesPanel";
import { RunnersPanel } from "./RunnersPanel";
import {
  chatApi,
  EventGroup,
  MarketDefinitionDoc,
  PriceUpdate,
  Race,
  Stats,
} from "../services/chatApi";

interface EventsScreenProps {
  onNavigateToChat: () => void;
  onNavigateToAllRunners: () => void;
  onLogout?: () => void;
}

export const EventsScreen: React.FC<EventsScreenProps> = ({
  onNavigateToChat,
  onNavigateToAllRunners,
  onLogout,
}) => {
  const [groups, setGroups] = useState<EventGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);

  const [showDocsPanel, setShowDocsPanel] = useState(false);
  const [docsEventId, setDocsEventId] = useState("");
  const [docsEventName, setDocsEventName] = useState("");
  const [docs, setDocs] = useState<MarketDefinitionDoc[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docsError, setDocsError] = useState<string | null>(null);

  const [showRunnersPanel, setShowRunnersPanel] = useState(false);
  const [runnersEventId, setRunnersEventId] = useState("");
  const [runnersEventName, setRunnersEventName] = useState("");
  const [races, setRaces] = useState<Race[]>([]);
  const [runnersLoading, setRunnersLoading] = useState(false);
  const [runnersError, setRunnersError] = useState<string | null>(null);

  const [showPriceUpdatesPanel, setShowPriceUpdatesPanel] = useState(false);
  const [priceUpdatesEventId, setPriceUpdatesEventId] = useState("");
  const [priceUpdatesEventName, setPriceUpdatesEventName] = useState("");
  const [priceUpdates, setPriceUpdates] = useState<PriceUpdate[]>([]);
  const [priceUpdatesLoading, setPriceUpdatesLoading] = useState(false);
  const [priceUpdatesError, setPriceUpdatesError] = useState<string | null>(null);

  const [showRunnerPriceUpdatesPanel, setShowRunnerPriceUpdatesPanel] = useState(false);
  const [runnerPriceUpdatesRunnerId, setRunnerPriceUpdatesRunnerId] = useState(0);
  const [runnerPriceUpdatesRunnerName, setRunnerPriceUpdatesRunnerName] = useState("");
  const [runnerPriceUpdates, setRunnerPriceUpdates] = useState<PriceUpdate[]>([]);
  const [runnerPriceUpdatesLoading, setRunnerPriceUpdatesLoading] = useState(false);
  const [runnerPriceUpdatesError, setRunnerPriceUpdatesError] = useState<string | null>(null);
  const [runnerPriceUpdatesSort, setRunnerPriceUpdatesSort] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const [groupData, statsData] = await Promise.all([
          chatApi.getEventGroups(),
          chatApi.getStats(),
        ]);
        setGroups(groupData);
        setStats(statsData);
      } catch {
        setError("Failed to load events");
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const loadDocs = async (eventId: string, eventName: string) => {
    setDocsEventId(eventId);
    setDocsEventName(eventName);
    setShowDocsPanel(true);
    setDocsLoading(true);
    setDocsError(null);
    try {
      setDocs(await chatApi.getEventDefinitions(eventId));
    } catch {
      setDocsError("Failed to load documents");
    } finally {
      setDocsLoading(false);
    }
  };

  const loadRunners = async (eventId: string, eventName: string) => {
    setRunnersEventId(eventId);
    setRunnersEventName(eventName);
    setShowRunnersPanel(true);
    setRunnersLoading(true);
    setRunnersError(null);
    try {
      setRaces(await chatApi.getEventRunners(eventId));
    } catch {
      setRunnersError("Failed to load runners");
    } finally {
      setRunnersLoading(false);
    }
  };

  const loadPriceUpdates = async (eventId: string, eventName: string) => {
    setPriceUpdatesEventId(eventId);
    setPriceUpdatesEventName(eventName);
    setShowPriceUpdatesPanel(true);
    setPriceUpdatesLoading(true);
    setPriceUpdatesError(null);
    try {
      setPriceUpdates(await chatApi.getPriceUpdates(eventId));
    } catch {
      setPriceUpdatesError("Failed to load price updates");
    } finally {
      setPriceUpdatesLoading(false);
    }
  };

  const loadRunnerPriceUpdates = async (
    runnerId: number,
    runnerName: string,
    sort: "asc" | "desc" = "desc"
  ) => {
    setRunnerPriceUpdatesRunnerId(runnerId);
    setRunnerPriceUpdatesRunnerName(runnerName);
    setRunnerPriceUpdatesSort(sort);
    setShowRunnerPriceUpdatesPanel(true);
    setRunnerPriceUpdatesLoading(true);
    setRunnerPriceUpdatesError(null);
    try {
      setRunnerPriceUpdates(
        await chatApi.getRunnerPriceUpdates(runnersEventId, runnerId, sort)
      );
    } catch {
      setRunnerPriceUpdatesError("Failed to load price updates");
    } finally {
      setRunnerPriceUpdatesLoading(false);
    }
  };

  return (
    <SafeAreaView testID="events-screen" style={styles.screen}>
      <View testID="events-stats-bar" style={styles.statsBar}>
        <TouchableOpacity
          testID="events-total-runners"
          onPress={onNavigateToAllRunners}
          style={styles.statLink}
        >
          <Text style={[styles.statText, styles.statLinkText]}>
            {stats != null ? stats.totalRunners : "—"} runners
          </Text>
        </TouchableOpacity>
        <Text style={styles.statDot}>·</Text>
        <Text testID="events-total-races" style={styles.statText}>
          {stats != null ? stats.totalRaces : "—"} races
        </Text>
      </View>

      <View style={styles.header}>
        <Text style={styles.title}>Events</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            testID="events-screen-chat-button"
            style={styles.chatButton}
            onPress={onNavigateToChat}
          >
            <Text style={styles.chatButtonText}>Chat →</Text>
          </TouchableOpacity>
          {onLogout && (
            <TouchableOpacity
              testID="events-screen-logout-button"
              style={styles.logoutButton}
              onPress={onLogout}
            >
              <Text style={styles.logoutButtonText}>Logout</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <View style={styles.body}>
        {isLoading && (
          <View testID="event-group-loading" style={styles.centered}>
            <ActivityIndicator size="large" color="#007AFF" />
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
                <View style={styles.badgeRow}>
                  <TouchableOpacity
                    testID={`event-docs-badge-${group.eventId}`}
                    style={styles.badge}
                    onPress={() => loadDocs(group.eventId, group.eventName)}
                  >
                    <Text style={styles.badgeText}>{group.count} docs</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    testID={`event-runners-badge-${group.eventId}`}
                    style={[styles.badge, styles.runnersBadge]}
                    onPress={() => loadRunners(group.eventId, group.eventName)}
                  >
                    <Text style={styles.badgeText}>Runners</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    testID={`event-price-updates-badge-${group.eventId}`}
                    style={[styles.badge, styles.priceUpdatesBadge]}
                    onPress={() => loadPriceUpdates(group.eventId, group.eventName)}
                  >
                    <Text style={styles.badgeText}>Price updates</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </ScrollView>
        )}
      </View>

      {showRunnersPanel && (
        <RunnersPanel
          eventId={runnersEventId}
          eventName={runnersEventName}
          races={races}
          isLoading={runnersLoading}
          error={runnersError}
          onClose={() => setShowRunnersPanel(false)}
          onRunnerSelect={loadRunnerPriceUpdates}
        />
      )}

      {showRunnerPriceUpdatesPanel && (
        <PriceUpdatesPanel
          eventId={runnersEventId}
          eventName={runnerPriceUpdatesRunnerName}
          updates={runnerPriceUpdates}
          isLoading={runnerPriceUpdatesLoading}
          error={runnerPriceUpdatesError}
          onClose={() => setShowRunnerPriceUpdatesPanel(false)}
          sort={runnerPriceUpdatesSort}
          onSortChange={(sort) => loadRunnerPriceUpdates(runnerPriceUpdatesRunnerId, runnerPriceUpdatesRunnerName, sort)}
        />
      )}

      {showPriceUpdatesPanel && (
        <PriceUpdatesPanel
          eventId={priceUpdatesEventId}
          eventName={priceUpdatesEventName}
          updates={priceUpdates}
          isLoading={priceUpdatesLoading}
          error={priceUpdatesError}
          onClose={() => setShowPriceUpdatesPanel(false)}
        />
      )}

      {showDocsPanel && (
        <EventDocsPanel
          eventId={docsEventId}
          eventName={docsEventName}
          docs={docs}
          isLoading={docsLoading}
          error={docsError}
          onClose={() => setShowDocsPanel(false)}
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#f8f9fa",
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
  statLink: {
    paddingVertical: 2,
  },
  statLinkText: {
    color: "#007AFF",
    textDecorationLine: "underline",
  },
  statDot: {
    fontSize: 12,
    color: "#a0aec0",
  },
  header: {
    backgroundColor: "#007AFF",
    paddingVertical: 14,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: "#fff",
  },
  headerActions: {
    flexDirection: "row",
    gap: 8,
  },
  chatButton: {
    backgroundColor: "#0056b3",
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  chatButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  logoutButton: {
    backgroundColor: "red",
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  logoutButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  body: {
    flex: 1,
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
    backgroundColor: "#fff",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  eventName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#222",
    marginBottom: 4,
  },
  meta: {
    fontSize: 12,
    color: "#666",
    marginBottom: 2,
  },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 6,
  },
  badge: {
    alignSelf: "flex-start",
    backgroundColor: "#007AFF",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  runnersBadge: {
    backgroundColor: "#28a745",
  },
  priceUpdatesBadge: {
    backgroundColor: "#6f42c1",
  },
  badgeText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
});
