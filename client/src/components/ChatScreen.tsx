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
import { chatApi } from "../services/chatApi";

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
  onNavigateToEvents: () => void;
}

export const ChatScreen: React.FC<ChatScreenProps> = ({
  onLogout,
  onNavigateToEvents,
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
      <Appbar.Header style={styles.appbar}>
        <Appbar.Content title="Chat Assistant" titleStyle={styles.appbarTitle} />
        <Button
          testID="events-button"
          mode="contained-tonal"
          onPress={onNavigateToEvents}
          compact
          style={styles.headerButton}
          labelStyle={styles.headerButtonLabel}
        >
          ← Events
        </Button>
        {onLogout && (
          <Button
            mode="contained"
            onPress={onLogout}
            compact
            buttonColor="#dc3545"
            style={styles.headerButton}
            labelStyle={styles.headerButtonLabel}
          >
            Logout
          </Button>
        )}
      </Appbar.Header>

      <KeyboardAvoidingView
        style={styles.keyboardAvoidingView}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={({ item }) => (
            <Message
              text={item.text}
              isUser={item.isUser}
              timestamp={item.timestamp}
              mongoScript={item.mongoScript}
              aiAnalysis={item.aiAnalysis}
            />
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
    backgroundColor: "#f5f5f5",
  },
  appbar: {
    backgroundColor: "#007AFF",
    elevation: 4,
  },
  appbarTitle: {
    color: "white",
    fontSize: 18,
    fontWeight: "600",
  },
  headerButton: {
    marginHorizontal: 4,
    borderRadius: 8,
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
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  loadingContainer: {
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  loadingText: {
    color: "#666",
    fontStyle: "italic",
  },
});
