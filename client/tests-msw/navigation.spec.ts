import { test, expect } from "./fixtures";

test.describe("Routing — MSW mocked network", () => {
  test("/ resolves to Industry SP view by default", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("events-screen")).not.toBeVisible();
    await expect(page.getByTestId("chat-screen")).not.toBeVisible();
  });

  test("/events shows Events view", async ({ page }) => {
    await page.goto("/events");
    await expect(page.getByTestId("events-screen")).toBeVisible({ timeout: 10000 });
  });

  test("/chat shows Chat view", async ({ page }) => {
    await page.goto("/chat");
    await expect(page.getByTestId("chat-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("events-screen")).not.toBeVisible();
  });

  test("/runners shows All Runners view", async ({ page }) => {
    await page.goto("/runners");
    await expect(page.getByTestId("all-runners-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("events-screen")).not.toBeVisible();
  });

  test("Chat → button on Events screen navigates to /chat", async ({ page }) => {
    await page.goto("/events");
    await expect(page.getByTestId("events-screen")).toBeVisible({ timeout: 10000 });

    await page.getByTestId("events-menu-chat-link").click();

    await expect(page.getByTestId("chat-screen")).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId("events-screen")).not.toBeVisible();
  });

  test("URL updates to /chat after navigation", async ({ page }) => {
    await page.goto("/events");
    await expect(page.getByTestId("events-screen")).toBeVisible({ timeout: 10000 });

    await page.getByTestId("events-menu-chat-link").click();
    await expect(page.getByTestId("chat-screen")).toBeVisible({ timeout: 5000 });

    expect(page.url()).toContain("/chat");
  });

  test("browser back button restores previous route", async ({ page }) => {
    await page.goto("/events");
    await expect(page.getByTestId("events-screen")).toBeVisible({ timeout: 10000 });

    await page.getByTestId("events-menu-chat-link").click();
    await expect(page.getByTestId("chat-screen")).toBeVisible({ timeout: 5000 });

    await page.goBack();
    await expect(page.getByTestId("events-screen")).toBeVisible({ timeout: 5000 });
  });

  test("Industry SP link in the burger menu on Events screen navigates to /isp", async ({ page }) => {
    await page.goto("/events");
    await expect(page.getByTestId("events-screen")).toBeVisible({ timeout: 10000 });

    await page.getByTestId("events-menu-isp-link").click();

    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
    expect(page.url()).toContain("/isp");
  });

  // /model-experiments has to be added to BOTH the Route union AND
  // STATIC_ROUTES in useRouter.ts. pathToRoute silently falls back to "/isp"
  // for anything missing from the second, so a half-added route is a broken
  // link rather than a type error — this test is what catches that.
  test("Model Experiments link in the burger menu navigates to /model-experiments", async ({ page }) => {
    await page.goto("/events");
    await expect(page.getByTestId("events-screen")).toBeVisible({ timeout: 10000 });

    await page.getByTestId("events-menu-model-experiments-link").click();

    await expect(page.getByTestId("model-experiments-screen")).toBeVisible({ timeout: 10000 });
    expect(page.url()).toContain("/model-experiments");
  });

  // Industry SP (home) no longer links out to Events, Chat, or Runners —
  // those pages are hidden (still reachable by URL, still behind login)
  // but not linked from the public home page.
  test("Industry SP (home) screen has no nav link to /events", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });

    await expect(page.getByTestId("industry-sp-screen-events-button")).not.toBeVisible();
    // The fixture's default session is authenticated, so the header shows
    // Log Out rather than Sign Up/Log In — either way, no Events link.
    await expect(page.getByTestId("industry-sp-logout-button")).toBeVisible();
  });
});
