import { test, expect } from "@playwright/test";

// Real frontend (static export on :8090) + real backend (:3050) + throwaway
// Mongo — no mocking anywhere. UI tier: proves the screen is reachable, renders
// real aggregated data, and that what it shows matches what the API returned.
//
// The seeded slice is one day (2026-06-03), whereas the screen defaults to
// January 2024 — so every navigation here carries an explicit window.
const API_URL = "http://localhost:3050";
const WINDOW = "minDate=2026-06-01&maxDate=2026-06-30";

async function login(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/?email=matthew%40backbet.co.uk&password=beyer");
  await page.waitForFunction(() => localStorage.getItem("auth_token") !== null, { timeout: 20000 });
}

async function openScreen(page: import("@playwright/test").Page, query = WINDOW): Promise<void> {
  await page.goto(`/model-vs-sp?${query}`);
  await expect(page.getByTestId("model-vs-sp-screen")).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId("model-vs-sp-loading")).not.toBeVisible({ timeout: 20000 });
}

test.describe("Model vs SP screen (real stack)", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("is reachable from the header nav", async ({ page }) => {
    await page.goto("/isp");
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 20000 });
    await page.getByTestId("industry-sp-menu-model-vs-sp-link").click();
    await expect(page.getByTestId("model-vs-sp-screen")).toBeVisible({ timeout: 20000 });
  });

  test("renders real runner rows with all three comparison figures", async ({ page }) => {
    await openScreen(page);
    await expect(page.getByTestId("model-vs-sp-list")).toBeVisible();

    const rows = page.locator('[data-testid^="model-vs-sp-row-"]');
    expect(await rows.count()).toBeGreaterThan(0);

    // Every row carries a model %, an implied SP % and a signed gap in points.
    const first = rows.first();
    const key = (await first.getAttribute("data-testid"))!.replace("model-vs-sp-row-", "");
    await expect(page.getByTestId(`model-vs-sp-model-${key}`)).toContainText("%");
    await expect(page.getByTestId(`model-vs-sp-sp-${key}`)).toContainText("%");
    await expect(page.getByTestId(`model-vs-sp-edge-${key}`)).toContainText("pts");
  });

  test("the result count matches what the API reports", async ({ page, request }) => {
    await openScreen(page);
    const token = await page.evaluate(() => localStorage.getItem("auth_token"));
    const res = await request.get(`${API_URL}/api/model-vs-sp?${WINDOW}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const { total } = await res.json();

    await expect(page.getByTestId("model-vs-sp-result-count")).toHaveText(`${total.toLocaleString("en-US")} runners`);
  });

  test("the summary's band counts total the overall runner count", async ({ page, request }) => {
    await openScreen(page);
    await expect(page.getByTestId("model-vs-sp-summary")).toBeVisible();

    const token = await page.evaluate(() => localStorage.getItem("auth_token"));
    const res = await request.get(`${API_URL}/api/model-vs-sp?${WINDOW}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const { summary } = await res.json();

    // Each band's rendered count matches the API, and they tile the population.
    let rendered = 0;
    for (const band of summary.bands) {
      const key = band.maxAbs == null ? "beyond" : String(band.maxAbs);
      const text = await page.getByTestId(`model-vs-sp-summary-count-${key}`).textContent();
      const shown = parseInt((text ?? "0").replace(/,/g, ""), 10);
      expect(shown).toBe(band.count);
      rendered += shown;
    }
    expect(rendered).toBe(summary.allRunners);
  });

  test("the unsigned difference filter narrows the list against real data", async ({ page }) => {
    await openScreen(page);
    const before = await page.getByTestId("model-vs-sp-result-count").textContent();

    await page.getByTestId("model-vs-sp-min-edge").fill("10");
    await page.getByTestId("model-vs-sp-apply-button").click();
    await expect(page.getByTestId("model-vs-sp-loading")).not.toBeVisible({ timeout: 20000 });

    const after = await page.getByTestId("model-vs-sp-result-count").textContent();
    expect(after).not.toBe(before);
    // The summary keeps describing the whole population, and reports what the
    // filter selected out of it.
    await expect(page.getByTestId("model-vs-sp-summary-selection")).toContainText("selects");
  });

  test("numbered pagination walks a real result set without repeating a row", async ({ page }) => {
    await openScreen(page, `${WINDOW}&limit=25`);
    const status = await page.getByTestId("model-vs-sp-pagination-top-status").textContent();
    const totalPages = parseInt((status ?? "").split("of")[1]?.trim() ?? "1", 10);
    test.skip(totalPages < 2, "seeded slice fits on one page");

    const seen = new Set<string>();
    for (let page_ = 1; page_ <= totalPages; page_++) {
      if (page_ > 1) {
        await page.getByTestId("model-vs-sp-pagination-top-next").click();
        await expect(page.getByTestId("model-vs-sp-loading")).not.toBeVisible({ timeout: 20000 });
      }
      const ids = await page.locator('[data-testid^="model-vs-sp-row-"]').evaluateAll(nodes =>
        nodes.map(n => n.getAttribute("data-testid") ?? "")
      );
      for (const id of ids) {
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
    }
    await expect(page.getByTestId("model-vs-sp-pagination-top-next")).toBeDisabled();
  });

  test("sorting by gap puts the biggest disagreement first", async ({ page }) => {
    await openScreen(page);
    await page.getByTestId("model-vs-sp-sort-edge").click();
    await expect(page.getByTestId("model-vs-sp-loading")).not.toBeVisible({ timeout: 20000 });

    const edges = await page.locator('[data-testid^="model-vs-sp-edge-"]').evaluateAll(nodes =>
      nodes.map(n => parseFloat((n.textContent ?? "0").replace(" pts", "")))
    );
    expect(edges.length).toBeGreaterThan(1);
    for (let i = 1; i < edges.length; i++) {
      expect(edges[i]).toBeLessThanOrEqual(edges[i - 1] + 1e-9);
    }
  });

  test("a window with no racing shows the empty state, not an error", async ({ page }) => {
    await openScreen(page, "minDate=1990-01-01&maxDate=1990-01-02");
    await expect(page.getByTestId("model-vs-sp-empty")).toBeVisible();
    await expect(page.getByTestId("model-vs-sp-error")).toHaveCount(0);
  });

  test("has no horizontal overflow at a 375px viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openScreen(page);
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
  });
});
