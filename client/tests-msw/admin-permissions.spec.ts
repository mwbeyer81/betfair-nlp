import { test, anonTest, expect } from "./fixtures";
import type { Page } from "@playwright/test";

// The permissions matrix (/admin/permissions), gated on `admin` itself.
//
// As with Data Sources, the gate that matters is the endpoint's 403 — these
// tests drive both answers and check the app responds correctly to each.

const ADMIN_ACCOUNT_ID = "admin-account-id";
const PLAIN_ACCOUNT_ID = "plain-account-id";

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

async function forbidTheEndpoint(page: Page): Promise<void> {
  await page.route("**/api/admin/permissions", (route) =>
    route.fulfill({
      status: 403,
      json: { success: false, error: "Permission required", requiredPermission: "admin" },
    })
  );
}

test.describe("Permissions matrix — admin-only screen (MSW mocked)", () => {
  test("an admin sees the menu item and it opens the screen", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/events");

    const link = page.getByTestId("events-menu-permissions-link");
    await expect(link).toBeVisible({ timeout: 10000 });
    await link.click();

    await expect(page.getByTestId("permissions-screen")).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/permissions$/);
  });

  test("someone without admin gets Admins only, not an error", async ({ page }) => {
    await forbidTheEndpoint(page);
    await page.goto("/admin/permissions");

    await expect(page.getByTestId("permissions-forbidden")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("permissions-error")).toHaveCount(0);
    await expect(page.getByTestId("permissions-matrix")).toHaveCount(0);
  });

  anonTest("signed out, the route falls back to the auth wall", async ({ page }) => {
    await page.context().clearCookies();
    await page.addInitScript(() => window.localStorage.clear());
    await page.goto("/admin/permissions");

    await expect(page.getByTestId("permissions-screen")).toHaveCount(0);
  });

  test("the matrix has a row per account and a column per permission", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/admin/permissions");

    await expect(page.getByTestId("permissions-matrix")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("permissions-column-admin")).toBeVisible();
    await expect(page.getByTestId("permissions-column-data-sources:read")).toBeVisible();
    await expect(page.getByTestId(`permissions-row-${ADMIN_ACCOUNT_ID}`)).toBeVisible();
    // An account with nothing is still a row — the matrix shows who does NOT
    // have access as clearly as who does.
    await expect(page.getByTestId(`permissions-row-${PLAIN_ACCOUNT_ID}`)).toBeVisible();
  });

  // The distinction the matrix exists to make: a ticked cell can mean
  // "granted" or "admin implies it", and those are different facts.
  test("cells distinguish granted from inherited from not held", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/admin/permissions");

    await expect(page.getByTestId(`permissions-cell-${ADMIN_ACCOUNT_ID}-admin`)).toHaveText("●");
    await expect(page.getByTestId(`permissions-cell-${ADMIN_ACCOUNT_ID}-data-sources:read`)).toHaveText("○");
    await expect(page.getByTestId(`permissions-cell-${PLAIN_ACCOUNT_ID}-admin`)).toHaveText("·");
    await expect(page.getByTestId(`permissions-cell-${PLAIN_ACCOUNT_ID}-data-sources:read`)).toHaveText("·");
  });

  test("the signed-in account's own permissions are called out", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/admin/permissions");

    const you = page.getByTestId("permissions-you");
    await expect(you).toBeVisible({ timeout: 10000 });
    await expect(you).toContainText("matthewbeyer@hotmail.com");
    await expect(page.getByTestId("permissions-you-admin")).toContainText("Admin");
    await expect(page.getByTestId("permissions-you-data-sources:read")).toContainText("via admin");
  });

  // Granting must never be possible over HTTP — a grant control here would be
  // the most valuable thing on the site to anyone holding a stolen session.
  test("the screen is read-only and says how granting actually works", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/admin/permissions");

    await expect(page.getByTestId("permissions-grant-note")).toContainText("yarn grant:permission");
    await expect(page.getByRole("button", { name: /grant/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /revoke/i })).toHaveCount(0);
  });

  test("each permission is explained", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/admin/permissions");

    await expect(page.getByTestId("permissions-definition-admin")).toContainText(
      "Implies every other permission"
    );
    await expect(page.getByTestId("permissions-definition-data-sources:read")).toContainText("Kaggle CSV");
  });
});
