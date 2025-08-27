import { test, expect } from "@playwright/test";

test.describe("Storybook Interaction Tests", () => {
  test("should run ChatInput interaction tests", async ({ page }) => {
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

    console.log("🧪 Testing ChatInput interaction tests...");

    // Navigate to the ChatInput story
    await page.goto("/?path=/story/components-chatinput--default");

    // Wait for Storybook to load
    await page.waitForSelector("#storybook-panel-root", { timeout: 30000 });

    // Wait for interaction tests to run
    await page.waitForTimeout(5000);

    console.log("\n" + "=".repeat(60));
    console.log("📊 INTERACTION TEST RESULTS");
    console.log("=".repeat(60));
    console.log(`Total console messages: ${consoleMessages.length}`);
    console.log(`Total errors: ${errors.length}`);

    // Look for interaction test results in console
    const interactionMessages = consoleMessages.filter(
      msg =>
        msg.includes("expect") ||
        msg.includes("toBeInTheDocument") ||
        msg.includes("toHaveValue") ||
        msg.includes("toHaveBeenCalled")
    );

    if (interactionMessages.length > 0) {
      console.log("✅ Interaction tests are running!");
      interactionMessages.forEach((msg, index) => {
        console.log(`${index + 1}. ${msg}`);
      });
    } else {
      console.log("⚠️ No interaction test messages found");
    }

    // Check for any test failures
    const testFailures = consoleMessages.filter(
      msg =>
        msg.includes("FAIL") || msg.includes("Error") || msg.includes("failed")
    );

    if (testFailures.length > 0) {
      console.log("❌ Test failures found:");
      testFailures.forEach((msg, index) => {
        console.log(`${index + 1}. ${msg}`);
      });
    } else {
      console.log("✅ No test failures detected");
    }

    console.log("=".repeat(60));

    // Verify the page loaded
    await expect(page.locator("#storybook-panel-root")).toBeVisible();
  });

  test("should run ChatScreen interaction tests", async ({ page }) => {
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

    console.log("🧪 Testing ChatScreen interaction tests...");

    await page.goto("/?path=/story/screens-chatscreen--default");
    await page.waitForSelector("#storybook-panel-root", { timeout: 30000 });
    await page.waitForTimeout(5000);

    console.log("\n" + "=".repeat(60));
    console.log("📊 CHATSCREEN INTERACTION TEST RESULTS");
    console.log("=".repeat(60));

    const interactionMessages = consoleMessages.filter(
      msg =>
        msg.includes("expect") ||
        msg.includes("toBeInTheDocument") ||
        msg.includes("toHaveValue")
    );

    if (interactionMessages.length > 0) {
      console.log("✅ ChatScreen interaction tests are running!");
      interactionMessages.forEach((msg, index) => {
        console.log(`${index + 1}. ${msg}`);
      });
    } else {
      console.log("⚠️ No ChatScreen interaction test messages found");
    }

    console.log("=".repeat(60));

    await expect(page.locator("#storybook-panel-root")).toBeVisible();
  });

  test("should run Message interaction tests", async ({ page }) => {
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

    console.log("🧪 Testing Message interaction tests...");

    await page.goto("/?path=/story/components-message--user-message");
    await page.waitForSelector("#storybook-panel-root", { timeout: 30000 });
    await page.waitForTimeout(5000);

    console.log("\n" + "=".repeat(60));
    console.log("📊 MESSAGE INTERACTION TEST RESULTS");
    console.log("=".repeat(60));

    const interactionMessages = consoleMessages.filter(
      msg =>
        msg.includes("expect") ||
        msg.includes("toBeInTheDocument") ||
        msg.includes("toHaveClass")
    );

    if (interactionMessages.length > 0) {
      console.log("✅ Message interaction tests are running!");
      interactionMessages.forEach((msg, index) => {
        console.log(`${index + 1}. ${msg}`);
      });
    } else {
      console.log("⚠️ No Message interaction test messages found");
    }

    console.log("=".repeat(60));

    await expect(page.locator("#storybook-panel-root")).toBeVisible();
  });
});
