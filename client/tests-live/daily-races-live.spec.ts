import { test, expect } from "@playwright/test";

// Persistent regression guard for the Daily Races feature against the real
// deployed Lambda + web app (no mocking). Confirms the burger-menu entry,
// the screen, and the API route are all actually live together — a code
// deploy succeeding doesn't by itself prove the frontend/backend agree on
// the route shape.
const BASE = "https://app.backbet.co.uk";
const LOGIN_PARAMS = "email=matthew%40backbet.co.uk&password=beyer";

test.describe("daily-races-live", () => {
  test("burger menu link opens Daily Races and it loads without error", async ({ page }) => {
    await page.goto(`${BASE}/events?${LOGIN_PARAMS}`);
    await expect(page.getByTestId("events-screen")).toBeVisible({ timeout: 20000 });

    await page.getByTestId("events-menu-daily-races-link").click();
    await expect(page.getByTestId("daily-races-screen")).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("daily-races-loading")).not.toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("daily-races-error")).not.toBeVisible();
  });
});
