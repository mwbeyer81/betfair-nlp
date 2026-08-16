import { test, expect } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";

// Post-deploy sanity check for the permission model, the Data Sources screen
// and the permissions matrix, against the REAL deployed stack — the Lambda
// API and the app.backbet.co.uk bundle, not a local build.
//
// Run:
//   cd client && npx playwright test --config playwright.live.config.ts \
//     tests-live/admin-data-sources-live.spec.ts
//
// Everything below the "admin half" runs with no credentials beyond the
// long-standing shared test account, which is deliberately NOT an admin —
// so the checks that matter most (a real user is refused, and refused with
// a 403 rather than an error page) always run.
//
// The admin half needs a real admin login. Pass it in rather than hardcoding
// it, since the admin account is a person's own:
//   ADMIN_EMAIL=... ADMIN_PASSWORD=... npx playwright test ...
// Without those vars those tests skip loudly rather than silently passing.

const API = "https://6fj7nh9mw6.execute-api.eu-west-2.amazonaws.com";
const BASE_URL = "https://app.backbet.co.uk";
const DATA_SOURCES = `${API}/api/admin/data-sources`;
const PERMISSIONS = `${API}/api/admin/permissions`;

// The shared non-admin account the other live specs already use.
const USER_EMAIL = "matthew@backbet.co.uk";
const USER_PASSWORD = "beyer";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL?.trim();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD?.trim();
const HAVE_ADMIN_CREDS = Boolean(ADMIN_EMAIL && ADMIN_PASSWORD);

async function login(request: APIRequestContext, email: string, password: string): Promise<string> {
  const res = await request.post(`${API}/api/auth/login`, { data: { email, password } });
  expect(res.status(), `login failed for ${email}`).toBe(200);
  const body = await res.json();
  expect(body.token, `no token returned for ${email}`).toBeTruthy();
  return body.token as string;
}

