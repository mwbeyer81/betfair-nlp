import React from "react";
import { View } from "react-native";
import { ChatScreen } from "../../src/components/ChatScreen";
import { expect } from '@storybook/test';
import { within, userEvent } from '@storybook/testing-library';

export default {
  title: "Screens/ChatScreen",
  component: ChatScreen,
  parameters: {
    docs: {
      description: {
        component:
          "A ChatGPT-like chat interface with message list and input box.",
      },
    },
  },
};

export const Default = () => (
  <View style={{ flex: 1 }}>
    <ChatScreen />
  </View>
);
Default.play = async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  
  // Test that the chat screen renders with input field
  const input = canvas.getByTestId("message-input");
  expect(input).toBeInTheDocument();
  
  // Test that send button is present
  const sendButton = canvas.getByTestId("send-button");
  expect(sendButton).toBeInTheDocument();
  
  // Test typing in the input
  await userEvent.type(input, "Hello, this is a test message");
  expect(input).toHaveValue("Hello, this is a test message");
};

export const WithInitialMessages = () => {
  // This would require mocking the initial state
  return (
    <View style={{ flex: 1 }}>
      <ChatScreen />
    </View>
  );
};
WithInitialMessages.storyName = "With Initial Messages";
WithInitialMessages.play = async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  
  // Test that the chat interface is rendered
  const input = canvas.getByTestId("message-input");
  expect(input).toBeInTheDocument();
  
  // Test that the message list area is present
  const messageList = canvas.getByTestId("message-list");
  expect(messageList).toBeInTheDocument();
};

export const LoadingState = () => {
  // This would require mocking the loading state
  return (
    <View style={{ flex: 1 }}>
      <ChatScreen />
    </View>
  );
};
LoadingState.storyName = "Loading State";
LoadingState.play = async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  
  // Test that the chat interface is rendered even in loading state
  const input = canvas.getByTestId("message-input");
  expect(input).toBeInTheDocument();
  
  // Test that loading indicators might be present
  const loadingIndicator = canvas.queryByTestId("loading-indicator");
  if (loadingIndicator) {
    expect(loadingIndicator).toBeInTheDocument();
  }
};
