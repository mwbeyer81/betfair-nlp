import { test, expect, request as pwRequest } from "@playwright/test";

const APP_URL = "https://app.backbet.co.uk";
const LAMBDA_URL = "https://fd0xrhcmj0.execute-api.eu-north-1.amazonaws.com";
const LAMBDA_HOST = "fd0xrhcmj0.execute-api.eu-north-1.amazonaws.com";

// Logs into the real Lambda API directly, so we can inject a genuinely valid
// token and drive the app as an already-authenticated user.
async function fetchRealToken(): Promise<string> {
  const ctx = await pwRequest.newContext();
  const response = await ctx.post(`${LAMBDA_URL}/api/auth/login`, {
    data: { username: "matthew", password: "beyer" },
  });
  const body = await response.json();
  await ctx.dispose();
  return body.token as string;
}

test.describe("app.backbet.co.uk — 'Failed to load runners' regression test", () => {
  // Regression guard for a bug where the deployed client's baseUrl silently
  // fell back to same-origin (instead of the Lambda API), causing every
  // /api/* call to hit CloudFront's SPA fallback (index.html, 200, text/html)
  // instead of real JSON — surfacing as "Failed to load runners".
  test("authenticated user sees real runner data at /runners, not an error", async ({
    page,
  }) => {
    const token = await fetchRealToken();
    await page.addInitScript((t) => {
      window.localStorage.setItem("auth_token", t);
    }, token);

    await page.goto(`${APP_URL}/runners`);

    await expect(page.getByTestId("all-runners-screen")).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText("Failed to load runners")).not.toBeVisible();
    await expect(page.getByTestId("all-runners-error")).not.toBeVisible();
    // Confirms real data rendered, not just an empty/loading shell.
    await expect(page.getByText(/\d+ runners/).first()).toBeVisible({
      timeout: 15000,
    });
  });

  // Diagnostic: the deployed JS bundle must have EXPO_PUBLIC_API_URL inlined
  // to the Lambda origin at build time. If the env var isn't statically
  // inlined (e.g. via an optional-chaining `process.env?.X` read that Metro's
  // inliner can't recognize), the client falls back to same-origin requests,
  // which CloudFront can't fulfil since it has no /api/* origin.
  test("diagnostic: deployed bundle has the Lambda API URL inlined", async ({
    request,
  }) => {
    const indexResponse = await request.get(`${APP_URL}/`);
    const html = await indexResponse.text();
    const bundleMatch = html.match(/_expo\/static\/js\/web\/[a-zA-Z0-9._-]+\.js/);
    expect(bundleMatch, "couldn't find the web JS bundle path in index.html").not.toBeNull();

    const bundleResponse = await request.get(`${APP_URL}/${bundleMatch![0]}`);
    const bundleJs = await bundleResponse.text();
    expect(
      bundleJs,
      "the deployed bundle doesn't reference the Lambda API host — " +
        "EXPO_PUBLIC_API_URL likely wasn't inlined at build time, so the app " +
        "falls back to same-origin requests that CloudFront can't serve"
    ).toContain(LAMBDA_HOST);
  });

  // Baseline sanity check: the backend itself works fine when hit directly.
  test("diagnostic: GET /api/runners against the Lambda API directly returns JSON", async ({
    request,
  }) => {
    const token = await fetchRealToken();
    const response = await request.get(
      `${LAMBDA_URL}/api/runners?page=1&limit=5&minRunners=1&maxRunners=20&minBsp=1&maxBsp=1000&sort=asc&minInSp=1&maxInSp=30&fromRow=1`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    expect(response.headers()["content-type"] ?? "").toContain("application/json");
    expect(response.ok()).toBe(true);
  });
});
