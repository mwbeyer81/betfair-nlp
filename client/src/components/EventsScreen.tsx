import React, { useState, useEffect } from "react";
import {
  View,
  ScrollView,
  StyleSheet,
  SafeAreaView,
} from "react-native";
import {
  Text,
  Appbar,
  Button,
  Chip,
  ActivityIndicator,
} from "react-native-paper";
import { EventDocsPanel } from "./EventDocsPanel";
import { RunnersPanel } from "./RunnersPanel";
import {
  chatApi,
  EventGroup,
  MarketDefinitionDoc,
  Race,
  Stats,
} from "../services/chatApi";
import { colors, radii, spacing } from "../theme";

interface EventsScreenProps {
  onNavigateToChat: () => void;
  onNavigateToAllRunners: () => void;
  onNavigateToIsp: () => void;
  onLogout?: () => void;
}

export const EventsScreen: React.FC<EventsScreenProps> = ({
  onNavigateToChat,
  onNavigateToAllRunners,
  onNavigateToIsp,
  onLogout,
}) => {
  const [groups, setGroups] = useState<EventGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [sort, setSort] = useState<"asc" | "desc">("asc");
  const PAGE_SIZE = 20;

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

  useEffect(() => {
    (async () => {
      setIsLoading(true);
      setError(null);
      setGroups([]);
      try {
        const [result, statsData] = await Promise.all([
          chatApi.getEventGroups(1, PAGE_SIZE, sort),
          chatApi.getStats(),
        ]);
        setGroups(result.data);
        setPage(1);
        setTotalPages(result.totalPages);
        setStats(statsData);
      } catch {
        setError("Failed to load events");
      } finally {
        setIsLoading(false);
      }
    })();
  }, [sort]);

  const loadMore = async () => {
    if (isLoadingMore || page >= totalPages) return;
    const nextPage = page + 1;
    setIsLoadingMore(true);
    try {
      const result = await chatApi.getEventGroups(nextPage, PAGE_SIZE, sort);
      setGroups(prev => [...prev, ...result.data]);
      setPage(nextPage);
      setTotalPages(result.totalPages);
    } catch {
      // silently fail
    } finally {
      setIsLoadingMore(false);
    }
  };

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

  return (
    <SafeAreaView testID="events-screen" style={styles.screen}>
      <View testID="events-stats-bar" style={styles.statsBar}>
        <Text
          testID="events-total-runners"
          style={[styles.statText, styles.statLinkText]}
          onPress={onNavigateToAllRunners}
        >
          {stats != null ? stats.totalRunners : "—"} runners
        </Text>
        <Text style={styles.statDot}>·</Text>
        <Text testID="events-total-races" style={styles.statText}>
          {stats != null ? stats.totalRaces : "—"} races
        </Text>
        <Text style={styles.statDot}>·</Text>
        <Text
          testID="events-nav-isp"
          style={[styles.statText, styles.statLinkText]}
          onPress={onNavigateToIsp}
        >
          Industry SP →
        </Text>
      </View>

      <Appbar.Header style={styles.appbar}>
        <Appbar.Content title="Events" titleStyle={styles.appbarTitle} />
        <Button
          testID="events-sort-toggle"
          mode="contained-tonal"
          compact
          onPress={() => setSort(s => (s === "asc" ? "desc" : "asc"))}
          style={styles.headerButton}
          labelStyle={styles.headerButtonLabel}
        >
          {sort === "asc" ? "Oldest first" : "Newest first"}
        </Button>
        <Button
          testID="events-screen-chat-button"
          mode="contained"
          compact
          buttonColor={colors.primaryDark}
          onPress={onNavigateToChat}
          style={styles.headerButton}
          labelStyle={styles.headerButtonLabel}
        >
          Chat →
        </Button>
        {onLogout && (
          <Button
            testID="events-screen-logout-button"
            mode="contained"
            compact
            buttonColor={colors.danger}
            onPress={onLogout}
            style={styles.headerButton}
            labelStyle={styles.headerButtonLabel}
          >
            Logout
          </Button>
        )}
      </Appbar.Header>

      <View style={styles.body}>
        {isLoading && (
          <View testID="event-group-loading" style={styles.centered}>
            <ActivityIndicator size="large" animating color={colors.primary} />
            <Text variant="bodyMedium" style={styles.loadingText}>
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
                <Text variant="bodyLarge" style={styles.eventName}>
                  {group.eventName}
                </Text>
                <Text variant="bodySmall" style={styles.meta}>
                  ID: {group.eventId}
                </Text>
                {group.earliestMarketTime && (
                  <Text variant="bodySmall" style={styles.meta}>
                    Date:{" "}
                    {new Date(group.earliestMarketTime).toLocaleDateString(
                      "en-GB",
                      { day: "2-digit", month: "short", year: "numeric" }
                    )}
                  </Text>
                )}
                <Text variant="bodySmall" style={styles.meta}>
                  Markets: {group.marketIds.join(", ")}
                </Text>
                <View style={styles.badgeRow}>
                  <Chip
                    testID={`event-docs-badge-${group.eventId}`}
                    compact
                    mode="flat"
                    onPress={() => loadDocs(group.eventId, group.eventName)}
                    style={styles.docsChip}
                    textStyle={styles.docsChipText}
                  >
                    {group.count} docs
                  </Chip>
                  <Chip
                    testID={`event-runners-badge-${group.eventId}`}
                    compact
                    mode="flat"
                    onPress={() => loadRunners(group.eventId, group.eventName)}
                    style={styles.runnersChip}
                    textStyle={styles.runnersChipText}
                  >
                    Runners
                  </Chip>
                </View>
              </View>
            ))}
            {page < totalPages && (
              <Button
                testID="events-load-more"
                mode="outlined"
                onPress={loadMore}
                disabled={isLoadingMore}
                style={styles.loadMoreButton}
                loading={isLoadingMore}
              >
                Load more
              </Button>
            )}
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
    backgroundColor: colors.background,
  },
  statsBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 5,
    backgroundColor: "#EEF2FF",
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  statText: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: "600",
  },
  statLinkText: {
    color: colors.primary,
    textDecorationLine: "underline",
  },
  statDot: {
    fontSize: 12,
    color: colors.textTertiary,
  },
  appbar: {
    backgroundColor: colors.primary,
    elevation: 4,
  },
  appbarTitle: {
    color: "white",
    fontSize: 20,
    fontWeight: "700",
  },
  headerButton: {
    marginHorizontal: 3,
    borderRadius: radii.md,
  },
  headerButtonLabel: {
    fontSize: 12,
    fontWeight: "600",
  },
  body: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xxl,
    gap: spacing.md,
  },
  loadingText: {
    color: colors.textSecondary,
  },
  errorText: {
    color: colors.danger,
    fontSize: 16,
  },
  list: {
    flex: 1,
  },
  emptyText: {
    padding: spacing.xl,
    color: colors.textTertiary,
    fontSize: 16,
    textAlign: "center",
  },
  item: {
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md + 2,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  eventName: {
    fontWeight: "600",
    color: colors.text,
    marginBottom: 4,
  },
  meta: {
    color: colors.textSecondary,
    marginBottom: 2,
  },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: spacing.sm,
  },
  docsChip: {
    backgroundColor: "#EEF2FF",
    borderRadius: radii.pill,
  },
  runnersChip: {
    backgroundColor: "#CFFAFE",
    borderRadius: radii.pill,
  },
  docsChipText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "600",
  },
  runnersChipText: {
    color: colors.info,
    fontSize: 12,
    fontWeight: "600",
  },
  loadMoreButton: {
    margin: spacing.lg,
    borderRadius: radii.md,
  },
});
