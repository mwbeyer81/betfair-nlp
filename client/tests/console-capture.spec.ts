import { test, expect } from "@playwright/test";

test.describe("Console Output Capture", () => {
  test("should capture all console output from Storybook", async ({ page }) => {
    const consoleMessages: string[] = [];
    const errors: string[] = [];
    const warnings: string[] = [];
    const logs: string[] = [];

    // Listen to all console messages
    page.on("console", msg => {
      const message = `${msg.type()}: ${msg.text()}`;
      consoleMessages.push(message);

      // Categorize messages
      switch (msg.type()) {
        case "error":
          errors.push(message);
          console.log(`[ERROR] ${msg.text()}`);
          break;
        case "warning":
          warnings.push(message);
          console.log(`[WARNING] ${msg.text()}`);
          break;
        case "log":
          logs.push(message);
          console.log(`[LOG] ${msg.text()}`);
          break;
        default:
          console.log(`[${msg.type().toUpperCase()}] ${msg.text()}`);
      }
    });

    // Listen to page errors
    page.on("pageerror", error => {
      const errorMessage = `PAGE ERROR: ${error.message}`;
      errors.push(errorMessage);
      console.log(`[PAGE ERROR] ${error.message}`);
    });

    // Listen to console errors instead of unhandled rejections
    page.on("console", msg => {
      if (msg.type() === "error") {
        const errorMessage = `CONSOLE ERROR: ${msg.text()}`;
        errors.push(errorMessage);
        console.log(`[Console Error] ${msg.text()}`);
      }
    });

    // Navigate to Storybook
    await page.goto("/");

    // Wait for Storybook to load
    await page.waitForSelector("#storybook-panel-root", { timeout: 30000 });

    // Wait for any initial console output
    await page.waitForTimeout(5000);

    // Print summary
    console.log("\n" + "=".repeat(60));
    console.log("📊 CONSOLE OUTPUT SUMMARY");
    console.log("=".repeat(60));
    console.log(`Total messages: ${consoleMessages.length}`);
    console.log(`Errors: ${errors.length}`);
    console.log(`Warnings: ${warnings.length}`);
    console.log(`Logs: ${logs.length}`);
    console.log("=".repeat(60));

    // Print all messages
    console.log("\n📝 ALL CONSOLE MESSAGES:");
    console.log("-".repeat(40));
    consoleMessages.forEach((msg, index) => {
      console.log(`${index + 1}. ${msg}`);
    });

    // Print errors separately
    if (errors.length > 0) {
      console.log("\n❌ ERRORS:");
      console.log("-".repeat(40));
      errors.forEach((error, index) => {
        console.log(`${index + 1}. ${error}`);
      });
    }

    // Print warnings separately
    if (warnings.length > 0) {
      console.log("\n⚠️  WARNINGS:");
      console.log("-".repeat(40));
      warnings.forEach((warning, index) => {
        console.log(`${index + 1}. ${warning}`);
      });
    }

    console.log("\n" + "=".repeat(60));
    console.log("✅ CONSOLE CAPTURE COMPLETE");
    console.log("=".repeat(60));

    // Verify Storybook loaded
    await expect(page.locator("#storybook-panel-root")).toBeVisible();
  });
});
