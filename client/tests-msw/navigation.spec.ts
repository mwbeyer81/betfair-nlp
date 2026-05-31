import { test, expect } from "./fixtures";

test.describe("Routing — MSW mocked network", () => {
  test("/ resolves to Events view by default", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("events-screen")).toBeVisible({ timeout: 10000 });
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

  test("clicking runners stat navigates to /runners", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("events-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("event-group-loading")).not.toBeVisible({ timeout: 10000 });

    await page.getByTestId("events-total-runners").click();

    await expect(page.getByTestId("all-runners-screen")).toBeVisible({ timeout: 10000 });
    expect(page.url()).toContain("/runners");
  });

  test("← Events button on All Runners screen returns to /events", async ({ page }) => {
    await page.goto("/runners");
    await expect(page.getByTestId("all-runners-screen")).toBeVisible({ timeout: 10000 });

    await page.getByTestId("all-runners-screen-events-button").click();

    await expect(page.getByTestId("events-screen")).toBeVisible({ timeout: 5000 });
    expect(page.url()).toMatch(/\/events/);
  });

  test("Chat → button on Events screen navigates to /chat", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("events-screen")).toBeVisible({ timeout: 10000 });

    await page.getByTestId("events-screen-chat-button").click();

    await expect(page.getByTestId("chat-screen")).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId("events-screen")).not.toBeVisible();
  });

  test("← Events button on Chat screen navigates back to /events", async ({ page }) => {
    await page.goto("/chat");
    await expect(page.getByTestId("chat-screen")).toBeVisible({ timeout: 10000 });

    await page.getByTestId("events-button").click();

    await expect(page.getByTestId("events-screen")).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId("chat-screen")).not.toBeVisible();
  });

  test("URL updates to /chat after navigation", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("events-screen")).toBeVisible({ timeout: 10000 });

    await page.getByTestId("events-screen-chat-button").click();
    await expect(page.getByTestId("chat-screen")).toBeVisible({ timeout: 5000 });

    expect(page.url()).toContain("/chat");
  });

  test("URL updates to /events after navigating back", async ({ page }) => {
    await page.goto("/chat");
    await expect(page.getByTestId("chat-screen")).toBeVisible({ timeout: 10000 });

    await page.getByTestId("events-button").click();
    await expect(page.getByTestId("events-screen")).toBeVisible({ timeout: 5000 });

    expect(page.url()).toMatch(/\/events/);
  });

  test("browser back button restores previous route", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("events-screen")).toBeVisible({ timeout: 10000 });

    await page.getByTestId("events-screen-chat-button").click();
    await expect(page.getByTestId("chat-screen")).toBeVisible({ timeout: 5000 });

    await page.goBack();
    await expect(page.getByTestId("events-screen")).toBeVisible({ timeout: 5000 });
  });
});
