import React, { useState } from "react";
import { View, StyleSheet } from "react-native";
import { TextInput, IconButton } from "react-native-paper";

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

    if (key === "Enter" && !event.nativeEvent.shiftKey) {
      event.preventDefault();
      handleSend();
    }

    if (key === "ArrowUp") {
      event.preventDefault();
      if (queryHistory.length > 0 && historyIndex < queryHistory.length - 1) {
        const newIndex = historyIndex + 1;
        onHistoryChange?.(newIndex);
        setInputText(queryHistory[queryHistory.length - 1 - newIndex]);
      }
    } else if (key === "ArrowDown") {
      event.preventDefault();
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        onHistoryChange?.(newIndex);
        setInputText(queryHistory[queryHistory.length - 1 - newIndex]);
      } else if (historyIndex === 0) {
        onHistoryChange?.(-1);
        setInputText("");
      }
    }
  };

  const canSend = !!inputText.trim() && !isLoading;

  return (
    <View testID="chat-input" style={styles.container}>
      <TextInput
        testID="message-input"
        mode="outlined"
        value={inputText}
        onChangeText={setInputText}
        placeholder={placeholder}
        multiline
        maxLength={1000}
        editable={!isLoading}
        onSubmitEditing={handleSend}
        onKeyPress={handleKeyPress}
        blurOnSubmit={false}
        style={styles.textInput}
        outlineStyle={styles.inputOutline}
        dense
      />
      <IconButton
        testID="send-button"
        icon="send"
        mode="contained"
        onPress={handleSend}
        disabled={!canSend}
        accessibilityLabel="Send message"
        accessibilityHint="Sends the current message"
        style={styles.sendButton}
        size={22}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "white",
    borderTopWidth: 1,
    borderTopColor: "#e0e0e0",
    gap: 4,
  },
  textInput: {
    flex: 1,
    maxHeight: 100,
    backgroundColor: "white",
    fontSize: 16,
  },
  inputOutline: {
    borderRadius: 20,
  },
  sendButton: {
    borderRadius: 20,
    margin: 0,
  },
});