test.describe("permissions — live API", () => {
  test("both admin endpoints 401 with no token", async ({ request }) => {
    expect((await request.get(DATA_SOURCES)).status()).toBe(401);
    expect((await request.get(PERMISSIONS)).status()).toBe(401);
  });

  test("a valid token from an account without the permission is refused with 403", async ({ request }) => {
    const token = await login(request, USER_EMAIL, USER_PASSWORD);

    const res = await request.get(DATA_SOURCES, { headers: { Authorization: `Bearer ${token}` } });

    // 403, not 401 and not 500: the caller is authenticated, the route
    // exists, and the refusal is the permission working rather than an
    // outage. A 401 here would send them back to a login that cannot help.
    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Permission required");
    // The response names the key that was missing, so the caller knows what
    // to ask for rather than just "admin".
    expect(body.requiredPermission).toBe("data-sources:read");
  });

  test("the permissions matrix is refused to a non-admin", async ({ request }) => {
    const token = await login(request, USER_EMAIL, USER_PASSWORD);

    const res = await request.get(PERMISSIONS, { headers: { Authorization: `Bearer ${token}` } });

    expect(res.status()).toBe(403);
    expect((await res.json()).requiredPermission).toBe("admin");
  });

  test("/api/auth/me reports an empty permission list for that account", async ({ request }) => {
    const token = await login(request, USER_EMAIL, USER_PASSWORD);

    const res = await request.get(`${API}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status()).toBe(200);
    const body = await res.json();
    // Present and empty — not absent. The client defaults an absent field to
    // "holds nothing", so an absent one would mean the deployed API predates
    // this feature rather than that the account holds nothing.
    expect(body).toHaveProperty("permissions");
    expect(body.permissions).toEqual([]);
    expect(body.isAdmin).toBe(false);
  });

  test("the admin account holds admin and can read the comparison", async ({ request }) => {
    test.skip(!HAVE_ADMIN_CREDS, "set ADMIN_EMAIL and ADMIN_PASSWORD to run the admin half");
    const token = await login(request, ADMIN_EMAIL!, ADMIN_PASSWORD!);

    const me = await request.get(`${API}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(me.status()).toBe(200);
    const meBody = await me.json();
    expect(meBody.isAdmin).toBe(true);
    // admin implies data-sources:read, so both come back expanded.
    expect(meBody.permissions).toEqual(["admin", "data-sources:read"]);

    const res = await request.get(DATA_SOURCES, { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    // Shape checks, not content checks — the analysis will be edited over
    // time, but a payload that lost its rows or its verdicts would be a
    // deploy problem, not an edit.
    expect(body.data.fields).toHaveLength(37);
    expect(body.data.commentMeanings).toHaveLength(4);
    body.data.fields.forEach((f: { verdict: string; note: string }) => {
      expect(["same", "caution", "different"]).toContain(f.verdict);
      expect(f.note.length).toBeGreaterThan(0);
    });
    expect(
      body.data.fields.filter((f: { results: string | null }) => f.results === null).map((f: { csv: string }) => f.csv)
    ).toEqual(["ran"]);
  });

  test("the permissions matrix lists the admin account as the only holder", async ({ request }) => {
    test.skip(!HAVE_ADMIN_CREDS, "set ADMIN_EMAIL and ADMIN_PASSWORD to run the admin half");
    const token = await login(request, ADMIN_EMAIL!, ADMIN_PASSWORD!);

    const res = await request.get(PERMISSIONS, { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status()).toBe(200);

    const { permissions, accounts } = (await res.json()).data;
    expect(permissions.map((p: { key: string }) => p.key)).toEqual(["admin", "data-sources:read"]);

    // Every account is a row, and exactly one of them is the caller.
    expect(accounts.length).toBeGreaterThan(1);
    expect(accounts.filter((a: { isYou: boolean }) => a.isYou)).toHaveLength(1);

    const holders = accounts.filter((a: { effective: string[] }) => a.effective.includes("admin"));
    expect(holders.map((a: { email: string }) => a.email)).toEqual([ADMIN_EMAIL]);
  });
});

test.describe("Data Sources screen — live app", () => {
  // The deployed bundle uses ?email=&password= bookmarked login (App.tsx), the
  // same mechanism every other live spec here relies on.
  const bookmarked = (path: string, email: string, password: string) =>
    `${BASE_URL}${path}?email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`;

  test("a non-admin gets the Admins only state, not an error", async ({ page }) => {
    await page.goto(bookmarked("/admin/data-sources", USER_EMAIL, USER_PASSWORD));

    await expect(page.getByTestId("data-sources-forbidden")).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId("data-sources-error")).toHaveCount(0);
    await expect(page.getByTestId("data-sources-fields")).toHaveCount(0);
  });

  test("a non-admin is not offered the menu item", async ({ page }) => {
    await page.goto(bookmarked("/isp", USER_EMAIL, USER_PASSWORD));

    // The Industry SP screen namespaces its header testIDs with
    // `industry-sp`, not `isp` (AppHeader's testIdPrefix, IndustrySpScreen.tsx).
    await expect(page.getByTestId("industry-sp-menu-isp-link").first()).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId("industry-sp-menu-data-sources-link")).toHaveCount(0);
  });

  test("an admin sees the comparison render", async ({ page }) => {
    test.skip(!HAVE_ADMIN_CREDS, "set ADMIN_EMAIL and ADMIN_PASSWORD to run the admin half");
    await page.goto(bookmarked("/admin/data-sources", ADMIN_EMAIL!, ADMIN_PASSWORD!));

    await expect(page.getByTestId("data-sources-screen")).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId("data-sources-fields")).toBeVisible();
    await expect(page.getByTestId("data-sources-forbidden")).toHaveCount(0);
    // The finding the screen exists for — if this is missing, the deployed
    // bundle rendered but the payload didn't.
    await expect(page.getByTestId("data-sources-comment")).toContainText("PRE-race analyst preview");
  });

  test("an admin sees the permissions matrix", async ({ page }) => {
    test.skip(!HAVE_ADMIN_CREDS, "set ADMIN_EMAIL and ADMIN_PASSWORD to run the admin half");
    await page.goto(bookmarked("/admin/permissions", ADMIN_EMAIL!, ADMIN_PASSWORD!));

    await expect(page.getByTestId("permissions-screen")).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId("permissions-matrix")).toBeVisible();
    await expect(page.getByTestId("permissions-you")).toContainText(ADMIN_EMAIL!);
    // Read-only: no grant control may exist on a deployed build either.
    await expect(page.getByRole("button", { name: /grant/i })).toHaveCount(0);
  });

  test("a non-admin gets Admins only on the permissions matrix", async ({ page }) => {
    await page.goto(bookmarked("/admin/permissions", USER_EMAIL, USER_PASSWORD));

    await expect(page.getByTestId("permissions-forbidden")).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId("permissions-matrix")).toHaveCount(0);
  });
});
