import type { Meta, StoryObj } from "@storybook/react";
import { ChatInput } from "./ChatInput";
import { useState } from "react";

const meta: Meta<typeof ChatInput> = {
  title: "Components/ChatInput",
  component: ChatInput,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    onSendMessage: { action: "message sent" },
    onHistoryChange: { action: "history changed" },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

// Basic story
export const Default: Story = {
  args: {
    isLoading: false,
    placeholder: "Type your message...",
  },
};

// Loading state
export const Loading: Story = {
  args: {
    isLoading: true,
    placeholder: "Type your message...",
  },
};

// With query history
export const WithQueryHistory: Story = {
  render: args => {
    const [queryHistory, setQueryHistory] = useState([
      "list all races",
      "show runners for race X",
      "price updates for horse Y",
      "second most recent race",
    ]);
    const [historyIndex, setHistoryIndex] = useState(-1);
    const [inputText, setInputText] = useState("");

    const handleSendMessage = (message: string) => {
      console.log("Message sent:", message);
      setInputText("");
    };

    const handleHistoryChange = (index: number) => {
      console.log("History index changed to:", index);
      setHistoryIndex(index);
    };

    return (
      <div style={{ width: "400px", padding: "20px" }}>
        <div
          style={{
            marginBottom: "20px",
            padding: "10px",
            backgroundColor: "#f5f5f5",
            borderRadius: "8px",
          }}
        >
          <h4>Query History (for testing):</h4>
          <ul style={{ margin: "5px 0", paddingLeft: "20px" }}>
            {queryHistory.map((query, index) => (
              <li
                key={index}
                style={{
                  color:
                    index === queryHistory.length - 1 - historyIndex
                      ? "#007AFF"
                      : "#666",
                  fontWeight:
                    index === queryHistory.length - 1 - historyIndex
                      ? "bold"
                      : "normal",
                }}
              >
                {index}: {query}
              </li>
            ))}
          </ul>
          <p>
            <strong>Current History Index:</strong> {historyIndex}
          </p>
          <p>
            <strong>Current Input:</strong> "{inputText}"
          </p>
        </div>

        <ChatInput
          {...args}
          queryHistory={queryHistory}
          historyIndex={historyIndex}
          onHistoryChange={handleHistoryChange}
          onSendMessage={handleSendMessage}
        />

        <div style={{ marginTop: "20px", fontSize: "12px", color: "#666" }}>
          <p>
            <strong>Instructions:</strong>
          </p>
          <p>• Use ↑ arrow to go back in history</p>
          <p>• Use ↓ arrow to go forward in history</p>
          <p>• Check the console for history change events</p>
          <p>
            • <strong>Note:</strong> Arrow keys may not work in Storybook - test
            in actual app
          </p>
        </div>
      </div>
    );
  },
  args: {
    isLoading: false,
    placeholder: "Type your message...",
  },
};

// Interactive test story
export const InteractiveTest: Story = {
  render: args => {
    const [queryHistory, setQueryHistory] = useState([
      "list all races",
      "show runners for race X",
      "price updates for horse Y",
    ]);
    const [historyIndex, setHistoryIndex] = useState(-1);
    const [inputText, setInputText] = useState("");
    const [sentMessages, setSentMessages] = useState<string[]>([]);

    const handleSendMessage = (message: string) => {
      console.log("Message sent:", message);
      setSentMessages(prev => [...prev, message]);
      setInputText("");
      // Add to history
      setQueryHistory(prev => [...prev, message]);
      setHistoryIndex(-1);
    };

    const handleHistoryChange = (index: number) => {
      console.log("History index changed to:", index);
      setHistoryIndex(index);
      if (index >= 0) {
        setInputText(queryHistory[queryHistory.length - 1 - index]);
      } else {
        setInputText("");
      }
    };

    const addTestQuery = () => {
      const newQuery = `Test query ${Date.now()}`;
      setQueryHistory(prev => [...prev, newQuery]);
    };

    const clearHistory = () => {
      setQueryHistory([]);
      setHistoryIndex(-1);
      setInputText("");
    };

    return (
      <div style={{ width: "500px", padding: "20px" }}>
        <div
          style={{
            marginBottom: "20px",
            padding: "10px",
            backgroundColor: "#f5f5f5",
            borderRadius: "8px",
          }}
        >
          <h4>Query History Test Panel:</h4>
          <div style={{ display: "flex", gap: "10px", marginBottom: "10px" }}>
            <button
              onClick={addTestQuery}
              style={{
                padding: "5px 10px",
                backgroundColor: "#007AFF",
                color: "white",
                border: "none",
                borderRadius: "4px",
              }}
            >
              Add Test Query
            </button>
            <button
              onClick={clearHistory}
              style={{
                padding: "5px 10px",
                backgroundColor: "#ff4444",
                color: "white",
                border: "none",
                borderRadius: "4px",
              }}
            >
              Clear History
            </button>
          </div>
          <ul
            style={{
              margin: "5px 0",
              paddingLeft: "20px",
              maxHeight: "100px",
              overflowY: "auto",
            }}
          >
            {queryHistory.map((query, index) => (
              <li
                key={index}
                style={{
                  color:
                    index === queryHistory.length - 1 - historyIndex
                      ? "#007AFF"
                      : "#666",
                  fontWeight:
                    index === queryHistory.length - 1 - historyIndex
                      ? "bold"
                      : "normal",
                  fontSize: "12px",
                }}
              >
                {index}: {query}
              </li>
            ))}
          </ul>
          <p style={{ fontSize: "12px", margin: "5px 0" }}>
            <strong>History Index:</strong> {historyIndex} |
            <strong> History Length:</strong> {queryHistory.length} |
            <strong> Current Input:</strong> "{inputText}"
          </p>
        </div>

        <ChatInput
          {...args}
          queryHistory={queryHistory}
          historyIndex={historyIndex}
          onHistoryChange={handleHistoryChange}
          onSendMessage={handleSendMessage}
        />

        <div
          style={{
            marginTop: "20px",
            padding: "10px",
            backgroundColor: "#f0f8ff",
            borderRadius: "8px",
          }}
        >
          <h5>Sent Messages:</h5>
          <ul
            style={{ margin: "5px 0", paddingLeft: "20px", fontSize: "12px" }}
          >
            {sentMessages.map((msg, index) => (
              <li key={index}>{msg}</li>
            ))}
          </ul>
        </div>

        <div style={{ marginTop: "20px", fontSize: "12px", color: "#666" }}>
          <p>
            <strong>Test Instructions:</strong>
          </p>
          <p>1. Type a message and send it</p>
          <p>2. Press ↑ to cycle through history</p>
          <p>3. Press ↓ to go forward in history</p>
          <p>4. Use "Add Test Query" to add more history</p>
          <p>5. Check console for events</p>
        </div>
      </div>
    );
  },
  args: {
    isLoading: false,
    placeholder: "Type your message...",
  },
};
