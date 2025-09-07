import React, { useState } from "react";
import {
  View,
  TextInput,
  TouchableOpacity,
  Text,
  StyleSheet,
} from "react-native";

export interface ChatInputProps {
  onSendMessage: (message: string) => void;
  isLoading?: boolean;
  placeholder?: string;
  queryHistory?: string[];
  historyIndex?: number;
  onHistoryChange?: (index: number) => void;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  onSendMessage,
  isLoading = false,
  placeholder = "Type your message...",
  queryHistory = [],
  historyIndex = -1,
  onHistoryChange,
}) => {
  const [inputText, setInputText] = useState("");

  const handleSend = () => {
    if (!inputText.trim() || isLoading) return;

    onSendMessage(inputText.trim());
    setInputText("");
  };

  const handleKeyPress = (event: any) => {
    const key = event.nativeEvent.key;

    // Handle Enter key
    if (key === "Enter" && !event.nativeEvent.shiftKey) {
      event.preventDefault();
      handleSend();
    }

    // Handle Arrow keys for history navigation
    if (key === "ArrowUp") {
      console.log(
        "🔼 ArrowUp pressed, current historyIndex:",
        historyIndex,
        "queryHistory length:",
        queryHistory.length
      );
      event.preventDefault();
      if (queryHistory.length > 0 && historyIndex < queryHistory.length - 1) {
        const newIndex = historyIndex + 1;
        console.log("✅ Going back in history to index:", newIndex);
        onHistoryChange?.(newIndex);
        setInputText(queryHistory[queryHistory.length - 1 - newIndex]);
      } else {
        console.log("❌ Cannot go further back in history");
      }
    } else if (key === "ArrowDown") {
      console.log("🔽 ArrowDown pressed, current historyIndex:", historyIndex);
      event.preventDefault();
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        console.log("✅ Going forward in history to index:", newIndex);
        onHistoryChange?.(newIndex);
        setInputText(queryHistory[queryHistory.length - 1 - newIndex]);
      } else if (historyIndex === 0) {
        console.log("✅ Back to current input");
        onHistoryChange?.(-1);
        setInputText("");
      } else {
        console.log("❌ Already at current input");
      }
    }
  };

  return (
    <View style={styles.inputContainer} testID="chat-input">
      <TextInput
        style={styles.textInput}
        value={inputText}
        onChangeText={setInputText}
        placeholder={placeholder}
        placeholderTextColor="#999"
        multiline
        maxLength={1000}
        editable={!isLoading}
        testID="message-input"
        onSubmitEditing={handleSend}
        onKeyPress={handleKeyPress}
        blurOnSubmit={false}
      />
      <TouchableOpacity
        style={[
          styles.sendButton,
          (!inputText.trim() || isLoading) && styles.sendButtonDisabled,
        ]}
        onPress={handleSend}
        disabled={!inputText.trim() || isLoading}
        accessible={true}
        accessibilityRole="button"
        accessibilityLabel="Send message"
        accessibilityHint="Sends the current message"
        testID="send-button"
      >
        <Text style={styles.sendButtonText}>Send</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  inputContainer: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "white",
    borderTopWidth: 1,
    borderTopColor: "#e0e0e0",
  },
  textInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#e0e0e0",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    maxHeight: 100,
  },
  sendButton: {
    marginLeft: 8,
    backgroundColor: "#007AFF",
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 12,
    justifyContent: "center",
  },
  sendButtonDisabled: {
    backgroundColor: "#ccc",
  },
  sendButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
  },
});
