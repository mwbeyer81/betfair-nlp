import React, { useState } from "react";
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
}

export const ChatScreen: React.FC<ChatScreenProps> = ({ onLogout }) => {
  const [messages, setMessages] = useState<MessageData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [queryHistory, setQueryHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

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
          {onLogout && (
            <TouchableOpacity style={styles.logoutButton} onPress={onLogout}>
              <Text style={styles.logoutButtonText}>Logout</Text>
            </TouchableOpacity>
          )}
        </View>

        <FlatList
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
