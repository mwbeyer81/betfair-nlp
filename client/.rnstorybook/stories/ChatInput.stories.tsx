import React from "react";
import { View } from "react-native";
import { ChatInput } from "../../src/components/ChatInput";
import { expect } from "@storybook/test";
import { within, userEvent } from "@storybook/testing-library";

// Create a simple mock function that works in browser
const mockOnSendMessage = () => {
  const calls: any[] = [];
  const mock = (...args: any[]) => {
    calls.push(args);
    console.log("Mock onSendMessage called with:", args);
  };
  mock.mock = {
    calls,
    toHaveBeenCalledWith: (expectedArgs: any) => {
      return calls.some(
        call => JSON.stringify(call) === JSON.stringify(expectedArgs)
      );
    },
  };
  return mock;
};

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
  onSendMessage: mockOnSendMessage(),
};
Default.play = ({ canvasElement, args }) => {
  const canvas = within(canvasElement);

  // Test that input field is present
  const input = canvas.getByPlaceholderText("Type your message...");
  expect(input).toBeInTheDocument();

  // Test that send button is present
  const sendButton = canvas.getByRole("button", { name: /send/i });
  expect(sendButton).toBeInTheDocument();

  // Verify the component is in the expected initial state
  expect(input).toBeEnabled();
  // Button should be disabled initially (no text input)
  expect(sendButton).toBeDisabled();
};

export const Loading = Template.bind({});
Loading.args = {
  isLoading: true,
  placeholder: "Type your message...",
};
Loading.play = ({ canvasElement, args }) => {
  const canvas = within(canvasElement);

  // Test that input is not editable when loading (React Native Web uses readonly)
  const input = canvas.getByPlaceholderText("Type your message...");
  expect(input).toHaveAttribute("readonly");

  // Test that send button is disabled when loading
  const sendButton = canvas.getByRole("button", { name: /send/i });
  expect(sendButton).toBeDisabled();
};

export const CustomPlaceholder = Template.bind({});
CustomPlaceholder.args = {
  isLoading: false,
  placeholder: "Ask me anything...",
  onSendMessage: mockOnSendMessage(),
};
CustomPlaceholder.play = ({ canvasElement, args }) => {
  const canvas = within(canvasElement);

  // Test custom placeholder text
  const input = canvas.getByPlaceholderText("Ask me anything...");
  expect(input).toBeInTheDocument();

  // Just verify the component is interactive
  expect(input).toBeEnabled();
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

  // React Native Web uses readonly for non-editable inputs
  expect(input).toHaveAttribute("readonly");
  expect(sendButton).toBeDisabled();
};

export const Debug = Template.bind({});
Debug.args = {
  isLoading: false,
  placeholder: "Debug test...",
  onSendMessage: mockOnSendMessage(),
};
Debug.play = ({ canvasElement, args }) => {
  const canvas = within(canvasElement);

  // Simple test - just check if anything renders
  console.log("🔍 Debug story - checking basic rendering...");

  // Look for any div elements
  const divs = canvasElement.querySelectorAll("div");
  console.log(`Found ${divs.length} div elements`);

  // Look for any input/textarea elements
  const inputs = canvasElement.querySelectorAll("input, textarea");
  console.log(`Found ${inputs.length} input/textarea elements`);

  // Look for any button elements
  const buttons = canvasElement.querySelectorAll("button");
  console.log(`Found ${buttons.length} button elements`);

  // Look for any elements with testid
  const testIdElements = canvasElement.querySelectorAll("[data-testid]");
  console.log(`Found ${testIdElements.length} elements with data-testid`);

  testIdElements.forEach((el, i) => {
    const testId = el.getAttribute("data-testid");
    console.log(`  ${i}: ${el.tagName}[data-testid="${testId}"]`);
  });
};

export const EnterKeySubmit = Template.bind({});
EnterKeySubmit.args = {
  isLoading: false,
  placeholder: "Type and press Enter...",
  onSendMessage: mockOnSendMessage(),
};
EnterKeySubmit.play = async ({ canvasElement, args }) => {
  const canvas = within(canvasElement);

  // Test that input field is present
  const input = canvas.getByPlaceholderText("Type and press Enter...");
  expect(input).toBeInTheDocument();

  // Test that send button is present
  const sendButton = canvas.getByRole("button", { name: /send/i });
  expect(sendButton).toBeInTheDocument();

  // Verify the component is in the expected initial state
  expect(input).toBeEnabled();
  expect(sendButton).toBeDisabled();

  // Test that the input supports Enter key submission
  // Note: In Storybook test environment, we can't easily simulate keyboard events
  // but we can verify the input has the necessary props for Enter key handling
  expect(input).toHaveAttribute("data-testid", "message-input");

  // Test typing and Enter key submission
  await userEvent.type(input, "Hello from Enter key test!");
  expect(input).toHaveValue("Hello from Enter key test!");

  // Verify send button is now enabled
  expect(sendButton).toBeEnabled();

  // Simulate pressing Enter key
  await userEvent.keyboard("{Enter}");

  // Verify the message was sent - check that the mock was called
  expect(args.onSendMessage.mock.calls.length).toBeGreaterThan(0);

  // Verify input is cleared after submission
  expect(input).toHaveValue("");

  // Verify send button is disabled again
  expect(sendButton).toBeDisabled();
};
