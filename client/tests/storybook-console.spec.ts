import { test, expect } from "@playwright/test";

test.describe("Storybook Console Output Tests", () => {
  test("should capture console output from Storybook", async ({ page }) => {
    // Array to store console messages
    const consoleMessages: string[] = [];

    // Listen to console messages
    page.on("console", msg => {
      consoleMessages.push(`${msg.type()}: ${msg.text()}`);
      console.log(`[Browser Console] ${msg.type()}: ${msg.text()}`);
    });

    // Listen to page errors
    page.on("pageerror", error => {
      consoleMessages.push(`ERROR: ${error.message}`);
      console.log(`[Page Error] ${error.message}`);
    });

    // Navigate to Storybook
    await page.goto("/");

    // Wait for Storybook to load
    await page.waitForSelector("#storybook-panel-root", { timeout: 30000 });

    // Wait a bit for any initial console output
    await page.waitForTimeout(2000);

    // Log all captured console messages
    console.log("\n=== CAPTURED CONSOLE OUTPUT ===");
    consoleMessages.forEach((msg, index) => {
      console.log(`${index + 1}. ${msg}`);
    });
    console.log("=== END CONSOLE OUTPUT ===\n");

    // Verify that Storybook loaded successfully
    await expect(page.locator("#storybook-panel-root")).toBeVisible();

    // You can add more specific tests here based on your stories
    // For example, if you have a specific story, you can navigate to it:
    // await page.goto('/?path=/story/your-story-name');
  });

  test("should test ChatScreen story and capture console output", async ({
    page,
  }) => {
    const consoleMessages: string[] = [];

    page.on("console", msg => {
      consoleMessages.push(`${msg.type()}: ${msg.text()}`);
      console.log(`[Browser Console] ${msg.type()}: ${msg.text()}`);
    });

    page.on("pageerror", error => {
      consoleMessages.push(`ERROR: ${error.message}`);
      console.log(`[Page Error] ${error.message}`);
    });

    // Navigate to Storybook
    await page.goto("/");
    await page.waitForSelector("#storybook-panel-root", { timeout: 30000 });

    // Look for ChatScreen story (you may need to adjust the selector based on your story structure)
    const chatScreenStory = page.locator("text=ChatScreen").first();
    if (await chatScreenStory.isVisible()) {
      await chatScreenStory.click();
      await page.waitForTimeout(2000);
    }

    console.log("\n=== CHATSCREEN STORY CONSOLE OUTPUT ===");
    consoleMessages.forEach((msg, index) => {
      console.log(`${index + 1}. ${msg}`);
    });
    console.log("=== END CHATSCREEN CONSOLE OUTPUT ===\n");
  });

  test("should test Message component story and capture console output", async ({
    page,
  }) => {
    const consoleMessages: string[] = [];

    page.on("console", msg => {
      consoleMessages.push(`${msg.type()}: ${msg.text()}`);
      console.log(`[Browser Console] ${msg.type()}: ${msg.text()}`);
    });

    page.on("pageerror", error => {
      consoleMessages.push(`ERROR: ${error.message}`);
      console.log(`[Page Error] ${error.message}`);
    });

    await page.goto("/");
    await page.waitForSelector("#storybook-panel-root", { timeout: 30000 });

    // Look for Message story
    const messageStory = page.locator("text=Message").first();
    if (await messageStory.isVisible()) {
      await messageStory.click();
      await page.waitForTimeout(2000);
    }

    console.log("\n=== MESSAGE STORY CONSOLE OUTPUT ===");
    consoleMessages.forEach((msg, index) => {
      console.log(`${index + 1}. ${msg}`);
    });
    console.log("=== END MESSAGE CONSOLE OUTPUT ===\n");
  });
});
