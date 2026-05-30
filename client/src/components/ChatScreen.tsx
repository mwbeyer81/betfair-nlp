import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  TouchableOpacity,
} from "react-native";
import { Message } from "./Message";
import { ChatInput } from "./ChatInput";
import { EventGroupsPanel } from "./EventGroupsPanel";
import { EventDocsPanel } from "./EventDocsPanel";
import { PriceUpdatesPanel } from "./PriceUpdatesPanel";
import { RunnersPanel } from "./RunnersPanel";
import { chatApi, EventGroup, MarketDefinitionDoc, PriceUpdate, Runner } from "../services/chatApi";

interface MessageData {
  id: string;
  text: string;
  isUser: boolean;
  timestamp: Date;
  mongoScript?: string;
  aiAnalysis?: any;
}

interface ChatScreenProps {
  onLogout?: () => void;
}

export const ChatScreen: React.FC<ChatScreenProps> = ({ onLogout }) => {
  const [messages, setMessages] = useState<MessageData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [queryHistory, setQueryHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [showEventsPanel, setShowEventsPanel] = useState(false);
  const [eventGroups, setEventGroups] = useState<EventGroup[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [showDocsPanel, setShowDocsPanel] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [selectedEventName, setSelectedEventName] = useState("");
  const [eventDocs, setEventDocs] = useState<MarketDefinitionDoc[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docsError, setDocsError] = useState<string | null>(null);
  const [showPriceUpdatesPanel, setShowPriceUpdatesPanel] = useState(false);
  const [priceUpdatesEventId, setPriceUpdatesEventId] = useState("");
  const [priceUpdatesEventName, setPriceUpdatesEventName] = useState("");
  const [priceUpdates, setPriceUpdates] = useState<PriceUpdate[]>([]);
  const [priceUpdatesLoading, setPriceUpdatesLoading] = useState(false);
  const [priceUpdatesError, setPriceUpdatesError] = useState<string | null>(null);
  const [showRunnersPanel, setShowRunnersPanel] = useState(false);
  const [runnersEventId, setRunnersEventId] = useState("");
  const [runnersEventName, setRunnersEventName] = useState("");
  const [runners, setRunners] = useState<Runner[]>([]);
  const [runnersLoading, setRunnersLoading] = useState(false);
  const [runnersError, setRunnersError] = useState<string | null>(null);
  const flatListRef = useRef<FlatList>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages]);

  const loadEventGroups = async () => {
    setShowEventsPanel(true);
    setEventsLoading(true);
    setEventsError(null);
    try {
      const groups = await chatApi.getEventGroups();
      setEventGroups(groups);
    } catch {
      setEventsError("Failed to load events");
    } finally {
      setEventsLoading(false);
    }
  };

  const loadEventDocs = async (eventId: string, eventName: string) => {
    setSelectedEventId(eventId);
    setSelectedEventName(eventName);
    setShowDocsPanel(true);
    setDocsLoading(true);
    setDocsError(null);
    try {
      const docs = await chatApi.getEventDefinitions(eventId);
      setEventDocs(docs);
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
      const data = await chatApi.getEventRunners(eventId);
      setRunners(data);
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
      const updates = await chatApi.getPriceUpdates(eventId);
      setPriceUpdates(updates);
    } catch {
      setPriceUpdatesError("Failed to load price updates");
    } finally {
      setPriceUpdatesLoading(false);
    }
  };

  const sendMessage = async (messageText: string) => {
    // Add query to history
    setQueryHistory(prev => [...prev, messageText]);
    setHistoryIndex(-1); // Reset history index

    const userMessage: MessageData = {
      id: Date.now().toString(),
      text: messageText,
      isUser: true,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);

    try {
      const response = await chatApi.sendMessage(messageText);
      const botMessage: MessageData = {
        id: (Date.now() + 1).toString(),
        text: response.reply,
        isUser: false,
        timestamp: new Date(),
        mongoScript:
          response.data?.mongoScript ||
          (response.data?.aiAnalysis
            ? JSON.parse(response.data.aiAnalysis).mongoScript
            : undefined),
        aiAnalysis: response.data?.aiAnalysis
          ? JSON.parse(response.data.aiAnalysis)
          : undefined,
      };
      setMessages(prev => [...prev, botMessage]);
    } catch (error) {
      const errorMessage: MessageData = {
        id: (Date.now() + 1).toString(),
        text: "Sorry, I encountered an error. Please try again.",
        isUser: false,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const renderMessage = ({ item }: { item: MessageData }) => (
    <Message
      text={item.text}
      isUser={item.isUser}
      timestamp={item.timestamp}
      mongoScript={item.mongoScript}
      aiAnalysis={item.aiAnalysis}
    />
  );

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.keyboardAvoidingView}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Chat Assistant</Text>
          <View style={styles.headerActions}>
            <TouchableOpacity
              testID="events-button"
              style={styles.eventsButton}
              onPress={loadEventGroups}
            >
              <Text style={styles.eventsButtonText}>Events</Text>
            </TouchableOpacity>
            {onLogout && (
              <TouchableOpacity style={styles.logoutButton} onPress={onLogout}>
                <Text style={styles.logoutButtonText}>Logout</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={item => item.id}
          style={styles.messagesList}
          contentContainerStyle={styles.messagesContent}
          inverted={false}
          testID="message-list"
        />

        {isLoading && (
          <View style={styles.loadingContainer} testID="loading-indicator">
            <Text style={styles.loadingText}>Assistant is typing...</Text>
          </View>
        )}

        {showEventsPanel && (
          <EventGroupsPanel
            groups={eventGroups}
            isLoading={eventsLoading}
            error={eventsError}
            onClose={() => setShowEventsPanel(false)}
            onViewDocs={loadEventDocs}
            onViewRunners={loadRunners}
            onViewPriceUpdates={loadPriceUpdates}
          />
        )}

        {showRunnersPanel && (
          <RunnersPanel
            eventId={runnersEventId}
            eventName={runnersEventName}
            runners={runners}
            isLoading={runnersLoading}
            error={runnersError}
            onClose={() => setShowRunnersPanel(false)}
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
            eventId={selectedEventId}
            eventName={selectedEventName}
            docs={eventDocs}
            isLoading={docsLoading}
            error={docsError}
            onClose={() => setShowDocsPanel(false)}
          />
        )}

        <ChatInput
          onSendMessage={sendMessage}
          isLoading={isLoading}
          queryHistory={queryHistory}
          historyIndex={historyIndex}
          onHistoryChange={setHistoryIndex}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  keyboardAvoidingView: {
    flex: 1,
  },
  header: {
    backgroundColor: "#007AFF",
    paddingVertical: 16,
    paddingHorizontal: 20,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "white",
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  eventsButton: {
    backgroundColor: "#0056b3",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  eventsButtonText: {
    color: "white",
    fontSize: 14,
    fontWeight: "600",
  },
  logoutButton: {
    backgroundColor: "red",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  logoutButtonText: {
    color: "white",
    fontSize: 14,
    fontWeight: "600",
  },
  messagesList: {
    flex: 1,
  },
  messagesContent: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  loadingContainer: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  loadingText: {
    fontSize: 14,
    color: "#666",
    fontStyle: "italic",
  },
});
