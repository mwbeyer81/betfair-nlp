import React, { useState, useRef, useEffect } from "react";
import {
  View,
  FlatList,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
} from "react-native";
import { Text } from "react-native-paper";
import { Message } from "./Message";
import { ChatInput } from "./ChatInput";
import { AppHeader } from "./AppHeader";
import { chatApi } from "../services/chatApi";
import { colors, spacing } from "../theme";
import type { Route } from "../hooks/useRouter";

interface MessageData {
  id: string;
  text: string;
  isUser: boolean;
  timestamp: Date;
}

// Matches the server's own cap (src/server/router.ts's MAX_HISTORY_TURNS) —
// capping client-side too keeps the request small, the server enforces its
// own cap regardless so this is a courtesy, not the security boundary.
const MAX_HISTORY_TURNS = 20;

interface ChatScreenProps {
  navigate: (to: Route, query?: string) => void;
  isAuthenticated: boolean;
  onLogout?: () => void;
}

export const ChatScreen: React.FC<ChatScreenProps> = ({
  navigate,
  isAuthenticated,
  onLogout,
}) => {
  const [messages, setMessages] = useState<MessageData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [queryHistory, setQueryHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages]);

  const sendMessage = async (messageText: string) => {
    setQueryHistory(prev => [...prev, messageText]);
    setHistoryIndex(-1);

    // Built from messages as they stand BEFORE this turn — the new user
    // message is sent separately as the query itself, not duplicated here.
    const history = messages.slice(-MAX_HISTORY_TURNS).map(m => ({
      role: m.isUser ? ("user" as const) : ("assistant" as const),
      text: m.text,
    }));

    const userMessage: MessageData = {
      id: Date.now().toString(),
      text: messageText,
      isUser: true,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);

    try {
      const response = await chatApi.sendMessage(messageText, history);
      const botMessage: MessageData = {
        id: (Date.now() + 1).toString(),
        text: response.reply,
        isUser: false,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, botMessage]);
    } catch {
      setMessages(prev => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          text: "Sorry, I encountered an error. Please try again.",
          isUser: false,
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView testID="chat-screen" style={styles.container}>
      <AppHeader
        navigate={navigate}
        isAuthenticated={isAuthenticated}
        onLogout={onLogout}
        subtitle="Chat Assistant"
        testIdPrefix="chat"
      />

      <KeyboardAvoidingView
        style={styles.keyboardAvoidingView}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={({ item }) => (
            <Message text={item.text} isUser={item.isUser} timestamp={item.timestamp} />
          )}
          keyExtractor={item => item.id}
          style={styles.messagesList}
          contentContainerStyle={styles.messagesContent}
          testID="message-list"
        />

        {isLoading && (
          <View style={styles.loadingContainer} testID="loading-indicator">
            <Text variant="bodySmall" style={styles.loadingText}>
              Assistant is typing…
            </Text>
          </View>
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
    backgroundColor: colors.background,
  },
  keyboardAvoidingView: {
    flex: 1,
  },
  messagesList: {
    flex: 1,
  },
  messagesContent: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  loadingContainer: {
    paddingHorizontal: spacing.lg,
    paddingVertical: 6,
  },
  loadingText: {
    color: colors.textSecondary,
    fontStyle: "italic",
  },
});
