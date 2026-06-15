import { test, expect } from "@playwright/test";

const APP_URL = "http://localhost:80/";

test.describe("Event Groups feature (Expo web @ localhost:80)", () => {
  test("app loads directly into the Events view", async ({ page }) => {
    await page.goto(APP_URL);
    await expect(page.getByTestId("events-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("chat-screen")).not.toBeVisible();
  });

  test("Events view shows event group rows after loading", async ({ page }) => {
    await page.goto(APP_URL);
    await expect(page.getByTestId("event-group-loading")).not.toBeVisible({ timeout: 15000 });

    const items = page.locator('[data-testid^="event-group-item-"]');
    await expect(items.first()).toBeVisible({ timeout: 10000 });
    expect(await items.count()).toBeGreaterThan(0);
  });

  test("stats bar shows total runners and races", async ({ page }) => {
    await page.goto(APP_URL);
    await expect(page.getByTestId("events-stats-bar")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("events-total-runners")).toBeVisible();
    await expect(page.getByTestId("events-total-races")).toBeVisible();
  });

  test("Chat → button navigates to chat view", async ({ page }) => {
    await page.goto(APP_URL);
    await expect(page.getByTestId("events-screen")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("events-screen-chat-button").click();
    await expect(page.getByTestId("chat-screen")).toBeVisible({ timeout: 5000 });
  });

  test("← Events button in chat view navigates back to events", async ({ page }) => {
    await page.goto(`${APP_URL}chat`);
    await expect(page.getByTestId("chat-screen")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("events-button").click();
    await expect(page.getByTestId("events-screen")).toBeVisible({ timeout: 5000 });
  });
});
