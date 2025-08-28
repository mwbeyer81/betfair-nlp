import React from "react";
import { View, Text, TouchableOpacity, TextInput } from "react-native";
import { expect } from "@storybook/test";
import { fn } from "storybook/test";
import { testLogger } from "../utils/testLogger";
import {
  loggedUserEvent,
  loggedWithin,
  loggedExpect,
  runLoggedTest,
} from "../utils/testHelpers";

// Create proper mock functions
const mockOnButtonPress = fn();
const mockOnInputChange = fn();

// Simple test component
const TestComponent = ({
  onButtonPress,
  onInputChange,
  placeholder = "Enter text...",
}) => {
  const [text, setText] = React.useState("");

  const handleInputChange = (value: string) => {
    setText(value);
    onInputChange?.(value);
  };

  const handleButtonPress = () => {
    onButtonPress?.(text);
  };

  const handleKeyPress = (event: any) => {
    // Check if Enter was pressed without Shift (Shift+Enter for new line)
    if (event.nativeEvent.key === 'Enter' && !event.nativeEvent.shiftKey) {
      event.preventDefault();
      handleButtonPress();
    }
  };

  return (
    <View style={{ padding: 20, gap: 10 }}>
      <Text style={{ fontSize: 18, fontWeight: "bold" }}>Test Component</Text>
      <TextInput
        placeholder={placeholder}
        value={text}
        onChangeText={handleInputChange}
        style={{
          borderWidth: 1,
          borderColor: "#ccc",
          padding: 10,
          borderRadius: 5,
        }}
        onSubmitEditing={handleButtonPress}
        onKeyPress={handleKeyPress}
        blurOnSubmit={false}
      />
      <TouchableOpacity
        onPress={handleButtonPress}
        style={{
          backgroundColor: "#007AFF",
          padding: 10,
          borderRadius: 5,
          alignItems: "center",
        }}
        accessible={true}
        accessibilityRole="button"
        accessibilityLabel="Submit"
        testID="submit-button"
      >
        <Text style={{ color: "white", fontWeight: "bold" }}>Submit</Text>
      </TouchableOpacity>
    </View>
  );
};

export default {
  title: "Examples/LoggingExample",
  component: TestComponent,
  parameters: {
    docs: {
      description: {
        component:
          "This example demonstrates comprehensive logging in interaction tests.",
      },
    },
  },
  argTypes: {
    onButtonPress: { description: "Callback when button is pressed" },
    onInputChange: { description: "Callback when input changes" },
    placeholder: { control: "text" },
  },
};

const Template = args => <TestComponent {...args} />;

export const BasicInteraction = Template.bind({});
BasicInteraction.args = {
  placeholder: "Type something...",
  onButtonPress: mockOnButtonPress,
  onInputChange: mockOnInputChange,
};
BasicInteraction.play = async ({ canvasElement, args }) => {
  await runLoggedTest(
    "Examples/LoggingExample",
    "BasicInteraction",
    canvasElement,
    args,
    async context => {
      const canvas = loggedWithin(canvasElement, context);

      // Log test setup
      testLogger.info(
        context.storyName,
        context.testName,
        "Setting up basic interaction test"
      );

      // Find and interact with input
      const input = canvas.getByPlaceholderText("Type something...");
      loggedExpect(input, context).toBeInTheDocument();

      // Type in the input
      await loggedUserEvent.type(input, "Hello World!", context);
      loggedExpect(input, context).toHaveValue("Hello World!");

      // Find and click button - use more flexible selector
      const button =
        canvas.getByRole("button", { name: /submit/i }) ||
        canvas.getByTestId("submit-button");
      loggedExpect(button, context).toBeInTheDocument();

      await loggedUserEvent.click(button, context);
      loggedExpect(args.onButtonPress, context).toHaveBeenCalledWith(
        "Hello World!"
      );

      // Log state changes
      testLogger.stateChange(
        context.storyName,
        context.testName,
        "TestComponent",
        "input filled and submitted",
        {
          inputValue: "Hello World!",
          buttonClicked: true,
        }
      );
    }
  );
};

export const ComplexInteraction = Template.bind({});
ComplexInteraction.args = {
  placeholder: "Enter your message...",
  onButtonPress: mockOnButtonPress,
  onInputChange: mockOnInputChange,
};
ComplexInteraction.play = async ({ canvasElement, args }) => {
  await runLoggedTest(
    "Examples/LoggingExample",
    "ComplexInteraction",
    canvasElement,
    args,
    async context => {
      const canvas = loggedWithin(canvasElement, context);

      testLogger.info(
        context.storyName,
        context.testName,
        "Starting complex interaction test"
      );

      // Multiple input interactions
      const input = canvas.getByPlaceholderText("Enter your message...");

      // Test partial typing
      await loggedUserEvent.type(input, "First", context);
      testLogger.info(
        context.storyName,
        context.testName,
        "Typed first part of message"
      );

      // Test clearing and retyping
      await loggedUserEvent.type(input, "Second", context);
      testLogger.info(
        context.storyName,
        context.testName,
        "Typed second part of message"
      );

      // Verify final state
      loggedExpect(input, context).toHaveValue("FirstSecond");

      // Test button interaction
      const button =
        canvas.getByRole("button", { name: /submit/i }) ||
        canvas.getByTestId("submit-button");
      await loggedUserEvent.click(button, context);

      // Verify callbacks
      loggedExpect(args.onInputChange, context).toHaveBeenCalled();
      loggedExpect(args.onButtonPress, context).toHaveBeenCalledWith(
        "FirstSecond"
      );

      // Log comprehensive state
      testLogger.stateChange(
        context.storyName,
        context.testName,
        "TestComponent",
        "complex interaction completed",
        {
          finalInputValue: "FirstSecond",
          inputChangeCalls: args.onInputChange.mock?.calls?.length || 0,
          buttonPressCalls: args.onButtonPress.mock?.calls?.length || 0,
        }
      );
    }
  );
};

export const ErrorHandling = Template.bind({});
ErrorHandling.args = {
  placeholder: "Test error scenarios...",
  onButtonPress: mockOnButtonPress,
  onInputChange: mockOnInputChange,
};
ErrorHandling.play = async ({ canvasElement, args }) => {
  await runLoggedTest(
    "Examples/LoggingExample",
    "ErrorHandling",
    canvasElement,
    args,
    async context => {
      const canvas = loggedWithin(canvasElement, context);

      testLogger.info(
        context.storyName,
        context.testName,
        "Testing error handling scenarios"
      );

      // Test with empty input
      const input = canvas.getByPlaceholderText("Test error scenarios...");
      const button =
        canvas.getByRole("button", { name: /submit/i }) ||
        canvas.getByTestId("submit-button");

      // Submit empty form
      await loggedUserEvent.click(button, context);
      loggedExpect(args.onButtonPress, context).toHaveBeenCalledWith("");

      // Test with special characters
      await loggedUserEvent.type(input, "Special chars: !@#$%^&*()", context);
      loggedExpect(input, context).toHaveValue("Special chars: !@#$%^&*()");

      await loggedUserEvent.click(button, context);
      loggedExpect(args.onButtonPress, context).toHaveBeenCalledWith(
        "Special chars: !@#$%^&*()"
      );

      testLogger.success(
        context.storyName,
        context.testName,
        "Error handling test completed successfully"
      );
    }
  );
};
