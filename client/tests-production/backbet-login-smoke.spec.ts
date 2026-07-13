import { test, expect } from "@playwright/test";

const BASE_URL = "https://backbet.co.uk";
const LAMBDA_HOST = "fd0xrhcmj0.execute-api.eu-north-1.amazonaws.com";

test.describe("backbet.co.uk — login regression test", () => {
  // Reproduces the reported bug directly: drive the real login form with
  // matthew/beyer and confirm the app actually authenticates and navigates
  // to the events screen, instead of silently staying on the login form.
  test("logging in with matthew/beyer reaches the events screen", async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/`);

    await page.getByTestId("auth-username-input").fill("matthew");
    await page.getByTestId("auth-password-input").fill("beyer");
    await page.getByTestId("auth-login-button").click();

    await expect(page.getByTestId("events-screen")).toBeVisible({
      timeout: 15000,
    });
  });

  // Diagnostic: the deployed JS bundle must have EXPO_PUBLIC_API_URL inlined
  // to the Lambda origin at build time, same as the app.backbet.co.uk bug —
  // this Cloudflare Pages project (backbet-web-cf) serves both domains from
  // the same build output, so a stale/broken build affects both.
  test("diagnostic: deployed bundle has the Lambda API URL inlined", async ({
    request,
  }) => {
    const indexResponse = await request.get(`${BASE_URL}/`);
    const html = await indexResponse.text();
    const bundleMatch = html.match(/_expo\/static\/js\/web\/[a-zA-Z0-9._-]+\.js/);
    expect(bundleMatch, "couldn't find the web JS bundle path in index.html").not.toBeNull();

    const bundleResponse = await request.get(`${BASE_URL}/${bundleMatch![0]}`);
    const bundleJs = await bundleResponse.text();
    expect(
      bundleJs,
      "the deployed bundle doesn't reference the Lambda API host — " +
        "EXPO_PUBLIC_API_URL likely wasn't inlined at build time, so login " +
        "posts to same-origin (Cloudflare Pages, static-only) instead of the Lambda API"
    ).toContain(LAMBDA_HOST);
  });
});
