import React from "react";
import { View } from "react-native";
import { Message } from "../../src/components/Message";
import { expect } from '@storybook/test';
import { within } from '@storybook/testing-library';

export default {
  title: "Components/Message",
  component: Message,
  parameters: {
    docs: {
      description: {
        component:
          "A single chat message component that displays user or bot messages.",
      },
    },
  },
  argTypes: {
    text: {
      control: { type: "text" },
      description: "The message text content",
    },
    isUser: {
      control: { type: "boolean" },
      description:
        "Whether this is a user message (true) or bot message (false)",
    },
    timestamp: {
      control: { type: "date" },
      description: "The timestamp of the message",
    },
  },
};

const Template = args => (
  <View style={{ flex: 1, padding: 16, backgroundColor: "#f5f5f5" }}>
    <Message {...args} />
  </View>
);

export const UserMessage = Template.bind({});
UserMessage.args = {
  text: "Hello! How are you today?",
  isUser: true,
  timestamp: new Date(),
};
UserMessage.play = async ({ canvasElement, args }) => {
  const canvas = within(canvasElement);
  
  // Test that user message text is displayed
  const messageText = canvas.getByText("Hello! How are you today?");
  expect(messageText).toBeInTheDocument();
  
  // Test that user message has correct styling/class
  const messageContainer = messageText.closest('[data-testid="message"]') || messageText.parentElement;
  expect(messageContainer).toHaveClass('user-message');
};

export const BotMessage = Template.bind({});
BotMessage.args = {
  text: "Hi there! I'm doing well, thank you for asking. How can I help you today?",
  isUser: false,
  timestamp: new Date(),
};
BotMessage.play = async ({ canvasElement, args }) => {
  const canvas = within(canvasElement);
  
  // Test that bot message text is displayed
  const messageText = canvas.getByText("Hi there! I'm doing well, thank you for asking. How can I help you today?");
  expect(messageText).toBeInTheDocument();
  
  // Test that bot message has correct styling/class
  const messageContainer = messageText.closest('[data-testid="message"]') || messageText.parentElement;
  expect(messageContainer).toHaveClass('bot-message');
};

export const LongMessage = Template.bind({});
LongMessage.args = {
  text: "This is a very long message that should wrap to multiple lines to test how the component handles longer text content. It should still look good and be readable.",
  isUser: false,
  timestamp: new Date(),
};
LongMessage.play = async ({ canvasElement, args }) => {
  const canvas = within(canvasElement);
  
  // Test that long message text is displayed
  const messageText = canvas.getByText("This is a very long message that should wrap to multiple lines to test how the component handles longer text content. It should still look good and be readable.");
  expect(messageText).toBeInTheDocument();
  
  // Test that the message container handles long text properly
  const messageContainer = messageText.closest('[data-testid="message"]') || messageText.parentElement;
  expect(messageContainer).toBeInTheDocument();
};

export const ShortMessage = Template.bind({});
ShortMessage.args = {
  text: "OK",
  isUser: true,
  timestamp: new Date(),
};
ShortMessage.play = async ({ canvasElement, args }) => {
  const canvas = within(canvasElement);
  
  // Test that short message text is displayed
  const messageText = canvas.getByText("OK");
  expect(messageText).toBeInTheDocument();
  
  // Test that short message renders correctly
  const messageContainer = messageText.closest('[data-testid="message"]') || messageText.parentElement;
  expect(messageContainer).toBeInTheDocument();
};

export const WithSpecialCharacters = Template.bind({});
WithSpecialCharacters.args = {
  text: "Message with special chars: @#$%^&*()_+-=[]{}|;:,.<>?",
  isUser: false,
  timestamp: new Date(),
};
WithSpecialCharacters.play = async ({ canvasElement, args }) => {
  const canvas = within(canvasElement);
  
  // Test that message with special characters is displayed correctly
  const messageText = canvas.getByText("Message with special chars: @#$%^&*()_+-=[]{}|;:,.<>?");
  expect(messageText).toBeInTheDocument();
  
  // Test that special characters are rendered properly
  expect(messageText.textContent).toContain("@#$%^&*()_+-=[]{}|;:,.<>?");
};
