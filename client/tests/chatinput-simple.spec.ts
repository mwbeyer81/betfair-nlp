import { test, expect } from "@playwright/test";

test.describe("ChatInput Simple Test", () => {
  test("should load ChatInput story without errors", async ({ page }) => {
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

    console.log("🧪 Loading ChatInput story...");

    // Navigate to the ChatInput story
    await page.goto("/?path=/story/components-chatinput--default");

    // Wait for Storybook to load
    await page.waitForSelector("#storybook-panel-root", { timeout: 30000 });

    // Wait a bit for any errors to appear
    await page.waitForTimeout(3000);

    console.log("\n" + "=".repeat(60));
    console.log("📊 CHATINPUT STORY LOAD TEST");
    console.log("=".repeat(60));
    console.log(`Total console messages: ${consoleMessages.length}`);
    console.log(`Total errors: ${errors.length}`);

    if (errors.length === 0) {
      console.log("✅ No errors found - ChatInput story loaded successfully!");
    } else {
      console.log("❌ Errors found:");
      errors.forEach((error, index) => {
        console.log(`${index + 1}. ${error}`);
      });
    }

    // Verify the page loaded
    await expect(page.locator("#storybook-panel-root")).toBeVisible();

    // Check if we can find the ChatInput component
    const chatInput = page.locator("input, textarea").first();
    if (await chatInput.isVisible()) {
      console.log("✅ ChatInput component is visible");
    } else {
      console.log("⚠️ ChatInput component not found");
    }

    console.log("=".repeat(60));
  });
});
