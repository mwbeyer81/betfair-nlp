import { test, expect, Page } from "@playwright/test";

// Load a story iframe directly and wait for it to render.
// Returns the page with the story already mounted.
async function loadStory(page: Page, storyId: string) {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto(`/iframe.html?id=${storyId}&viewMode=story`);

  // Wait for Storybook to show the story (sb-show-main) or an error (sb-show-errordisplay)
  await page.waitForFunction(
    () =>
      document.body.classList.contains("sb-show-main") ||
      document.body.classList.contains("sb-show-errordisplay"),
    { timeout: 15000 }
  );

  // No uncaught JS errors
  expect(errors, `JS errors in story ${storyId}: ${errors.join(", ")}`).toHaveLength(0);

  // Storybook must be in main-show state (story rendered), not error state
  const hasError = await page.evaluate(() =>
    document.body.classList.contains("sb-show-errordisplay")
  );
  expect(hasError, `Story ${storyId} threw a render error`).toBe(false);

  return page;
}

// ── Storybook UI ─────────────────────────────────────────────────────────────

test.describe("Storybook UI", () => {
  test("sidebar loads and shows component stories", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("#storybook-explorer-tree", { timeout: 20000 });

    // Key components appear in the sidebar
    for (const name of [
      "EventGroupsPanel",
      "RunnersPanel",
      "AllRunnersPanel",
      "EventDocsPanel",
      "AuthScreen",
      "ChatInput",
    ]) {
      await expect(
        page.locator(`[data-item-id*="${name.toLowerCase()}"]`).first()
      ).toBeAttached();
    }
  });
});

// ── EventGroupsPanel ──────────────────────────────────────────────────────────

test.describe("EventGroupsPanel stories", () => {
  test("Default — panel and event items render", async ({ page }) => {
    await loadStory(page, "components-eventgroupspanel--default");
    await expect(page.getByTestId("events-panel")).toBeVisible();
    await expect(page.getByTestId("event-group-list")).toBeVisible();
    await expect(page.getByTestId("event-group-item-33858191")).toBeVisible();
    await expect(page.getByTestId("event-group-item-33928245")).toBeVisible();
  });

  test("Loading — spinner visible, list absent", async ({ page }) => {
    await loadStory(page, "components-eventgroupspanel--loading");
    await expect(page.getByTestId("event-group-loading")).toBeVisible();
    await expect(page.getByTestId("event-group-list")).not.toBeVisible();
  });

  test("Empty — panel renders with no items", async ({ page }) => {
    await loadStory(page, "components-eventgroupspanel--empty");
    await expect(page.getByTestId("events-panel")).toBeVisible();
    await expect(page.getByTestId("event-group-list")).toBeVisible();
  });

  test("WithError — error message visible", async ({ page }) => {
    await loadStory(page, "components-eventgroupspanel--with-error");
    await expect(page.getByTestId("event-group-error")).toBeVisible();
    await expect(page.getByText("Failed to load events")).toBeVisible();
  });
});

// ── RunnersPanel ──────────────────────────────────────────────────────────────

test.describe("RunnersPanel stories", () => {
  test("Default — panel and runner list render", async ({ page }) => {
    await loadStory(page, "components-runnerspanel--default");
    await expect(page.getByTestId("runners-panel")).toBeVisible();
    await expect(page.getByTestId("runners-list")).toBeVisible();
  });

  test("Loading — loading indicator visible", async ({ page }) => {
    await loadStory(page, "components-runnerspanel--loading");
    await expect(page.getByTestId("runners-loading")).toBeVisible();
  });

  test("WithError — error view visible", async ({ page }) => {
    await loadStory(page, "components-runnerspanel--with-error");
    await expect(page.getByTestId("runners-error")).toBeVisible();
  });
});

// ── AllRunnersPanel ───────────────────────────────────────────────────────────

test.describe("AllRunnersPanel stories", () => {
  test("Default — panel renders with runner data", async ({ page }) => {
    await loadStory(page, "components-allrunnerspanel--default");
    await expect(page.getByTestId("all-runners-panel")).toBeVisible();
  });

  test("Loading — loading indicator visible", async ({ page }) => {
    await loadStory(page, "components-allrunnerspanel--loading");
    await expect(page.getByTestId("all-runners-panel")).toBeVisible();
    await expect(page.getByTestId("all-runners-loading")).toBeVisible();
  });

  test("WithError — error view visible", async ({ page }) => {
    await loadStory(page, "components-allrunnerspanel--with-error");
    await expect(page.getByTestId("all-runners-error")).toBeVisible();
  });
});

// ── EventDocsPanel ────────────────────────────────────────────────────────────

test.describe("EventDocsPanel stories", () => {
  test("Default — panel and docs list render", async ({ page }) => {
    await loadStory(page, "components-eventdocspanel--default");
    await expect(page.getByTestId("event-docs-panel")).toBeVisible();
    await expect(page.getByTestId("event-docs-list")).toBeVisible();
  });

  test("Loading — loading indicator visible", async ({ page }) => {
    await loadStory(page, "components-eventdocspanel--loading");
    await expect(page.getByTestId("event-docs-loading")).toBeVisible();
  });

  test("WithError — error view visible", async ({ page }) => {
    await loadStory(page, "components-eventdocspanel--with-error");
    await expect(page.getByTestId("event-docs-error")).toBeVisible();
  });
});

// ── AuthScreen ────────────────────────────────────────────────────────────────

test.describe("AuthScreen stories", () => {
  test("Default — login form renders", async ({ page }) => {
    await loadStory(page, "components-authscreen--default");
    await expect(page.getByTestId("auth-email-input")).toBeVisible();
    await expect(page.getByTestId("auth-password-input")).toBeVisible();
    await expect(page.getByTestId("auth-login-button")).toBeVisible();
  });
});

// ── ChatInput ─────────────────────────────────────────────────────────────────

test.describe("ChatInput stories", () => {
  test("Default — input and send button render", async ({ page }) => {
    await loadStory(page, "components-chatinput--default");
    await expect(page.getByTestId("chat-input")).toBeVisible();
    await expect(page.getByTestId("message-input")).toBeVisible();
    await expect(page.getByTestId("send-button")).toBeVisible();
  });

  test("Loading — send button disabled while loading", async ({ page }) => {
    await loadStory(page, "components-chatinput--loading");
    await expect(page.getByTestId("chat-input")).toBeVisible();
    await expect(page.getByTestId("send-button")).toBeDisabled();
  });
});
