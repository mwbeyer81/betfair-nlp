import { test, expect } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";

// Post-deploy sanity check for the admin permission and the Data Sources
// screen, against the REAL deployed stack — the Lambda API and the
// app.backbet.co.uk bundle, not a local build.
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
const ENDPOINT = `${API}/api/admin/data-sources`;

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

test.describe("admin permission — live API", () => {
  test("the endpoint 401s with no token", async ({ request }) => {
    const res = await request.get(ENDPOINT);
    expect(res.status()).toBe(401);
  });

  test("a valid token from a non-admin account is refused with 403", async ({ request }) => {
    const token = await login(request, USER_EMAIL, USER_PASSWORD);

    const res = await request.get(ENDPOINT, { headers: { Authorization: `Bearer ${token}` } });

    // 403, not 401 and not 500: the caller is authenticated, the route
    // exists, and the refusal is the permission working rather than an
    // outage. A 401 here would send them back to a login that cannot help.
    expect(res.status()).toBe(403);
    expect((await res.json()).error).toBe("Admin access required");
  });

  test("/api/auth/me reports isAdmin: false for the non-admin account", async ({ request }) => {
    const token = await login(request, USER_EMAIL, USER_PASSWORD);

    const res = await request.get(`${API}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status()).toBe(200);
    const body = await res.json();
    // Present and false — not absent. The client reads it as `=== true`, so
    // an absent field would mean the deployed API predates this feature.
    expect(body).toHaveProperty("isAdmin");
    expect(body.isAdmin).toBe(false);
  });

  test("the admin account is flagged and can read the comparison", async ({ request }) => {
    test.skip(!HAVE_ADMIN_CREDS, "set ADMIN_EMAIL and ADMIN_PASSWORD to run the admin half");
    const token = await login(request, ADMIN_EMAIL!, ADMIN_PASSWORD!);

    const me = await request.get(`${API}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(me.status()).toBe(200);
    expect((await me.json()).isAdmin).toBe(true);

    const res = await request.get(ENDPOINT, { headers: { Authorization: `Bearer ${token}` } });
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
});
