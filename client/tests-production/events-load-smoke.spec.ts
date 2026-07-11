import { test, expect } from "@playwright/test";

const BASE_URL = "https://backbet.co.uk";

// Builds a JWT-shaped (but unsigned) token that passes the client's local
// `isTokenExpired` check in App.tsx, so we can simulate an already
// logged-in user without depending on a working /api/auth/login.
function fakeToken(): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" })
  ).toString("base64");
  const payload = Buffer.from(
    JSON.stringify({ sub: "matthew", exp: Math.floor(Date.now() / 1000) + 3600 })
  ).toString("base64");
  return `${header}.${payload}.fakesig`;
}

test.describe("backbet.co.uk — 'Failed to load events' smoke test", () => {
  // Reproduces the reported bug directly: an already-authenticated browser
  // (valid token in localStorage) hits the events screen and sees the error.
  test("authenticated user sees 'Failed to load events'", async ({ page }) => {
    await page.addInitScript((token) => {
      window.localStorage.setItem("auth_token", token);
    }, fakeToken());

    await page.goto(`${BASE_URL}/`);

    await expect(page.getByTestId("event-group-error")).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText("Failed to load events")).toBeVisible();
  });

  // Diagnostic: the events endpoint should return JSON from a real API.
  // If this returns the SPA's index.html instead, `response.json()` throws
  // in EventsScreen's fetch handler, which is exactly what surfaces as
  // "Failed to load events" in the UI above.
  test("diagnostic: GET /api/events/grouped should return JSON, not the SPA fallback", async ({
    request,
  }) => {
    const response = await request.get(
      `${BASE_URL}/api/events/grouped?page=1&limit=5`
    );
    const contentType = response.headers()["content-type"] ?? "";
    expect(
      contentType,
      "got the static site's index.html instead of a JSON API response — " +
        "no backend appears to be wired up behind this domain"
    ).toContain("application/json");
  });

  // Diagnostic: a static-only host (e.g. Cloudflare Pages serving just the
  // built client) answers POST with 405 since it only serves GET/HEAD.
  // A real API should accept this and return a JSON auth error/token.
  test("diagnostic: POST /api/auth/login should be handled by an API, not rejected with 405", async ({
    request,
  }) => {
    const response = await request.post(`${BASE_URL}/api/auth/login`, {
      data: { username: "matthew", password: "beyer" },
    });
    expect(
      response.status(),
      "405 Method Not Allowed on POST strongly suggests this origin is a " +
        "static file host with no backend, not the Express/Lambda API"
    ).not.toBe(405);
  });
});
