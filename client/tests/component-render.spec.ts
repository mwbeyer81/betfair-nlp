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
    const chatInputContainer = page.locator("[data-testid='chat-input']");
    if (await chatInputContainer.isVisible()) {
      console.log("✅ ChatInput component container found");
    } else {
      console.log("❌ ChatInput component container not found");
      // Try alternative selectors
      const altContainer = page.locator(
        "div:has([data-testid='message-input'])"
      );
      if (await altContainer.isVisible()) {
        console.log("✅ ChatInput component found via alternative selector");
      }
    }

    // Look for the message input
    const messageInput = page.locator("[data-testid='message-input']");
    if (await messageInput.isVisible()) {
      console.log("✅ Message input found");
    } else {
      console.log("❌ Message input not found");
      // Try alternative selectors
      const altInput = page.locator(
        "textarea[placeholder*='message'], input[placeholder*='message']"
      );
      if (await altInput.isVisible()) {
        console.log("✅ Message input found via placeholder");
      }
    }

    // Look for the send button
    const sendButton = page.locator("[data-testid='send-button']");
    if (await sendButton.isVisible()) {
      console.log("✅ Send button found");
    } else {
      console.log("❌ Send button not found");
      // Try alternative selectors
      const altButton = page.locator("button:has-text('Send')").first();
      if (await altButton.isVisible()) {
        console.log("✅ Send button found via text content");
      }
    }

    // Debug: Check what's actually in the storybook-panel-root
    const storybookPanel = page.locator("#storybook-panel-root");
    if (await storybookPanel.isVisible()) {
      console.log("✅ Storybook panel root found");

      // Look for any elements with testid attributes
      const testIdElements = page.locator("[data-testid]");
      const testIdCount = await testIdElements.count();
      console.log(
        `🔍 Found ${testIdCount} elements with data-testid attributes`
      );

      if (testIdCount > 0) {
        for (let i = 0; i < Math.min(testIdCount, 5); i++) {
          const element = testIdElements.nth(i);
          const testId = await element.getAttribute("data-testid");
          const tagName = await element.evaluate(el =>
            el.tagName.toLowerCase()
          );
          console.log(`  - ${tagName}[data-testid="${testId}"]`);
        }
      }
    } else {
      console.log("❌ Storybook panel root not found");
    }

    // Get the full HTML to see what's actually rendered
    const html = await page.content();

    // Look for specific component identifiers
    const hasChatInput =
      html.includes("chat-input") ||
      html.includes("message-input") ||
      html.includes("send-button");
    const hasStorybookContent =
      html.includes("storybook") || html.includes("sb-");

    if (hasChatInput) {
      console.log("✅ Component elements found in HTML");
    } else if (hasStorybookContent) {
      console.log("⚠️ Storybook loaded but component elements not found");
      console.log("🔍 This might indicate the component failed to render");
    } else {
      console.log("❌ Component elements not found in HTML");
    }

    // Show a more focused HTML snippet around the story area
    const storybookRoot = html.indexOf('id="storybook-root"');
    if (storybookRoot !== -1) {
      const start = Math.max(0, storybookRoot - 500);
      const end = Math.min(html.length, storybookRoot + 2000);
      console.log("📄 Storybook root HTML snippet:");
      console.log(html.substring(start, end));
    } else {
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

    // Look for the message text - handle duplicate elements
    const messageTextElements = page.locator("text=Hello! How are you today?");
    const count = await messageTextElements.count();

    if (count > 0) {
      console.log(`✅ Message text found (${count} elements)`);

      // Try to find the actual message component (not the Storybook control)
      const messageComponent = page.locator(
        "[data-testid='message'], .message, .user-message"
      );
      if (await messageComponent.isVisible()) {
        console.log("✅ Message component container found");
      } else {
        console.log(
          "⚠️ Message component container not found, but text exists"
        );
      }
    } else {
      console.log("❌ Message text not found");
    }

    console.log("=".repeat(60));
  });
});
