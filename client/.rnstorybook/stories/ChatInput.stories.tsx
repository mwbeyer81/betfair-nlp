import React from "react";
import { View } from "react-native";
import { ChatInput } from "../../src/components/ChatInput";
import { expect } from "@storybook/test";
import { within, userEvent } from "@storybook/testing-library";

export default {
  title: "Components/ChatInput",
  component: ChatInput,
  parameters: {
    docs: {
      description: {
        component: "A chat input component with text input and send button.",
      },
    },
  },
  argTypes: {
    onSendMessage: {
      action: "message sent",
      description: "Callback function called when a message is sent",
    },
    isLoading: {
      control: { type: "boolean" },
      description: "Whether the input is in loading state (disabled)",
    },
    placeholder: {
      control: { type: "text" },
      description: "Placeholder text for the input field",
    },
  },
};

const Template = (args: any) => (
  <View
    style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "#f5f5f5" }}
  >
    <ChatInput {...args} />
  </View>
);

export const Default = Template.bind({});
Default.args = {
  isLoading: false,
  placeholder: "Type your message...",
};
Default.play = ({ canvasElement, args }) => {
  const canvas = within(canvasElement);

  // Test that input field is present
  const input = canvas.getByPlaceholderText("Type your message...");
  expect(input).toBeInTheDocument();

  // Test that send button is present
  const sendButton = canvas.getByRole("button", { name: /send/i });
  expect(sendButton).toBeInTheDocument();

  // Test typing in the input (simplified without await)
  userEvent.type(input, "Hello, this is a test message");

  // Test sending the message (simplified without await)
  userEvent.click(sendButton);

  // Verify the onSendMessage callback was called
  expect(args.onSendMessage).toHaveBeenCalledWith(
    "Hello, this is a test message"
  );
};

export const Loading = Template.bind({});
Loading.args = {
  isLoading: true,
  placeholder: "Type your message...",
};
Loading.play = ({ canvasElement, args }) => {
  const canvas = within(canvasElement);

  // Test that input is disabled when loading
  const input = canvas.getByPlaceholderText("Type your message...");
  expect(input).toBeDisabled();

  // Test that send button is disabled when loading
  const sendButton = canvas.getByRole("button", { name: /send/i });
  expect(sendButton).toBeDisabled();
};

export const CustomPlaceholder = Template.bind({});
CustomPlaceholder.args = {
  isLoading: false,
  placeholder: "Ask me anything...",
};
CustomPlaceholder.play = ({ canvasElement, args }) => {
  const canvas = within(canvasElement);

  // Test custom placeholder text
  const input = canvas.getByPlaceholderText("Ask me anything...");
  expect(input).toBeInTheDocument();

  // Test typing and sending with custom placeholder
  userEvent.type(input, "What's the weather like?");
  const sendButton = canvas.getByRole("button", { name: /send/i });
  userEvent.click(sendButton);

  expect(args.onSendMessage).toHaveBeenCalledWith("What's the weather like?");
};

export const Disabled = Template.bind({});
Disabled.args = {
  isLoading: true,
  placeholder: "Type your message...",
};
Disabled.play = ({ canvasElement, args }) => {
  const canvas = within(canvasElement);

  // Test that component is fully disabled
  const input = canvas.getByPlaceholderText("Type your message...");
  const sendButton = canvas.getByRole("button", { name: /send/i });

  expect(input).toBeDisabled();
  expect(sendButton).toBeDisabled();
};
