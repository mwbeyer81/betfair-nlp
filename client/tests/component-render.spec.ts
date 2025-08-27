import { test, expect } from "@playwright/test";

test.describe("Component Render Tests", () => {
  test("should check if ChatInput component renders", async ({ page }) => {
    const errors: string[] = [];
    const consoleMessages: string[] = [];

    // Listen to console messages
    page.on("console", msg => {
      consoleMessages.push(`${msg.type()}: ${msg.text()}`);
      console.log(`[Browser Console] ${msg.type()}: ${msg.text()}`);
    });

    // Listen to page errors
    page.on("pageerror", error => {
      const errorMessage = `PAGE ERROR: ${error.message}`;
      errors.push(errorMessage);
      console.log(`[Page Error] ${error.message}`);
    });

    console.log("🧪 Testing ChatInput component render...");

    // Navigate to the ChatInput story
    await page.goto("/?path=/story/components-chatinput--default");

    // Wait for Storybook to load
    await page.waitForSelector("#storybook-panel-root", { timeout: 30000 });

    // Wait for any potential errors
    await page.waitForTimeout(5000);

    console.log("\n" + "=".repeat(60));
    console.log("📊 CHATINPUT COMPONENT RENDER TEST");
    console.log("=".repeat(60));

    // Check for any console errors
    const errorMessages = consoleMessages.filter(
      msg =>
        msg.includes("error") ||
        msg.includes("Error") ||
        msg.includes("failed") ||
        msg.includes("Cannot") ||
        msg.includes("Failed to")
    );

    if (errorMessages.length > 0) {
      console.log("❌ Console errors found:");
      errorMessages.forEach((msg, index) => {
        console.log(`${index + 1}. ${msg}`);
      });
    } else {
      console.log("✅ No console errors found");
    }

    // Check for page errors
    if (errors.length > 0) {
      console.log("❌ Page errors found:");
      errors.forEach((error, index) => {
        console.log(`${index + 1}. ${error}`);
      });
    } else {
      console.log("✅ No page errors found");
    }

    // Look for the actual component in the DOM
    const chatInputContainer = page.locator(
      "[testid='chat-input'], [data-testid='chat-input']"
    );
    if (await chatInputContainer.isVisible()) {
      console.log("✅ ChatInput component container found");
    } else {
      console.log("❌ ChatInput component container not found");
    }

    // Look for the message input
    const messageInput = page.locator(
      "[testid='message-input'], [data-testid='message-input']"
    );
    if (await messageInput.isVisible()) {
      console.log("✅ Message input found");
    } else {
      console.log("❌ Message input not found");
    }

    // Look for the send button
    const sendButton = page.locator(
      "[testid='send-button'], [data-testid='send-button']"
    );
    if (await sendButton.isVisible()) {
      console.log("✅ Send button found");
    } else {
      console.log("❌ Send button not found");
    }

    // Get the full HTML to see what's actually rendered
    const html = await page.content();
    if (
      html.includes("chat-input") ||
      html.includes("message-input") ||
      html.includes("send-button")
    ) {
      console.log("✅ Component elements found in HTML");
    } else {
      console.log("❌ Component elements not found in HTML");
      console.log("📄 HTML snippet (first 2000 chars):");
      console.log(html.substring(0, 2000));
    }

    console.log("=".repeat(60));
  });

  test("should check if Message component renders", async ({ page }) => {
    const errors: string[] = [];
    const consoleMessages: string[] = [];

    page.on("console", msg => {
      consoleMessages.push(`${msg.type()}: ${msg.text()}`);
      console.log(`[Browser Console] ${msg.type()}: ${msg.text()}`);
    });

    page.on("pageerror", error => {
      const errorMessage = `PAGE ERROR: ${error.message}`;
      errors.push(errorMessage);
      console.log(`[Page Error] ${error.message}`);
    });

    console.log("🧪 Testing Message component render...");

    await page.goto("/?path=/story/components-message--user-message");
    await page.waitForSelector("#storybook-panel-root", { timeout: 30000 });
    await page.waitForTimeout(5000);

    console.log("\n" + "=".repeat(60));
    console.log("📊 MESSAGE COMPONENT RENDER TEST");
    console.log("=".repeat(60));

    // Check for errors
    const errorMessages = consoleMessages.filter(
      msg =>
        msg.includes("error") ||
        msg.includes("Error") ||
        msg.includes("failed") ||
        msg.includes("Cannot") ||
        msg.includes("Failed to")
    );

    if (errorMessages.length > 0) {
      console.log("❌ Console errors found:");
      errorMessages.forEach((msg, index) => {
        console.log(`${index + 1}. ${msg}`);
      });
    } else {
      console.log("✅ No console errors found");
    }

    if (errors.length > 0) {
      console.log("❌ Page errors found:");
      errors.forEach((error, index) => {
        console.log(`${index + 1}. ${error}`);
      });
    } else {
      console.log("✅ No page errors found");
    }

    // Look for the message text
    const messageText = page.locator("text=Hello! How are you today?");
    if (await messageText.isVisible()) {
      console.log("✅ Message text found");
    } else {
      console.log("❌ Message text not found");
    }

    console.log("=".repeat(60));
  });
});
