import { test, expect } from "./fixtures";

// fixtures.ts's /api/industry-sp mock filters by exact runnerName (case-
// insensitive) when the param is present — "Fact To File" matches the one
// mocked race, anything else returns an empty list.

test.describe("Runner History (MSW mocked)", () => {
  test("shows this horse's races, scoped by exact name", async ({ page }) => {
    await page.goto("/isp/runner/history?runnerName=" + encodeURIComponent("Fact To File"));
    await expect(page.getByTestId("runner-history-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("runner-history-loading")).not.toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("runner-history-item-914592")).toBeVisible();
  });

  test("a horse with no matching races shows the empty state", async ({ page }) => {
    await page.goto("/isp/runner/history?runnerName=Nobody");
    await expect(page.getByTestId("runner-history-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("runner-history-loading")).not.toBeVisible({ timeout: 10000 });
    await expect(page.getByText("No races found for this runner.")).toBeVisible();
  });

  test("filter bar is present with course/going/class/type chips, date range, ISP range, and trainer-form threshold", async ({ page }) => {
    await page.goto("/isp/runner/history?runnerName=" + encodeURIComponent("Fact To File"));
    await expect(page.getByTestId("runner-history-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("runner-history-course")).toBeVisible();
    await expect(page.getByTestId("runner-history-going")).toBeVisible();
    await expect(page.getByTestId("runner-history-race-class")).toBeVisible();
    await expect(page.getByTestId("runner-history-race-type")).toBeVisible();
    await expect(page.getByTestId("runner-history-date-range-picker")).toBeVisible();
    await expect(page.getByTestId("runner-history-min-isp")).toBeVisible();
    await expect(page.getByTestId("runner-history-has-trainer-form")).toBeVisible();
    await expect(page.getByTestId("runner-history-trainer-form-min-win-rate")).toBeVisible();
  });

  test("checking 'Has trainer form' sends minTrainerFormRunners=1 to /api/industry-sp", async ({ page }) => {
    await page.goto("/isp/runner/history?runnerName=" + encodeURIComponent("Fact To File"));
    await expect(page.getByTestId("runner-history-screen")).toBeVisible({ timeout: 10000 });

    let capturedMinTFR: string | null = null;
    await page.route("**/api/industry-sp*", async (route) => {
      const url = new URL(route.request().url());
      capturedMinTFR = url.searchParams.get("minTrainerFormRunners");
      await route.continue();
    });

    await expect(page.getByTestId("runner-history-has-trainer-form")).not.toHaveAttribute("aria-checked", "true");
    await page.getByTestId("runner-history-has-trainer-form").click();
    await expect(page.getByTestId("runner-history-has-trainer-form")).toHaveAttribute("aria-checked", "true");
    await page.getByTestId("runner-history-filter-apply").click();
    await expect(page.getByTestId("runner-history-loading")).not.toBeVisible({ timeout: 10000 });
    expect(capturedMinTFR).toBe("1");
  });

  test("applying a course chip re-fetches and Reset clears it back", async ({ page }) => {
    await page.goto("/isp/runner/history?runnerName=" + encodeURIComponent("Fact To File"));
    await expect(page.getByTestId("runner-history-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("runner-history-course-Cheltenham")).toBeVisible();

    await page.getByTestId("runner-history-course-Cheltenham").click();
    await page.getByTestId("runner-history-filter-apply").click();
    await expect(page.getByTestId("runner-history-loading")).not.toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("runner-history-item-914592")).toBeVisible();

    await page.getByTestId("runner-history-filter-reset").click();
    await expect(page.getByTestId("runner-history-loading")).not.toBeVisible({ timeout: 10000 });
  });

  test("tapping a race row navigates to Runner Detail for that race", async ({ page }) => {
    await page.goto("/isp/runner/history?runnerName=" + encodeURIComponent("Fact To File"));
    await expect(page.getByTestId("runner-history-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("runner-history-item-914592")).toBeVisible();

    await page.getByTestId("runner-history-item-914592").click();
    await expect(page.getByTestId("runner-detail-screen")).toBeVisible({ timeout: 10000 });
    expect(page.url()).toContain("raceId=914592");
    expect(page.url()).toContain("runnerId=12347");
  });

  test("back returns to /isp/races when reached via a bare deep link (no returnRoute)", async ({ page }) => {
    await page.goto("/isp/runner/history?runnerName=" + encodeURIComponent("Fact To File"));
    await expect(page.getByTestId("runner-history-screen")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("runner-history-back-button").click();
    await expect(page.getByTestId("industry-sp-races-screen")).toBeVisible({ timeout: 10000 });
  });
});
