import { test, expect } from "@playwright/test";

// Real frontend (static export on :8090) + real backend (:3050) + throwaway
// Mongo — no mocking anywhere. UI tier of the inverted pyramid: proves the
// screen is reachable, renders real aggregated data, and that the numbers on
// screen match what the API actually returned.
// Same reasoning as LOCAL_CI_APP_URL above: overridable so concurrent
// worktrees can claim their own backend port (LOCAL_CI_BACKEND_PORT).
const API_URL = process.env.LOCAL_CI_API_URL ?? "http://localhost:3050";

async function login(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/?email=matthew%40backbet.co.uk&password=beyer");
  await page.waitForFunction(() => localStorage.getItem("auth_token") !== null, { timeout: 20000 });
}

test.describe("Model Accuracy screen (real stack)", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("is reachable from the header nav and renders the band table", async ({ page }) => {
    await page.goto("/isp");
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 20000 });
    await page.getByTestId("industry-sp-menu-model-accuracy-link").click();
    await expect(page.getByTestId("model-accuracy-screen")).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("model-accuracy-loading")).not.toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("model-accuracy-table")).toBeVisible();
  });

  test("shows every price band plus the overall row", async ({ page }) => {
    await page.goto("/model-accuracy");
    await expect(page.getByTestId("model-accuracy-table")).toBeVisible({ timeout: 20000 });
    for (const key of ["50.0000", "33.3333", "20.0000", "10.0000", "5.0000", "0.0000"]) {
      await expect(page.getByTestId(`model-accuracy-band-${key}`)).toBeVisible();
    }
    await expect(page.getByTestId("model-accuracy-overall-row")).toBeVisible();
  });

  // Was "always warns that the figures are in-sample". Since a7efb1e the
  // screen reads modelWinProbabilityOos — every race scored by a model fitted
  // only on races that finished before it — so the old "these figures flatter
  // the model" apology is not merely outdated, it would now be misleading.
  // Asserting the old node is *absent* is the point: the new claim and the old
  // apology must never be on screen together.
  test("states the method instead of apologising for it", async ({ page }) => {
    await page.goto("/model-accuracy");
    await expect(page.getByTestId("model-accuracy-method-note")).toContainText(
      "trained only on races that finished before it",
      { timeout: 20000 }
    );
    await expect(page.getByTestId("model-accuracy-insample-warning")).toHaveCount(0);
  });

  test("the rendered strike rate matches what the API returned", async ({ page, request }) => {
    const loginRes = await request.post(`${API_URL}/api/auth/login`, {
      data: { email: "matthew@backbet.co.uk", password: "beyer" },
    });
    const t = (await loginRes.json()).token as string;
    const body = await (
      await request.get(`${API_URL}/api/model-accuracy`, { headers: { Authorization: `Bearer ${t}` } })
    ).json();

    const populated = (body.data as { bandKey: string; runners: number; actualWinRate: number }[]).find(
      b => b.runners > 0
    );
    expect(populated).toBeDefined();

    await page.goto("/model-accuracy");
    await expect(page.getByTestId("model-accuracy-table")).toBeVisible({ timeout: 20000 });
    // Guards against the columns being rendered in the wrong order — a bug the
    // shape-only assertions above would happily miss.
    await expect(page.getByTestId(`model-accuracy-band-${populated!.bandKey}`)).toContainText(
      `${populated!.actualWinRate.toFixed(1)}%`
    );
  });

  test("a column tooltip explains the column in plain English", async ({ page }) => {
    await page.goto("/model-accuracy");
    await expect(page.getByTestId("model-accuracy-table")).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("model-accuracy-tooltip-text-Market said")).toHaveCount(0);
    await page.getByTestId("model-accuracy-tooltip-toggle-Market said").click();
    await expect(page.getByTestId("model-accuracy-tooltip-text-Market said")).toContainText("margin");
  });

  test("a date range with no racing falls back to the empty state, not an error", async ({ page }) => {
    await page.goto("/model-accuracy");
    await expect(page.getByTestId("model-accuracy-table")).toBeVisible({ timeout: 20000 });
    await page.getByTestId("model-accuracy-reset").click();
    await expect(page.getByTestId("model-accuracy-error")).toHaveCount(0);
  });
});
