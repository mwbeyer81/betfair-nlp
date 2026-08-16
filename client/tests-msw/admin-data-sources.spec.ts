import { test, anonTest, expect } from "./fixtures";
import type { Page } from "@playwright/test";

// Admin-only Data Sources screen (the Kaggle CSV vs RacingAPI comparison).
//
// The permission that matters is server-side — GET /api/admin/data-sources
// 403s for a non-admin — so these tests drive the two answers that endpoint
// can give and check the app responds correctly to each. Hiding the menu item
// is presentation on top of that, covered here too but not mistaken for the
// gate itself.

async function signInAsAdmin(page: Page): Promise<void> {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        success: true,
        email: "matthewbeyer@hotmail.com",
        emailVerified: true,
        permissions: ["admin", "data-sources:read"],
        isAdmin: true,
      },
    })
  );
}

// Holds the specific permission and nothing else — the case that proves the
// Data Sources item is gated on `data-sources:read`, not on being an admin.
async function signInAsReader(page: Page): Promise<void> {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        success: true,
        email: "reader@backbet.co.uk",
        emailVerified: true,
        permissions: ["data-sources:read"],
        isAdmin: false,
      },
    })
  );
}

async function forbidTheEndpoint(page: Page): Promise<void> {
  await page.route("**/api/admin/data-sources", (route) =>
    route.fulfill({
      status: 403,
      json: { success: false, error: "Permission required", requiredPermission: "data-sources:read" },
    })
  );
}

test.describe("Data Sources — admin-only screen (MSW mocked)", () => {
  test("an admin sees the menu item and it opens the screen", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/events");

    const link = page.getByTestId("events-menu-data-sources-link");
    await expect(link).toBeVisible({ timeout: 10000 });
    await link.click();

    await expect(page.getByTestId("data-sources-screen")).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/data-sources$/);
  });

  // The default /api/auth/me mock in fixtures.ts sends no permissions at all,
  // which is also what an older deployed API would send — it must read as
  // "holds nothing", never as "unknown, so show it anyway".
  test("an account with no permissions never sees the menu item", async ({ page }) => {
    await page.goto("/events");

    await expect(page.getByTestId("events-menu-isp-link")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("events-menu-data-sources-link")).toHaveCount(0);
    await expect(page.getByTestId("events-menu-permissions-link")).toHaveCount(0);
  });

  // Data Sources is gated on `data-sources:read`; the matrix is gated on
  // `admin`. A holder of the former gets one item, not both.
  test("a data-sources:read holder gets that item but not Permissions", async ({ page }) => {
    await signInAsReader(page);
    await page.goto("/events");

    await expect(page.getByTestId("events-menu-data-sources-link")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("events-menu-permissions-link")).toHaveCount(0);
  });

  test("someone without the permission who navigates straight to the URL gets Admins only, not an error", async ({ page }) => {
    await forbidTheEndpoint(page);
    await page.goto("/admin/data-sources");

    await expect(page.getByTestId("data-sources-forbidden")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("data-sources-forbidden")).toContainText("Admins only");
    await expect(page.getByTestId("data-sources-error")).toHaveCount(0);
    await expect(page.getByTestId("data-sources-fields")).toHaveCount(0);
  });

  anonTest("signed out, the route falls back to the auth wall", async ({ page }) => {
    await page.context().clearCookies();
    await page.addInitScript(() => window.localStorage.clear());
    await page.goto("/admin/data-sources");

    await expect(page.getByTestId("data-sources-screen")).toHaveCount(0);
  });

  test("every section of the comparison renders", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/admin/data-sources");

    await expect(page.getByTestId("data-sources-screen")).toBeVisible({ timeout: 10000 });
    for (const id of ["intro", "samples", "fields", "comment", "population", "api-only", "normalisation"]) {
      await expect(page.getByTestId(`data-sources-${id}`)).toBeVisible();
    }
  });

  test("a field row expands to show its note", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/admin/data-sources");

    await expect(page.getByTestId("data-sources-field-comment")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("data-sources-field-note-comment")).toHaveCount(0);

    await page.getByTestId("data-sources-field-comment").click();

    await expect(page.getByTestId("data-sources-field-note-comment")).toContainText(
      "Four different meanings"
    );
  });

  test("the verdict filter narrows the table", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/admin/data-sources");

    await expect(page.getByTestId("data-sources-field-date")).toBeVisible({ timeout: 10000 });

    await page.getByTestId("data-sources-filter-different").click();

    await expect(page.getByTestId("data-sources-field-comment")).toBeVisible();
    await expect(page.getByTestId("data-sources-field-date")).toHaveCount(0);
    await expect(page.getByTestId("data-sources-field-or")).toHaveCount(0);
  });

  // The headline finding of the whole comparison, and the reason the screen
  // exists: four things share the name `comment`.
  test("all four meanings of comment are on screen together", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/admin/data-sources");

    const section = page.getByTestId("data-sources-comment");
    await expect(section).toBeVisible({ timeout: 10000 });
    await expect(section).toContainText("PRE-race analyst preview");
    await expect(section).toContainText("post-race in-running commentary");
    await expect(section).toContainText("stewards' notes");
  });
});
