import React, { useState } from "react";
import { View, StyleSheet, ScrollView } from "react-native";
import { Text, Button, Portal, Dialog } from "react-native-paper";
import Markdown from "react-native-markdown-display";
import { colors, radii, spacing } from "../theme";

export interface MessageProps {
  text: string;
  isUser: boolean;
  timestamp: Date;
  mongoScript?: string;
  aiAnalysis?: any;
}

export const Message: React.FC<MessageProps> = ({
  text,
  isUser,
  timestamp,
  mongoScript,
  aiAnalysis,
}) => {
  const [showMongoScript, setShowMongoScript] = useState(false);

  return (
    <>
      <View
        testID="message-bubble"
        style={[
          styles.messageContainer,
          isUser ? styles.userMessage : styles.botMessage,
        ]}
      >
        <View
          style={[
            styles.messageBubble,
            isUser ? styles.userBubble : styles.botBubble,
          ]}
        >
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

          {!isUser && mongoScript && (
            <Button
              testID="message-mongo-script-button"
              mode="contained-tonal"
              compact
              onPress={() => setShowMongoScript(true)}
              style={styles.mongoScriptButton}
              labelStyle={styles.mongoScriptButtonLabel}
            >
              View MongoDB Script
            </Button>
          )}

          <Text style={styles.timestamp}>
            {timestamp.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </Text>
        </View>
      </View>

      <Portal>
        <Dialog
          visible={showMongoScript}
          onDismiss={() => setShowMongoScript(false)}
          style={styles.dialog}
        >
          <Dialog.Title>MongoDB JavaScript Script</Dialog.Title>
          <Dialog.ScrollArea style={styles.dialogScrollArea}>
            <ScrollView>
              <Text
                testID="message-mongo-dialog"
                variant="labelMedium"
                style={styles.scriptLabel}
              >
                Generated Script:
              </Text>
              <Text style={styles.scriptText}>{mongoScript}</Text>
              {aiAnalysis?.naturalLanguageInterpretation && (
                <>
                  <Text variant="labelMedium" style={styles.interpretationLabel}>
                    AI Interpretation:
                  </Text>
                  <Text variant="bodySmall" style={styles.interpretationText}>
                    {aiAnalysis.naturalLanguageInterpretation}
                  </Text>
                </>
              )}
            </ScrollView>
          </Dialog.ScrollArea>
          <Dialog.Actions>
            <Button testID="message-mongo-dialog-close" onPress={() => setShowMongoScript(false)}>
              Close
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </>
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
  mongoScriptButton: {
    marginTop: spacing.sm,
    alignSelf: "flex-start",
    borderRadius: radii.md,
  },
  mongoScriptButtonLabel: {
    fontSize: 12,
  },
  dialog: {
    maxHeight: "80%",
    borderRadius: radii.lg,
  },
  dialogScrollArea: {
    paddingHorizontal: spacing.xl,
    maxHeight: 400,
  },
  scriptLabel: {
    color: colors.text,
    marginBottom: 6,
    marginTop: 4,
  },
  scriptText: {
    fontSize: 12,
    fontFamily: "monospace",
    backgroundColor: colors.background,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    marginBottom: spacing.lg,
  },
  interpretationLabel: {
    color: colors.text,
    marginBottom: 6,
  },
  interpretationText: {
    color: colors.textSecondary,
    lineHeight: 20,
  },
});
