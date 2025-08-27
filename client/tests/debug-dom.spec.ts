import { test, expect } from "@playwright/test";

test.describe("DOM Structure Debug", () => {
  test("should debug ChatInput DOM structure", async ({ page }) => {
    console.log("🧪 Debugging ChatInput DOM structure...");

    // Navigate to the ChatInput story
    await page.goto("/?path=/story/components-chatinput--default");

    // Wait for Storybook to load
    await page.waitForSelector("#storybook-panel-root", { timeout: 30000 });

    // Wait for the component to be ready
    await page.waitForTimeout(3000);

    console.log("\n" + "=".repeat(60));
    console.log("📊 CHATINPUT DOM STRUCTURE DEBUG");
    console.log("=".repeat(60));

    // Get the main story container
    const storyContainer = page.locator("#storybook-panel-root");
    if (await storyContainer.isVisible()) {
      console.log("✅ Storybook panel root is visible");

      // Get all input elements
      const inputs = page.locator("input, textarea");
      const inputCount = await inputs.count();
      console.log(`📝 Found ${inputCount} input/textarea elements`);

      for (let i = 0; i < inputCount; i++) {
        const input = inputs.nth(i);
        const placeholder = await input.getAttribute("placeholder");
        const type = await input.getAttribute("type");
        const disabled = await input.isDisabled();
        console.log(
          `  Input ${i + 1}: placeholder="${placeholder}", type="${type}", disabled=${disabled}`
        );
      }

      // Get all button elements
      const buttons = page.locator("button");
      const buttonCount = await buttons.count();
      console.log(`🔘 Found ${buttonCount} button elements`);

      for (let i = 0; i < buttonCount; i++) {
        const button = buttons.nth(i);
        const text = await button.textContent();
        const disabled = await button.isDisabled();
        console.log(
          `  Button ${i + 1}: text="${text?.trim()}", disabled=${disabled}`
        );
      }

      // Get all div elements to see the structure
      const divs = page.locator("div");
      const divCount = await divs.count();
      console.log(`📦 Found ${divCount} div elements`);

      // Look for elements with specific classes or data attributes
      const elementsWithClasses = page.locator("[class]");
      const classCount = await elementsWithClasses.count();
      console.log(`🎨 Found ${classCount} elements with classes`);

      // Get the HTML structure of the main container
      const html = await storyContainer.innerHTML();
      console.log("\n📄 HTML Structure (first 1000 chars):");
      console.log(html.substring(0, 1000));
    } else {
      console.log("❌ Storybook panel root not visible");
    }

    // Take a screenshot for visual debugging
    await page.screenshot({ path: "chatinput-dom-debug.png" });
    console.log("📸 Screenshot saved as chatinput-dom-debug.png");

    console.log("=".repeat(60));
  });

  test("should debug ChatScreen DOM structure", async ({ page }) => {
    console.log("🧪 Debugging ChatScreen DOM structure...");

    // Navigate to the ChatScreen story
    await page.goto("/?path=/story/screens-chatscreen--default");

    // Wait for Storybook to load
    await page.waitForSelector("#storybook-panel-root", { timeout: 30000 });
    await page.waitForTimeout(3000);

    console.log("\n" + "=".repeat(60));
    console.log("📊 CHATSCREEN DOM STRUCTURE DEBUG");
    console.log("=".repeat(60));

    const storyContainer = page.locator("#storybook-panel-root");
    if (await storyContainer.isVisible()) {
      console.log("✅ Storybook panel root is visible");

      // Get all elements with data-testid attributes
      const testIdElements = page.locator("[data-testid]");
      const testIdCount = await testIdElements.count();
      console.log(`🏷️ Found ${testIdCount} elements with data-testid`);

      for (let i = 0; i < testIdCount; i++) {
        const element = testIdElements.nth(i);
        const testId = await element.getAttribute("data-testid");
        const tagName = await element.evaluate(el => el.tagName.toLowerCase());
        console.log(
          `  Element ${i + 1}: data-testid="${testId}", tag="${tagName}"`
        );
      }

      // Get all input elements
      const inputs = page.locator("input, textarea");
      const inputCount = await inputs.count();
      console.log(`📝 Found ${inputCount} input/textarea elements`);

      // Get all button elements
      const buttons = page.locator("button");
      const buttonCount = await buttons.count();
      console.log(`🔘 Found ${buttonCount} button elements`);

      // Get the HTML structure
      const html = await storyContainer.innerHTML();
      console.log("\n📄 HTML Structure (first 1000 chars):");
      console.log(html.substring(0, 1000));
    } else {
      console.log("❌ Storybook panel root not visible");
    }

    // Take a screenshot
    await page.screenshot({ path: "chatscreen-dom-debug.png" });
    console.log("📸 Screenshot saved as chatscreen-dom-debug.png");

    console.log("=".repeat(60));
  });

  test("should debug Message DOM structure", async ({ page }) => {
    console.log("🧪 Debugging Message DOM structure...");

    // Navigate to the Message story
    await page.goto("/?path=/story/components-message--user-message");

    // Wait for Storybook to load
    await page.waitForSelector("#storybook-panel-root", { timeout: 30000 });
    await page.waitForTimeout(3000);

    console.log("\n" + "=".repeat(60));
    console.log("📊 MESSAGE DOM STRUCTURE DEBUG");
    console.log("=".repeat(60));

    const storyContainer = page.locator("#storybook-panel-root");
    if (await storyContainer.isVisible()) {
      console.log("✅ Storybook panel root is visible");

      // Look for the specific message text
      const messageText = page.locator("text=Hello! How are you today?");
      if (await messageText.isVisible()) {
        console.log("✅ Message text found");
      } else {
        console.log("❌ Message text not found");

        // Look for any text content
        const allText = await storyContainer.textContent();
        console.log("📄 All text content:");
        console.log(allText);
      }

      // Get all elements with message-related classes
      const messageElements = page.locator(
        "[class*='message'], [class*='Message']"
      );
      const messageCount = await messageElements.count();
      console.log(
        `💬 Found ${messageCount} elements with message-related classes`
      );

      // Get the HTML structure
      const html = await storyContainer.innerHTML();
      console.log("\n📄 HTML Structure (first 1000 chars):");
      console.log(html.substring(0, 1000));
    } else {
      console.log("❌ Storybook panel root not visible");
    }

    // Take a screenshot
    await page.screenshot({ path: "message-dom-debug.png" });
    console.log("📸 Screenshot saved as message-dom-debug.png");

    console.log("=".repeat(60));
  });
});
