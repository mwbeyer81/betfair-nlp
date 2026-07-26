import React, { useState, useRef, useEffect } from "react";
import {
  View,
  FlatList,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
} from "react-native";
import { Appbar, Text, Button } from "react-native-paper";
import { Message } from "./Message";
import { ChatInput } from "./ChatInput";
import { HeaderActionsContainer } from "./HeaderActionsContainer";
import { useHeaderMenu } from "../utils/useHeaderMenu";
import { chatApi } from "../services/chatApi";
import { colors, radii, spacing } from "../theme";

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
  onLogout?: () => void;
  onNavigateToEvents: () => void;
}

export const ChatScreen: React.FC<ChatScreenProps> = ({
  onLogout,
  onNavigateToEvents,
}) => {
  const { isTablet, open: menuOpen, setOpen: setMenuOpen, wrap } = useHeaderMenu();
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
      <View style={styles.headerWrapper}>
        <Appbar.Header style={styles.appbar}>
          <Appbar.Content title="Chat Assistant" titleStyle={styles.appbarTitle} />
          {!isTablet && (
            <Appbar.Action
              testID="chat-menu-button"
              icon="menu"
              color="white"
              onPress={() => setMenuOpen(v => !v)}
            />
          )}
        </Appbar.Header>
        <HeaderActionsContainer
          isTablet={isTablet}
          open={menuOpen}
          inlineTestId="chat-header-actions"
          menuTestId="chat-nav-menu"
        >
          <Button
            testID="events-button"
            mode="contained-tonal"
            onPress={wrap(onNavigateToEvents)}
            compact
            style={styles.headerButton}
            labelStyle={styles.headerButtonLabel}
          >
            ← Events
          </Button>
          {onLogout && (
            <Button
              testID="chat-logout-button"
              mode="contained"
              onPress={wrap(onLogout)}
              compact
              buttonColor={colors.danger}
              style={styles.headerButton}
              labelStyle={styles.headerButtonLabel}
            >
              Logout
            </Button>
          )}
        </HeaderActionsContainer>
      </View>

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
  headerWrapper: {
    position: "relative",
    zIndex: 10,
  },
  appbar: {
    backgroundColor: colors.primary,
    elevation: 4,
  },
  appbarTitle: {
    color: "white",
    fontSize: 18,
    fontWeight: "600",
  },
  headerButton: {
    marginHorizontal: 4,
    borderRadius: radii.md,
  },
  headerButtonLabel: {
    fontSize: 13,
    fontWeight: "600",
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
