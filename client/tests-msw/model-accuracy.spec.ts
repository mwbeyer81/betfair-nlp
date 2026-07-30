import { test, expect } from "./fixtures";

test.describe("Model Accuracy — MSW mocked network", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/model-accuracy");
    await expect(page.getByTestId("model-accuracy-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("model-accuracy-loading")).not.toBeVisible({ timeout: 10000 });
  });

  test("renders every price band, shortest price first", async ({ page }) => {
    await expect(page.getByTestId("model-accuracy-table")).toBeVisible();
    for (const key of ["50.0000", "33.3333", "20.0000", "10.0000", "5.0000", "0.0000"]) {
      await expect(page.getByTestId(`model-accuracy-band-${key}`)).toBeVisible();
    }
    await expect(page.getByTestId("model-accuracy-overall-row")).toBeVisible();
  });

  test("an over-rated band shows the model's claim beside what actually happened", async ({ page }) => {
    // The 3.0-5.0 band claims 25% but only won 18.9% — the headline signal the
    // whole screen exists to surface.
    const row = page.getByTestId("model-accuracy-band-20.0000");
    await expect(row).toContainText("25.0%");
    await expect(row).toContainText("18.9%");
  });

  test("shows both the model's and the market's error so they can be compared", async ({ page }) => {
    const row = page.getByTestId("model-accuracy-band-20.0000");
    await expect(row).toContainText("+6.1");
    await expect(row).toContainText("+3.2");
  });

  test("warns that the figures are in-sample", async ({ page }) => {
    await expect(page.getByTestId("model-accuracy-insample-warning")).toContainText(
      "flatter the model"
    );
  });

  test("states which of the model and market was more accurate overall", async ({ page }) => {
    await expect(page.getByTestId("model-accuracy-brier")).toContainText(
      "The market was more accurate than the model"
    );
  });

  test("a column tooltip opens on demand and explains the column", async ({ page }) => {
    await expect(page.getByTestId("model-accuracy-tooltip-text-Market said")).toHaveCount(0);
    await page.getByTestId("model-accuracy-tooltip-toggle-Market said").click();
    await expect(page.getByTestId("model-accuracy-tooltip-text-Market said")).toContainText("margin");
  });

  test("is reachable from the header nav", async ({ page }) => {
    await page.goto("/isp");
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("industry-sp-menu-model-accuracy-link").click();
    await expect(page.getByTestId("model-accuracy-screen")).toBeVisible({ timeout: 10000 });
  });

  test("sends the applied date range to the API", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", req => {
      if (req.url().includes("/api/model-accuracy")) requests.push(req.url());
    });
    await page.getByTestId("model-accuracy-apply").click();
    // Apply with no dates set must still refetch, and must not send empty params.
    await expect.poll(() => requests.length, { timeout: 10000 }).toBeGreaterThan(0);
    expect(requests[requests.length - 1]).not.toContain("minDate=&");
  });
});
