const { chromium } = require("@playwright/test");

async function launchChatInput() {
  console.log("🚀 Launching ChatInput story...");

  // Launch browser with more debugging options
  const browser = await chromium.launch({
    headless: false, // Show the browser
    slowMo: 1000, // Slow down actions for visibility
    args: [
      "--disable-web-security",
      "--disable-features=VizDisplayCompositor",
      "--no-sandbox",
      "--disable-setuid-sandbox",
    ],
  });

  // Create a new page
  const page = await browser.newPage();

  // Listen to console messages
  page.on("console", msg => {
    console.log(`[Browser Console] ${msg.type()}: ${msg.text()}`);
  });

  // Listen to page errors
  page.on("pageerror", error => {
    console.log(`[Page Error] ${error.message}`);
  });

  // Listen to unhandled rejections
  page.on("unhandledrejection", rejection => {
    console.log(`[Unhandled Rejection] ${rejection.reason}`);
  });

  try {
    // Navigate to the ChatInput story
    console.log("📱 Navigating to ChatInput story...");
    await page.goto(
      "http://localhost:6006/?path=/story/components-chatinput--default"
    );

    // Wait for Storybook to load
    await page.waitForSelector("#storybook-panel-root", { timeout: 30000 });
    console.log("✅ Storybook loaded successfully");

    // Wait for the component to be ready
    console.log("⏳ Waiting for component to load...");
    await page.waitForTimeout(5000);

    // Check for any loading spinners
    const spinner = page.locator(
      "[class*='spinner'], [class*='loading'], [class*='Spinner'], [class*='Loading']"
    );
    if (await spinner.isVisible()) {
      console.log("🔄 Loading spinner detected - component may be stuck");
    } else {
      console.log("✅ No loading spinner detected");
    }

    // Check for any error messages
    const errorElements = page.locator(
      "[class*='error'], [class*='Error'], [class*='fail'], [class*='Fail']"
    );
    if (await errorElements.isVisible()) {
      console.log("❌ Error elements detected");
      const errorText = await errorElements.textContent();
      console.log(`Error text: ${errorText}`);
    }

    // Check if the component is visible
    const input = page.locator(
      'input[placeholder*="message"], textarea[placeholder*="message"]'
    );
    const sendButton = page.locator("button").filter({ hasText: /send/i });

    console.log("🔍 Checking component visibility...");

    if (await input.isVisible()) {
      console.log("✅ ChatInput component is visible");

      // Test typing in the input
      await input.fill("Hello from Playwright!");
      console.log("✍️ Typed message in input");

      // Wait a moment to see the input
      await page.waitForTimeout(1000);

      // Test clicking send button
      if (await sendButton.isVisible()) {
        await sendButton.click();
        console.log("🔘 Clicked send button");
      }
    } else {
      console.log("❌ ChatInput component not found");

      // Debug: Look for any input elements
      const allInputs = page.locator("input, textarea");
      const inputCount = await allInputs.count();
      console.log(`📝 Found ${inputCount} input/textarea elements`);

      for (let i = 0; i < inputCount; i++) {
        const inputEl = allInputs.nth(i);
        const placeholder = await inputEl.getAttribute("placeholder");
        const type = await inputEl.getAttribute("type");
        console.log(
          `  Input ${i + 1}: placeholder="${placeholder}", type="${type}"`
        );
      }

      // Debug: Look for any button elements
      const allButtons = page.locator("button");
      const buttonCount = await allButtons.count();
      console.log(`🔘 Found ${buttonCount} button elements`);

      for (let i = 0; i < Math.min(buttonCount, 10); i++) {
        const buttonEl = allButtons.nth(i);
        const text = await buttonEl.textContent();
        console.log(`  Button ${i + 1}: text="${text?.trim()}"`);
      }

      // Debug: Get the HTML content to see what's actually rendered
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
    }

    // Keep the browser open for 15 seconds so you can see the result
    console.log("⏰ Keeping browser open for 15 seconds...");
    await page.waitForTimeout(15000);
  } catch (error) {
    console.error("❌ Error:", error.message);
    console.error("Stack trace:", error.stack);
  } finally {
    // Close the browser
    await browser.close();
    console.log("🔒 Browser closed");
  }
}

// Run the script
launchChatInput().catch(console.error);
