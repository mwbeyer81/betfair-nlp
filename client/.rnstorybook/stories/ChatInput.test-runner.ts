import { within, expect } from "@storybook/test";
import { composeStories } from "@storybook/react";
import * as ChatInputStories from "./ChatInput.stories";

const { Default, Loading, CustomPlaceholder, Disabled, Debug } =
  composeStories(ChatInputStories);

describe("ChatInput Stories", () => {
  describe("Default", () => {
    it("renders correctly", async () => {
      const { container } = await Default.render();
      const canvas = within(container);

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
    });
  });

  describe("Loading", () => {
    it("renders correctly", async () => {
      const { container } = await Loading.render();
      const canvas = within(container);

      // Test that input is not editable when loading (React Native Web uses readonly)
      const input = canvas.getByPlaceholderText("Type your message...");
      expect(input).toHaveAttribute("readonly");

      // Test that send button is disabled when loading
      const sendButton = canvas.getByRole("button", { name: /send/i });
      expect(sendButton).toBeDisabled();
    });
  });

  describe("CustomPlaceholder", () => {
    it("renders correctly", async () => {
      const { container } = await CustomPlaceholder.render();
      const canvas = within(container);

      // Test custom placeholder text
      const input = canvas.getByPlaceholderText("Ask me anything...");
      expect(input).toBeInTheDocument();

      // Just verify the component is interactive
      expect(input).toBeEnabled();
    });
  });

  describe("Disabled", () => {
    it("renders correctly", async () => {
      const { container } = await Disabled.render();
      const canvas = within(container);

      // Test that component is fully disabled
      const input = canvas.getByPlaceholderText("Type your message...");
      const sendButton = canvas.getByRole("button", { name: /send/i });

      // React Native Web uses readonly for non-editable inputs
      expect(input).toHaveAttribute("readonly");
      expect(sendButton).toBeDisabled();
    });
  });

  describe("Debug", () => {
    it("shows component elements", async () => {
      const { container } = await Debug.render();

      // Look for any div elements
      const divs = container.querySelectorAll("div");
      expect(divs.length).toBeGreaterThan(0);

      // Look for any input/textarea elements
      const inputs = container.querySelectorAll("input, textarea");
      expect(inputs.length).toBeGreaterThan(0);

      // Look for any button elements
      const buttons = container.querySelectorAll("button");
      expect(buttons.length).toBeGreaterThan(0);

      // Look for any elements with testid
      const testIdElements = container.querySelectorAll("[data-testid]");
      expect(testIdElements.length).toBeGreaterThan(0);

      // Check for specific testid attributes
      const messageInput = container.querySelector(
        '[data-testid="message-input"]'
      );
      expect(messageInput).toBeInTheDocument();

      const sendButton = container.querySelector('[data-testid="send-button"]');
      expect(sendButton).toBeInTheDocument();
    });
  });
});
