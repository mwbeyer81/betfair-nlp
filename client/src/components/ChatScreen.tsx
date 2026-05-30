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
              onPress={onNavigateToEvents}
            >
              <Text style={styles.eventsButtonText}>← Events</Text>
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
            <Text style={styles.loadingText}>Assistant is typing...</Text>
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
