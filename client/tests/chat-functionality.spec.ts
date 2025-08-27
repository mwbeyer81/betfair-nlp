import { test, expect } from "@playwright/test";

test.describe("Chat Functionality Tests", () => {
  test("should test chat API integration and capture console output", async ({
    page,
  }) => {
    const consoleMessages: string[] = [];

    // Listen to console messages
    page.on("console", msg => {
      consoleMessages.push(`${msg.type()}: ${msg.text()}`);
      console.log(`[Browser Console] ${msg.type()}: ${msg.text()}`);
    });

    // Listen to network requests
    page.on("request", request => {
      console.log(`[Network Request] ${request.method()} ${request.url()}`);
    });

    page.on("response", response => {
      console.log(`[Network Response] ${response.status()} ${response.url()}`);
    });

    // Listen to page errors
    page.on("pageerror", error => {
      consoleMessages.push(`ERROR: ${error.message}`);
      console.log(`[Page Error] ${error.message}`);
    });

    // Navigate to Storybook
    await page.goto("/");
    await page.waitForSelector("#storybook-panel-root", { timeout: 30000 });

    // Wait for initial load
    await page.waitForTimeout(3000);

    console.log("\n=== INITIAL STORYBOOK CONSOLE OUTPUT ===");
    consoleMessages.forEach((msg, index) => {
      console.log(`${index + 1}. ${msg}`);
    });
    console.log("=== END INITIAL CONSOLE OUTPUT ===\n");

    // Clear console messages for next test
    consoleMessages.length = 0;

    // Try to find and interact with ChatScreen story
    try {
      // Look for ChatScreen in the sidebar
      const chatScreenLink = page
        .locator(
          'a[href*="chatscreen"], a[href*="chat-screen"], a:has-text("ChatScreen")'
        )
        .first();

      if (await chatScreenLink.isVisible()) {
        console.log("Found ChatScreen story, clicking...");
        await chatScreenLink.click();
        await page.waitForTimeout(2000);

        // Look for input field and send a message
        const inputField = page
          .locator(
            'input[placeholder*="message"], textarea[placeholder*="message"], [data-testid="chat-input"]'
          )
          .first();

        if (await inputField.isVisible()) {
          console.log("Found chat input field, sending test message...");
          await inputField.fill("Show me all open markets");
          await inputField.press("Enter");

          // Wait for API call and response
          await page.waitForTimeout(5000);

          console.log("\n=== CHAT INTERACTION CONSOLE OUTPUT ===");
          consoleMessages.forEach((msg, index) => {
            console.log(`${index + 1}. ${msg}`);
          });
          console.log("=== END CHAT INTERACTION CONSOLE OUTPUT ===\n");
        } else {
          console.log("Chat input field not found");
        }
      } else {
        console.log("ChatScreen story not found in sidebar");
      }
    } catch (error) {
      console.log(`Error interacting with ChatScreen: ${error}`);
    }
  });

  test("should test server connectivity and capture network logs", async ({
    page,
  }) => {
    const consoleMessages: string[] = [];
    const networkRequests: string[] = [];

    page.on("console", msg => {
      consoleMessages.push(`${msg.type()}: ${msg.text()}`);
      console.log(`[Browser Console] ${msg.type()}: ${msg.text()}`);
    });

    page.on("request", request => {
      const requestInfo = `${request.method()} ${request.url()}`;
      networkRequests.push(requestInfo);
      console.log(`[Network Request] ${requestInfo}`);
    });

    page.on("response", response => {
      console.log(`[Network Response] ${response.status()} ${response.url()}`);
    });

    // Navigate to Storybook
    await page.goto("/");
    await page.waitForSelector("#storybook-panel-root", { timeout: 30000 });

    // Test direct API call to server
    console.log("Testing direct API call to server...");

    try {
      const response = await page.evaluate(async () => {
        const result = await fetch("http://localhost:3000/api/query", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ query: "Show me all open markets" }),
        });
        return {
          status: result.status,
          ok: result.ok,
          data: await result.json(),
        };
      });

      console.log("API Response:", response);
    } catch (error) {
      console.log("API call failed:", error);
    }

    console.log("\n=== NETWORK REQUESTS ===");
    networkRequests.forEach((req, index) => {
      console.log(`${index + 1}. ${req}`);
    });
    console.log("=== END NETWORK REQUESTS ===\n");

    console.log("\n=== CONSOLE OUTPUT ===");
    consoleMessages.forEach((msg, index) => {
      console.log(`${index + 1}. ${msg}`);
    });
    console.log("=== END CONSOLE OUTPUT ===\n");
  });
});
