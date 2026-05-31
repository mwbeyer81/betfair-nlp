import { test, expect } from "./fixtures";

test.describe("Events view — MSW mocked network", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // Wait for MSW service worker to activate and events to load
    await expect(page.getByTestId("events-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("event-group-loading")).not.toBeVisible({ timeout: 10000 });
  });

  test("lands on events screen by default", async ({ page }) => {
    await expect(page.getByTestId("events-screen")).toBeVisible();
    expect(page.url()).toMatch(/\/(\?|$)/); // root or /events
  });

  test("shows mocked event groups", async ({ page }) => {
    await expect(page.getByTestId("event-group-item-33858191")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Cheltenham 1st Jan")).toBeVisible();
    await expect(page.getByTestId("event-group-item-33988522")).toBeVisible();
    await expect(page.getByText("Leopardstown 1st Feb")).toBeVisible();
  });

  test("shows stats bar with mocked counts", async ({ page }) => {
    await expect(page.getByTestId("events-stats-bar")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("events-total-runners")).toContainText("109 runners");
    await expect(page.getByTestId("events-total-races")).toContainText("8 races");
  });

  test("all three badges visible per event", async ({ page }) => {
    await expect(page.getByTestId("event-docs-badge-33858191")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("event-runners-badge-33858191")).toBeVisible();
    await expect(page.getByTestId("event-price-updates-badge-33858191")).toBeVisible();
  });

  test("clicking Runners badge opens runners panel with mocked data", async ({ page }) => {
    await page.getByTestId("event-runners-badge-33858191").click();

    await expect(page.getByTestId("runners-panel")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("runners-loading")).not.toBeVisible({ timeout: 10000 });

    // Mocked runners
    await expect(page.getByText("Springwell Bay")).toBeVisible();
    await expect(page.getByText("Gaelic Warrior")).toBeVisible();
  });

  test("clicking Price Updates badge opens price updates panel with mocked data", async ({ page }) => {
    await page.getByTestId("event-price-updates-badge-33858191").click();

    await expect(page.getByTestId("price-updates-panel")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("price-updates-loading")).not.toBeVisible({ timeout: 10000 });

    await expect(page.getByTestId("price-update-item-0")).toBeVisible({ timeout: 10000 });
  });

  test("runners panel close button dismisses it", async ({ page }) => {
    await page.getByTestId("event-runners-badge-33858191").click();
    await expect(page.getByTestId("runners-panel")).toBeVisible({ timeout: 10000 });

    await page.getByTestId("runners-panel-close").click();
    await expect(page.getByTestId("runners-panel")).not.toBeVisible();
  });

  test("clicking a runner opens its price updates panel", async ({ page }) => {
    await page.getByTestId("event-runners-badge-33858191").click();
    await expect(page.getByTestId("runners-loading")).not.toBeVisible({ timeout: 10000 });

    const firstRunner = page.locator('[data-testid^="runner-item-"]').first();
    await expect(firstRunner).toBeVisible({ timeout: 10000 });
    await firstRunner.click();

    await expect(page.getByTestId("price-updates-panel")).toBeVisible({ timeout: 10000 });
  });
});
