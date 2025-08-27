import React from "react";
import { View } from "react-native";
import { ChatInput } from "../../src/components/ChatInput";
import { expect } from '@storybook/test';
import { within, userEvent } from '@storybook/testing-library';
import { testLogger } from '../utils/testLogger';
import { loggedUserEvent, loggedWithin, loggedExpect, runLoggedTest } from '../utils/testHelpers';

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

const Template = args => (
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
Default.play = async ({ canvasElement, args }) => {
  await runLoggedTest('Components/ChatInput', 'Default', canvasElement, args, async (context) => {
    const canvas = loggedWithin(canvasElement, context);
    
    // Test typing in the input
    const input = canvas.getByPlaceholderText("Type your message...");
    await loggedUserEvent.type(input, "Hello, this is a test message", context);
    
    // Verify the input has the typed text
    loggedExpect(input, context).toHaveValue("Hello, this is a test message");
    
    // Test sending the message
    const sendButton = canvas.getByRole("button", { name: /send/i });
    await loggedUserEvent.click(sendButton, context);
    
    // Verify the onSendMessage callback was called
    loggedExpect(args.onSendMessage, context).toHaveBeenCalledWith("Hello, this is a test message");
    
    testLogger.stateChange(context.storyName, context.testName, 'ChatInput', 'message sent', {
      message: "Hello, this is a test message"
    });
  });
};

export const Loading = Template.bind({});
Loading.args = {
  isLoading: true,
  placeholder: "Type your message...",
};
Loading.play = async ({ canvasElement, args }) => {
  await runLoggedTest('Components/ChatInput', 'Loading', canvasElement, args, async (context) => {
    const canvas = loggedWithin(canvasElement, context);
    
    // Test that input is disabled when loading
    const input = canvas.getByPlaceholderText("Type your message...");
    loggedExpect(input, context).toBeDisabled();
    
    // Test that send button is disabled when loading
    const sendButton = canvas.getByRole("button", { name: /send/i });
    loggedExpect(sendButton, context).toBeDisabled();
    
    testLogger.stateChange(context.storyName, context.testName, 'ChatInput', 'loading state', {
      isLoading: true
    });
  });
};

export const CustomPlaceholder = Template.bind({});
CustomPlaceholder.args = {
  isLoading: false,
  placeholder: "Ask me anything...",
};
CustomPlaceholder.play = async ({ canvasElement, args }) => {
  await runLoggedTest('Components/ChatInput', 'CustomPlaceholder', canvasElement, args, async (context) => {
    const canvas = loggedWithin(canvasElement, context);
    
    // Test custom placeholder text
    const input = canvas.getByPlaceholderText("Ask me anything...");
    loggedExpect(input, context).toBeInTheDocument();
    
    // Test typing and sending with custom placeholder
    await loggedUserEvent.type(input, "What's the weather like?", context);
    const sendButton = canvas.getByRole("button", { name: /send/i });
    await loggedUserEvent.click(sendButton, context);
    
    loggedExpect(args.onSendMessage, context).toHaveBeenCalledWith("What's the weather like?");
    
    testLogger.stateChange(context.storyName, context.testName, 'ChatInput', 'message sent with custom placeholder', {
      message: "What's the weather like?",
      placeholder: "Ask me anything..."
    });
  });
};

export const Disabled = Template.bind({});
Disabled.args = {
  isLoading: true,
  placeholder: "Type your message...",
};
Disabled.play = async ({ canvasElement, args }) => {
  await runLoggedTest('Components/ChatInput', 'Disabled', canvasElement, args, async (context) => {
    const canvas = loggedWithin(canvasElement, context);
    
    // Test that component is fully disabled
    const input = canvas.getByPlaceholderText("Type your message...");
    const sendButton = canvas.getByRole("button", { name: /send/i });
    
    loggedExpect(input, context).toBeDisabled();
    loggedExpect(sendButton, context).toBeDisabled();
    
    // Test that clicking send button doesn't trigger action when disabled
    await loggedUserEvent.click(sendButton, context);
    // The button should be unclickable when disabled
    
    testLogger.stateChange(context.storyName, context.testName, 'ChatInput', 'disabled state', {
      isLoading: true,
      inputDisabled: true,
      buttonDisabled: true
    });
  });
};
