import React, { useState } from "react";
import { View, StyleSheet, ScrollView } from "react-native";
import { Text, Button, Portal, Dialog, IconButton } from "react-native-paper";
import Markdown from "react-native-markdown-display";

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
              <Text variant="labelMedium" style={styles.scriptLabel}>
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
            <Button onPress={() => setShowMongoScript(false)}>Close</Button>
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
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 20,
  },
  userBubble: {
    backgroundColor: "#007AFF",
  },
  botBubble: {
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  messageText: {
    fontSize: 16,
    lineHeight: 22,
  },
  userText: {
    color: "white",
  },
  botText: {
    color: "#333",
  },
  timestamp: {
    fontSize: 12,
    color: "#999",
    marginTop: 4,
    alignSelf: "flex-end",
  },
  mongoScriptButton: {
    marginTop: 8,
    alignSelf: "flex-start",
    borderRadius: 8,
  },
  mongoScriptButtonLabel: {
    fontSize: 12,
  },
  dialog: {
    maxHeight: "80%",
  },
  dialogScrollArea: {
    paddingHorizontal: 20,
    maxHeight: 400,
  },
  scriptLabel: {
    color: "#333",
    marginBottom: 6,
    marginTop: 4,
  },
  scriptText: {
    fontSize: 12,
    fontFamily: "monospace",
    backgroundColor: "#f5f5f5",
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e0e0e0",
    color: "#333",
    marginBottom: 16,
  },
  interpretationLabel: {
    color: "#333",
    marginBottom: 6,
  },
  interpretationText: {
    color: "#666",
    lineHeight: 20,
  },
});
