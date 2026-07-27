import { test, expect } from "./fixtures";

test.describe("Saved Results — MSW mocked network", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/results");
    await expect(page.getByTestId("saved-results-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("saved-results-loading")).not.toBeVisible({ timeout: 10000 });
  });

  test("lists the mocked results", async ({ page }) => {
    await expect(page.getByTestId("saved-results-item-mock-result-1")).toBeVisible();
    await expect(page.getByText("Ascot favourites")).toBeVisible();
    await expect(page.getByTestId("saved-results-item-mock-result-2")).toBeVisible();
    await expect(page.getByText("Nottingham class 1")).toBeVisible();
  });

  test("sort toggle cycles through date/pnl/name", async ({ page }) => {
    const toggle = page.getByTestId("saved-results-sort-toggle");
    await expect(toggle).toContainText("Newest");
    await toggle.click();
    await expect(toggle).toContainText("PnL");
    await toggle.click();
    await expect(toggle).toContainText("Name");
  });

  test("clicking a result opens the detail view showing Split A and Split B separately, matching the live Filters screen", async ({ page }) => {
    // Requested live (screenshot): the saved-result detail view only ever
    // showed one combined number, while the live /isp screen it was saved
    // from always shows Split A and Split B as two independent tests. The
    // saved snapshot must show the same two-split breakdown.
    await page.getByTestId("saved-results-item-mock-result-1").click();
    await expect(page.getByTestId("saved-result-detail-screen")).toBeVisible({ timeout: 10000 });

    await expect(page.getByTestId("saved-result-split-card-a")).toContainText("races 1–2");
    await expect(page.getByTestId("saved-result-split-pnl-a")).toContainText("£1");
    await expect(page.getByTestId("saved-result-split-card-b")).toContainText("races 3–4");
    await expect(page.getByTestId("saved-result-split-pnl-b")).toContainText("£4");
  });

  test("Details button per split opens SplitDetailPanel with that split's own numbers", async ({ page }) => {
    await page.getByTestId("saved-results-item-mock-result-1").click();
    await expect(page.getByTestId("saved-result-detail-screen")).toBeVisible({ timeout: 10000 });

    await page.getByTestId("saved-result-split-details-button-a").click();
    await expect(page.getByTestId("split-detail-panel-a")).toBeVisible();
    await expect(page.getByTestId("split-detail-row-staked-a")).toContainText("£10");
    await page.getByTestId("split-detail-panel-filters-a").click();
    await expect(page.getByTestId("split-detail-panel-a")).not.toBeVisible();

    await page.getByTestId("saved-result-split-details-button-b").click();
    await expect(page.getByTestId("split-detail-panel-b")).toBeVisible();
    await expect(page.getByTestId("split-detail-row-staked-b")).toContainText("£10");
  });

  test("Graph button per split renders that split's own snapshot with no extra network call", async ({ page }) => {
    let convergenceCalls = 0;
    await page.route("**/api/industry-sp/race-convergence", (route) => {
      convergenceCalls++;
      route.continue();
    });

    await page.getByTestId("saved-results-item-mock-result-1").click();
    await expect(page.getByTestId("saved-result-detail-screen")).toBeVisible({ timeout: 10000 });

    await page.getByTestId("saved-result-split-graph-button-a").click();
    await expect(page.getByTestId("pnl-convergence-panel")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("pnl-convergence-range-subtitle")).toHaveText("Races 1–2");
    await page.getByTestId("pnl-convergence-panel-close").click();

    await page.getByTestId("saved-result-split-graph-button-b").click();
    await expect(page.getByTestId("pnl-convergence-panel")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("pnl-convergence-range-subtitle")).toHaveText("Races 3–4");

    // The static snapshot embeds each split's own graphPoints — the graph
    // must render from that payload, not by calling the live convergence
    // endpoint (which real saved Results never hit again after save time).
    expect(convergenceCalls).toBe(0);
  });

  test("restore navigates back to /isp with the saved filters in the URL", async ({ page }) => {
    await page.getByTestId("saved-results-item-mock-result-1").click();
    await expect(page.getByTestId("saved-result-detail-screen")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("saved-result-detail-restore").click();

    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
    expect(page.url()).toContain("courses=Ascot");
    expect(page.url()).toContain("minDate=2026-01-01");
  });

  test("delete from the detail view removes the result and returns to the list", async ({ page }) => {
    await page.getByTestId("saved-results-item-mock-result-2").click();
    await expect(page.getByTestId("saved-result-detail-screen")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("saved-result-detail-delete").click();

    await expect(page.getByTestId("saved-results-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("saved-results-item-mock-result-2")).not.toBeVisible();
  });

  test("delete from the list view (inline confirm) removes the result", async ({ page }) => {
    await page.getByTestId("saved-results-item-mock-result-1-delete").click();
    await expect(page.getByTestId("saved-results-item-mock-result-1-confirm-delete")).toBeVisible();
    await page.getByTestId("saved-results-item-mock-result-1-confirm-delete").click();
    await expect(page.getByTestId("saved-results-item-mock-result-1")).not.toBeVisible();
  });
});

test.describe("Saved Results — empty state", () => {
  test("shows the empty state when there are no saved results", async ({ page }) => {
    await page.route((url) => url.pathname === "/api/saved-filter-sets", (route) => {
      if (route.request().method() === "GET") {
        route.fulfill({ json: { success: true, data: [], count: 0 } });
      } else {
        route.continue();
      }
    });
    await page.goto("/results");
    await expect(page.getByTestId("saved-results-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("saved-results-empty")).toBeVisible();
  });
});
