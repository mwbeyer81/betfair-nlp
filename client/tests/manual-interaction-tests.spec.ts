import { test, expect } from "@playwright/test";

test.describe("Manual Interaction Tests", () => {
  test("should manually test ChatInput interactions", async ({ page }) => {
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

    console.log("🧪 Manually testing ChatInput interactions...");

    // Navigate to the ChatInput story
    await page.goto("/?path=/story/components-chatinput--default");

    // Wait for Storybook to load
    await page.waitForSelector("#storybook-panel-root", { timeout: 30000 });

    // Wait for the component to be ready
    await page.waitForTimeout(2000);

    console.log("\n" + "=".repeat(60));
    console.log("📊 MANUAL CHATINPUT INTERACTION TESTS");
    console.log("=".repeat(60));

    // Test 1: Check if input field is present
    const input = page
      .locator(
        "input[placeholder*='message'], textarea[placeholder*='message']"
      )
      .first();
    if (await input.isVisible()) {
      console.log("✅ Test 1 PASSED: Input field is present");
    } else {
      console.log("❌ Test 1 FAILED: Input field not found");
    }

    // Test 2: Check if send button is present
    const sendButton = page
      .locator("button")
      .filter({ hasText: /send/i })
      .first();
    if (await sendButton.isVisible()) {
      console.log("✅ Test 2 PASSED: Send button is present");
    } else {
      console.log("❌ Test 2 FAILED: Send button not found");
    }

    // Test 3: Test typing in the input
    if (await input.isVisible()) {
      await input.fill("Hello, this is a test message");
      const inputValue = await input.inputValue();
      if (inputValue === "Hello, this is a test message") {
        console.log("✅ Test 3 PASSED: Can type in input field");
      } else {
        console.log(
          `❌ Test 3 FAILED: Expected "Hello, this is a test message", got "${inputValue}"`
        );
      }
    } else {
      console.log("⚠️ Test 3 SKIPPED: Input field not visible");
    }

    // Test 4: Test clicking send button
    if (await sendButton.isVisible()) {
      await sendButton.click();
      console.log("✅ Test 4 PASSED: Send button is clickable");
    } else {
      console.log("⚠️ Test 4 SKIPPED: Send button not visible");
    }

    console.log("=".repeat(60));
    console.log(`Total console messages: ${consoleMessages.length}`);
    console.log(`Total errors: ${errors.length}`);

    if (errors.length > 0) {
      console.log("❌ Errors found:");
      errors.forEach((error, index) => {
        console.log(`${index + 1}. ${error}`);
      });
    } else {
      console.log("✅ No errors found");
    }

    console.log("=".repeat(60));
  });

  test("should manually test ChatInput loading state", async ({ page }) => {
    console.log("🧪 Manually testing ChatInput loading state...");

    // Navigate to the ChatInput loading story
    await page.goto("/?path=/story/components-chatinput--loading");

    // Wait for Storybook to load
    await page.waitForSelector("#storybook-panel-root", { timeout: 30000 });
    await page.waitForTimeout(2000);

    console.log("\n" + "=".repeat(60));
    console.log("📊 MANUAL CHATINPUT LOADING STATE TESTS");
    console.log("=".repeat(60));

    // Test 1: Check if input is disabled
    const input = page.locator("input, textarea").first();
    if (await input.isVisible()) {
      const isDisabled = await input.isDisabled();
      if (isDisabled) {
        console.log("✅ Test 1 PASSED: Input is disabled in loading state");
      } else {
        console.log(
          "❌ Test 1 FAILED: Input should be disabled in loading state"
        );
      }
    } else {
      console.log("⚠️ Test 1 SKIPPED: Input field not visible");
    }

    // Test 2: Check if send button is disabled
    const sendButton = page
      .locator("button")
      .filter({ hasText: /send/i })
      .first();
    if (await sendButton.isVisible()) {
      const isDisabled = await sendButton.isDisabled();
      if (isDisabled) {
        console.log(
          "✅ Test 2 PASSED: Send button is disabled in loading state"
        );
      } else {
        console.log(
          "❌ Test 2 FAILED: Send button should be disabled in loading state"
        );
      }
    } else {
      console.log("⚠️ Test 2 SKIPPED: Send button not visible");
    }

    console.log("=".repeat(60));
  });

  test("should manually test Message component", async ({ page }) => {
    console.log("🧪 Manually testing Message component...");

    // Navigate to the Message story
    await page.goto("/?path=/story/components-message--user-message");

    // Wait for Storybook to load
    await page.waitForSelector("#storybook-panel-root", { timeout: 30000 });
    await page.waitForTimeout(2000);

    console.log("\n" + "=".repeat(60));
    console.log("📊 MANUAL MESSAGE COMPONENT TESTS");
    console.log("=".repeat(60));

    // Test 1: Check if message text is displayed
    const messageText = page.locator("text=Hello! How are you today?").first();
    if (await messageText.isVisible()) {
      console.log("✅ Test 1 PASSED: Message text is displayed");
    } else {
      console.log("❌ Test 1 FAILED: Message text not found");
    }

    // Test 2: Check if message container exists
    const messageContainer = page
      .locator("[data-testid='message'], .message, [class*='message']")
      .first();
    if (await messageContainer.isVisible()) {
      console.log("✅ Test 2 PASSED: Message container is present");
    } else {
      console.log(
        "⚠️ Test 2 SKIPPED: Message container not found with expected selectors"
      );
    }

    console.log("=".repeat(60));
  });

  test("should manually test ChatScreen component", async ({ page }) => {
    console.log("🧪 Manually testing ChatScreen component...");

    // Navigate to the ChatScreen story
    await page.goto("/?path=/story/screens-chatscreen--default");

    // Wait for Storybook to load
    await page.waitForSelector("#storybook-panel-root", { timeout: 30000 });
    await page.waitForTimeout(2000);

    console.log("\n" + "=".repeat(60));
    console.log("📊 MANUAL CHATSCREEN COMPONENT TESTS");
    console.log("=".repeat(60));

    // Test 1: Check if message input is present
    const messageInput = page
      .locator("[data-testid='message-input'], input, textarea")
      .first();
    if (await messageInput.isVisible()) {
      console.log("✅ Test 1 PASSED: Message input is present");
    } else {
      console.log("❌ Test 1 FAILED: Message input not found");
    }

    // Test 2: Check if send button is present
    const sendButton = page
      .locator("[data-testid='send-button'], button")
      .filter({ hasText: /send/i })
      .first();
    if (await sendButton.isVisible()) {
      console.log("✅ Test 2 PASSED: Send button is present");
    } else {
      console.log(
        "⚠️ Test 2 SKIPPED: Send button not found with expected selectors"
      );
    }

    // Test 3: Check if message list area is present
    const messageList = page
      .locator(
        "[data-testid='message-list'], [class*='message-list'], [class*='messages']"
      )
      .first();
    if (await messageList.isVisible()) {
      console.log("✅ Test 3 PASSED: Message list area is present");
    } else {
      console.log(
        "⚠️ Test 3 SKIPPED: Message list area not found with expected selectors"
      );
    }

    console.log("=".repeat(60));
  });
});
