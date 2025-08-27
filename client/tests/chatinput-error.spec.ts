import { test, expect } from "@playwright/test";

test.describe("ChatInput Error Fix Tests", () => {
  test("should capture expect error in ChatInput story and attempt to fix", async ({
    page,
  }) => {
    const consoleMessages: string[] = [];
    const errors: string[] = [];
    let expectErrorFound = false;

    // Listen to console messages
    page.on("console", (msg) => {
      consoleMessages.push(`${msg.type()}: ${msg.text()}`);
      console.log(`[Browser Console] ${msg.type()}: ${msg.text()}`);
      
      // Check for the specific expect error
      if (msg.text().includes("ReferenceError: expect is not defined")) {
        expectErrorFound = true;
        console.log("🚨 FOUND EXPECT ERROR!");
      }
    });

    // Listen to page errors
    page.on("pageerror", (error) => {
      const errorMessage = `PAGE ERROR: ${error.message}`;
      errors.push(errorMessage);
      console.log(`[Page Error] ${error.message}`);
      
      // Check for the specific expect error
      if (error.message.includes("ReferenceError: expect is not defined")) {
        expectErrorFound = true;
        console.log("🚨 FOUND EXPECT ERROR IN PAGE ERROR!");
      }
    });

    // Listen to unhandled rejections
    page.on("unhandledrejection", (rejection) => {
      const errorMessage = `UNHANDLED REJECTION: ${rejection.reason}`;
      errors.push(errorMessage);
      console.log(`[Unhandled Rejection] ${rejection.reason}`);
      
      // Check for the specific expect error
      if (rejection.reason.includes("ReferenceError: expect is not defined")) {
        expectErrorFound = true;
        console.log("🚨 FOUND EXPECT ERROR IN UNHANDLED REJECTION!");
      }
    });

    console.log("🧪 Navigating to ChatInput story...");
    
    // Navigate directly to the ChatInput story
    await page.goto("/?path=/story/components-chatinput--default");
    
    // Wait for Storybook to load
    await page.waitForSelector("#storybook-panel-root", { timeout: 30000 });
    
    // Wait for any console output to appear
    await page.waitForTimeout(5000);
    
    console.log("\n" + "=".repeat(60));
    console.log("📊 CHATINPUT STORY CONSOLE OUTPUT");
    console.log("=".repeat(60));
    
    // Print all console messages
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
    
    console.log("\n" + "=".repeat(60));
    console.log(`🔍 EXPECT ERROR FOUND: ${expectErrorFound ? "YES" : "NO"}`);
    console.log("=".repeat(60));
    
    // If we found the expect error, provide guidance on how to fix it
    if (expectErrorFound) {
      console.log("\n🔧 SUGGESTED FIXES:");
      console.log("-".repeat(40));
      console.log("1. Check if @storybook/test is properly imported in the story file");
      console.log("2. Ensure expect is imported: import { expect } from '@storybook/test'");
      console.log("3. Or use the global expect from Playwright: import { expect } from '@playwright/test'");
      console.log("4. Check if the story file has proper test setup");
    }
    
    // Verify the page loaded
    await expect(page.locator("#storybook-panel-root")).toBeVisible();
    
    // Take a screenshot for debugging
    await page.screenshot({ path: "chatinput-error-screenshot.png" });
    console.log("📸 Screenshot saved as chatinput-error-screenshot.png");
  });

  test("should test ChatInput story after potential fixes", async ({ page }) => {
    const consoleMessages: string[] = [];
    const errors: string[] = [];

    page.on("console", (msg) => {
      consoleMessages.push(`${msg.type()}: ${msg.text()}`);
      console.log(`[Browser Console] ${msg.type()}: ${msg.text()}`);
    });

    page.on("pageerror", (error) => {
      const errorMessage = `PAGE ERROR: ${error.message}`;
      errors.push(errorMessage);
      console.log(`[Page Error] ${error.message}`);
    });

    console.log("🧪 Testing ChatInput story after fixes...");
    
    await page.goto("/?path=/story/components-chatinput--default");
    await page.waitForSelector("#storybook-panel-root", { timeout: 30000 });
    
    // Wait for any interactions or errors
    await page.waitForTimeout(3000);
    
    // Try to interact with the ChatInput component if it's visible
    try {
      const inputField = page.locator("input, textarea").first();
      if (await inputField.isVisible()) {
        console.log("✅ Found input field, testing interaction...");
        await inputField.fill("Test message");
        await page.waitForTimeout(1000);
      }
    } catch (error) {
      console.log("⚠️ Could not interact with input field:", error);
    }
    
    console.log("\n" + "=".repeat(60));
    console.log("📊 POST-FIX CONSOLE OUTPUT");
    console.log("=".repeat(60));
    console.log(`Total messages: ${consoleMessages.length}`);
    console.log(`Errors: ${errors.length}`);
    
    if (errors.length === 0) {
      console.log("✅ No errors found - potential fix successful!");
    } else {
      console.log("❌ Errors still present:");
      errors.forEach((error, index) => {
        console.log(`${index + 1}. ${error}`);
      });
    }
  });
});
