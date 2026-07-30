import { test, expect } from "@playwright/test";

// Real browser, real frontend build, real backend, real (throwaway) Mongo —
// no mocking anywhere. Mirrors the auth/navigation conventions of
// client/tests/industry-sp-e2e.spec.ts (the ?email=&password= URL-login
// pattern is the current working mechanism; some older docs/specs reference
// a stale Basic-auth/auth-login-button convention that no longer matches
// AuthScreen.tsx).
const APP_URL = "http://localhost:8090/";

async function gotoIspRacesForNottingham(page: import("@playwright/test").Page) {
  await page.goto(`${APP_URL}isp/races?email=matthew%40backbet.co.uk&password=beyer&courses=Nottingham`);
  await expect(page.getByTestId("industry-sp-races-screen")).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 30000 });
}

test.describe("Industry SP races screen against the seeded slice (real frontend + backend)", () => {
  test("meeting header shows the seeded Nottingham meeting", async ({ page }) => {
    await gotoIspRacesForNottingham(page);
    const meeting = page.locator('[data-testid="industry-sp-meeting-Nottingham|2026-06-03"]');
    await expect(meeting).toBeVisible({ timeout: 15000 });
    await expect(meeting).toContainText("Nottingham — 3 June 2026");
  });

  test("drilling into the race shows the seeded winner with correct ISP", async ({ page }) => {
    await gotoIspRacesForNottingham(page);
    await page.getByTestId("industry-sp-race-919979").click();
    await expect(page.getByTestId("industry-race-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-race-loading")).not.toBeVisible({ timeout: 15000 });
    await expect(page.getByText("The Ginger Kid (IRE)")).toBeVisible();
    await expect(page.getByText("ISP 20/1")).toBeVisible();
  });
});
