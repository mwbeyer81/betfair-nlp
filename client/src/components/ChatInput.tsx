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
}

export const ChatInput: React.FC<ChatInputProps> = ({
  onSendMessage,
  isLoading = false,
  placeholder = "Type your message...",
}) => {
  const [inputText, setInputText] = useState("");

  const handleSend = () => {
    if (!inputText.trim() || isLoading) return;

    onSendMessage(inputText.trim());
    setInputText("");
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
