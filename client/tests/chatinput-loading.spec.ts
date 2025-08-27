import { test, expect } from "@playwright/test";

test.describe("ChatInput Loading Story Console Errors", () => {
  test("should check ChatInput loading story for console errors", async ({
    page,
  }) => {
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

    console.log("🧪 Testing ChatInput loading story for console errors...");

    // Navigate to the ChatInput loading story
    await page.goto(
      "http://localhost:6006/?path=/story/components-chatinput--loading"
    );

    // Wait for Storybook to load
    await page.waitForSelector("#storybook-panel-root", { timeout: 30000 });

    // Wait for the story to render and any potential errors
    await page.waitForTimeout(5000);

    console.log("\n" + "=".repeat(60));
    console.log("📊 CHATINPUT LOADING STORY CONSOLE ANALYSIS");
    console.log("=".repeat(60));

    // Check for any console errors
    const errorMessages = consoleMessages.filter(
      msg =>
        msg.includes("error") ||
        msg.includes("Error") ||
        msg.includes("failed") ||
        msg.includes("Cannot") ||
        msg.includes("Failed to") ||
        msg.includes("TypeError") ||
        msg.includes("ReferenceError")
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

    // Show all console messages for debugging
    console.log(`\n📝 Total console messages: ${consoleMessages.length}`);
    if (consoleMessages.length > 0) {
      console.log("🔍 All console messages:");
      consoleMessages.forEach((msg, index) => {
        console.log(`${index + 1}. ${msg}`);
      });
    }

    // Check if the component is actually rendering
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
        for (let i = 0; i < Math.min(testIdCount, 10); i++) {
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

    console.log("=".repeat(60));
  });
});
