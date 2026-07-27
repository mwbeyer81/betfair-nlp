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

test.describe("Saved Results — legacy pre-split documents", () => {
  // Regression coverage for a real production bug (reported live via
  // screenshot: clicking Results showed a blank white screen). Root cause:
  // any saved_filter_sets document created before the Split A/B schema
  // change has neither field at all — combinedPnlStats() read
  // result.splitA.pnlStats directly with no guard, throwing mid-render.
  // There is no error boundary anywhere in this app, so React unmounted
  // the ENTIRE screen instead of just the one bad card. See
  // client/scripts/prod-repro/results-white-screen-2026-07-27.spec.ts for
  // the same reproduction run against the real deployed app.
  const legacyResult = {
    id: "legacy-result-1",
    name: "Pre-fix save",
    filters: { courses: "Ascot" },
    pnlStats: { staked: 20, returns: 15, pnl: -5, count: 4 },
    graphPoints: [{ raceRowNumber: 1, cumulativeStaked: 20, cumulativeReturns: 15, cumulativePnl: -5, roiPercent: -25 }],
    createdAt: "2026-01-15T09:00:00.000Z",
  };

  test("a legacy doc renders a degraded, delete-only card instead of crashing the whole list", async ({ page }) => {
    await page.route((url) => url.pathname === "/api/saved-filter-sets", (route) => {
      if (route.request().method() === "GET") {
        route.fulfill({ json: { success: true, count: 1, data: [legacyResult] } });
      } else {
        route.continue();
      }
    });
    await page.route((url) => url.pathname === "/api/saved-filter-sets/legacy-result-1", (route) => {
      if (route.request().method() === "DELETE") {
        route.fulfill({ json: { success: true } });
      } else {
        route.continue();
      }
    });
    await page.goto("/results");
    await expect(page.getByTestId("saved-results-screen")).toBeVisible({ timeout: 10000 });
    // The loading spinner shows first, before the fetch resolves — the bug
    // only manifests once data arrives and the list tries to render it, so
    // checking visibility right after goto() would trivially pass on the
    // spinner and miss a regression entirely. Waiting for loading to clear
    // THEN re-checking the screen is still there is what actually catches it.
    await expect(page.getByTestId("saved-results-loading")).not.toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("saved-results-screen")).toBeVisible();
    await expect(page.getByTestId("saved-results-item-legacy-result-1")).toBeVisible();
    await expect(page.getByTestId("saved-results-item-legacy-result-1-legacy-notice")).toContainText("Split A/B update");
    // No PnL/sparkline for a legacy card — there's no split data to show.
    await expect(page.getByTestId("saved-results-item-legacy-result-1")).not.toContainText("£");
    // Delete still works — the one useful action available for it.
    await page.getByTestId("saved-results-item-legacy-result-1-delete").click();
    await page.getByTestId("saved-results-item-legacy-result-1-confirm-delete").click();
    await expect(page.getByTestId("saved-results-item-legacy-result-1")).not.toBeVisible();
  });

  test("a legacy doc mixed in with normal results doesn't affect the normal ones", async ({ page }) => {
    await page.route((url) => url.pathname === "/api/saved-filter-sets", (route) => {
      if (route.request().method() === "GET") {
        route.fulfill({
          json: {
            success: true,
            count: 2,
            data: [
              legacyResult,
              {
                id: "mock-result-1",
                name: "Ascot favourites",
                filters: { courses: "Ascot", minDate: "2026-01-01", maxDate: "2026-01-01" },
                splitA: {
                  fromRow: 1, toRow: 2, total: 2, totalRunners: 6,
                  pnlStats: { staked: 10, returns: 11, pnl: 1, count: 2 },
                  graphPoints: [
                    { raceRowNumber: 1, cumulativeStaked: 5, cumulativeReturns: 6, cumulativePnl: 1, roiPercent: 20 },
                    { raceRowNumber: 2, cumulativeStaked: 10, cumulativeReturns: 11, cumulativePnl: 1, roiPercent: 10 },
                  ],
                },
                splitB: {
                  fromRow: 3, toRow: 4, total: 2, totalRunners: 6,
                  pnlStats: { staked: 10, returns: 6, pnl: -4, count: 2 },
                  graphPoints: [
                    { raceRowNumber: 3, cumulativeStaked: 5, cumulativeReturns: 5, cumulativePnl: 0, roiPercent: 0 },
                    { raceRowNumber: 4, cumulativeStaked: 10, cumulativeReturns: 6, cumulativePnl: -4, roiPercent: -40 },
                  ],
                },
                createdAt: "2026-01-20T09:00:00.000Z",
              },
            ],
          },
        });
      } else {
        route.continue();
      }
    });
    await page.goto("/results");
    await expect(page.getByTestId("saved-results-loading")).not.toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("saved-results-item-legacy-result-1-legacy-notice")).toBeVisible();
    // The normal result still opens its detail view and shows real PnL.
    await page.getByTestId("saved-results-item-mock-result-1").click();
    await expect(page.getByTestId("saved-result-detail-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("saved-result-split-card-a")).toBeVisible();
  });

  test("navigating directly to a legacy doc's detail view shows the notice instead of crashing", async ({ page }) => {
    await page.route((url) => url.pathname === "/api/saved-filter-sets/legacy-result-1", (route) =>
      route.fulfill({ json: { success: true, data: legacyResult } })
    );
    await page.goto("/results/detail?id=legacy-result-1");
    await expect(page.getByTestId("saved-result-detail-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("saved-result-detail-legacy-notice")).toContainText("Split A/B update");
    await expect(page.getByTestId("saved-result-detail-delete")).toBeVisible();
  });
});
