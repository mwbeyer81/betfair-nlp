import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Modal } from "react-native";

export interface MessageProps {
  text: string;
  isUser: boolean;
  timestamp: Date;
  mongoQuery?: string;
  aiAnalysis?: any;
}

export const Message: React.FC<MessageProps> = ({
  text,
  isUser,
  timestamp,
  mongoQuery,
  aiAnalysis,
}) => {
  const [showMongoQuery, setShowMongoQuery] = useState(false);

  return (
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
        <Text
          style={[
            styles.messageText,
            isUser ? styles.userText : styles.botText,
          ]}
        >
          {text}
        </Text>

        {/* Show MongoDB Query button for bot messages with queries */}
        {!isUser && mongoQuery && (
          <TouchableOpacity
            style={styles.mongoQueryButton}
            onPress={() => setShowMongoQuery(true)}
          >
            <Text style={styles.mongoQueryButtonText}>View MongoDB Query</Text>
          </TouchableOpacity>
        )}

        <Text style={styles.timestamp}>
          {timestamp.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </Text>
      </View>

      {/* MongoDB Query Modal */}
      <Modal
        visible={showMongoQuery}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowMongoQuery(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>MongoDB Query</Text>
              <TouchableOpacity
                style={styles.closeButton}
                onPress={() => setShowMongoQuery(false)}
              >
                <Text style={styles.closeButtonText}>✕</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.queryContainer}>
              <Text style={styles.queryLabel}>Generated Query:</Text>
              <Text style={styles.queryText}>{mongoQuery}</Text>
            </View>

            {aiAnalysis?.naturalLanguageInterpretation && (
              <View style={styles.interpretationContainer}>
                <Text style={styles.interpretationLabel}>
                  AI Interpretation:
                </Text>
                <Text style={styles.interpretationText}>
                  {aiAnalysis.naturalLanguageInterpretation}
                </Text>
              </View>
            )}
          </View>
        </View>
      </Modal>
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
  mongoQueryButton: {
    backgroundColor: "#007AFF",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginTop: 8,
    alignSelf: "flex-start",
  },
  mongoQueryButtonText: {
    color: "white",
    fontSize: 12,
    fontWeight: "600",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    backgroundColor: "white",
    borderRadius: 12,
    padding: 20,
    margin: 20,
    maxWidth: "90%",
    maxHeight: "80%",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
    paddingBottom: 12,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
  },
  closeButton: {
    padding: 8,
  },
  closeButtonText: {
    fontSize: 18,
    color: "#666",
    fontWeight: "600",
  },
  queryContainer: {
    marginBottom: 16,
  },
  queryLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
    marginBottom: 8,
  },
  queryText: {
    fontSize: 12,
    fontFamily: "monospace",
    backgroundColor: "#f5f5f5",
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e0e0e0",
    color: "#333",
  },
  interpretationContainer: {
    marginBottom: 16,
  },
  interpretationLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
    marginBottom: 8,
  },
  interpretationText: {
    fontSize: 14,
    color: "#666",
    lineHeight: 20,
  },
});
