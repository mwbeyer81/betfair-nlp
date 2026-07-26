import React from "react";
import { View, StyleSheet } from "react-native";
import { Text } from "react-native-paper";
import Markdown from "react-native-markdown-display";
import { colors, radii, spacing } from "../theme";

export interface MessageProps {
  text: string;
  isUser: boolean;
  timestamp: Date;
}

export const Message: React.FC<MessageProps> = ({ text, isUser, timestamp }) => {
  return (
    <View
      testID="message-bubble"
      style={[styles.messageContainer, isUser ? styles.userMessage : styles.botMessage]}
    >
      <View style={[styles.messageBubble, isUser ? styles.userBubble : styles.botBubble]}>
        {isUser ? (
          <Text style={[styles.messageText, styles.userText]}>{text}</Text>
        ) : (
          <Markdown
            style={{
              body: StyleSheet.flatten([styles.messageText, styles.botText]),
            }}
          >
            {text}
          </Markdown>
        )}

        <Text style={styles.timestamp}>
          {timestamp.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  messageContainer: {
    marginVertical: 4,
  },
  userMessage: {
    alignItems: "flex-end",
  },
  botMessage: {
    alignItems: "flex-start",
  },
  messageBubble: {
    maxWidth: "80%",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radii.lg,
  },
  userBubble: {
    backgroundColor: colors.primary,
  },
  botBubble: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  messageText: {
    fontSize: 16,
    lineHeight: 22,
  },
  userText: {
    color: "white",
  },
  botText: {
    color: colors.text,
  },
  timestamp: {
    fontSize: 12,
    color: colors.textTertiary,
    marginTop: 4,
    alignSelf: "flex-end",
  },
});
