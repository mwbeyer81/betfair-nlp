import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

/**
 * The "Raw model fields" section of the Filters screen — the picker that lets
 * you narrow by any column ml/train_and_predict.py actually trains on.
 *
 * What these tests are for: the value of this feature is entirely in the
 * round trip. A field chosen in the picker has to reach the request as the
 * right query param, land in the URL so the view is shareable, and come back
 * out of that URL on the next mount. Every one of those hops is a separate
 * place it can be silently dropped, and a dropped filter does not error — it
 * shows you an unfiltered number under a filtered-looking UI.
 *
 * Runs against a static build with every API call mocked (see fixtures.ts), so
 * these assert on what the app SENDS and RENDERS. The aggregation that the
 * params drive is pinned separately by
 * src/lib/filters/__tests__/filter-conditions.test.ts and the DAO integration
 * tests.
 */

async function gotoIsp(page: Page) {
  await page.goto("/isp");
  await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
}

async function openPicker(page: Page) {
  await expect(page.getByTestId("filter-field-picker")).toBeVisible();
  await page.getByTestId("filter-field-picker-add").click();
  await expect(page.getByTestId("filter-field-picker-list")).toBeVisible();
}

test.describe("Raw model fields picker", () => {
  test("renders inside the filter panel with nothing chosen", async ({ page }) => {
    await gotoIsp(page);
    await expect(page.getByTestId("filter-field-picker")).toBeVisible();
    await expect(page.getByTestId("filter-field-picker-none")).toBeVisible();
  });

  test("lists the catalogue the API served, including the disabled field", async ({ page }) => {
    await gotoIsp(page);
    await openPicker(page);
    await expect(page.getByTestId("filter-field-option-officialRating")).toBeVisible();
    await expect(page.getByTestId("filter-field-option-distanceFurlongs")).toBeVisible();
    await expect(page.getByTestId("filter-field-option-hg")).toBeVisible();
    // Listed rather than hidden, so someone hunting for it learns why it is empty.
    await expect(page.getByTestId("filter-field-option-horseAvgExcuseScore")).toBeVisible();
    await expect(page.getByTestId("filter-field-option-horseAvgExcuseScore-coverage"))
      .toContainText("Not filterable");
  });

  test("shows each field's measured coverage before you choose it", async ({ page }) => {
    await gotoIsp(page);
    await openPicker(page);
    await expect(page.getByTestId("filter-field-option-officialRating-coverage")).toContainText("78.1%");
    await expect(page.getByTestId("filter-field-option-officialRating-note")).toContainText("maidens");
  });

  test("search narrows the list", async ({ page }) => {
    await gotoIsp(page);
    await openPicker(page);
    await page.getByTestId("filter-field-picker-search").fill("headgear");
    await expect(page.getByTestId("filter-field-option-hg")).toBeVisible();
    await expect(page.getByTestId("filter-field-option-officialRating")).toHaveCount(0);
  });

  test("choosing a field adds an editable row", async ({ page }) => {
    await gotoIsp(page);
    await openPicker(page);
    await page.getByTestId("filter-field-option-officialRating").click();
    await expect(page.getByTestId("filter-field-row-officialRating")).toBeVisible();
    await expect(page.getByTestId("filter-field-min-officialRating")).toBeVisible();
    await expect(page.getByTestId("filter-field-coverage-officialRating")).toContainText("78.1%");
  });

  test("Remove takes the row away again", async ({ page }) => {
    await gotoIsp(page);
    await openPicker(page);
    await page.getByTestId("filter-field-option-officialRating").click();
    await expect(page.getByTestId("filter-field-row-officialRating")).toBeVisible();
    await page.getByTestId("filter-field-remove-officialRating").click();
    await expect(page.getByTestId("filter-field-row-officialRating")).toHaveCount(0);
    await expect(page.getByTestId("filter-field-picker-none")).toBeVisible();
  });

  test("Apply sends the bound as minOfficialRating", async ({ page }) => {
    await gotoIsp(page);
    await openPicker(page);
    await page.getByTestId("filter-field-option-officialRating").click();
    await page.getByTestId("filter-field-min-officialRating").fill("90");

    const request = page.waitForRequest(req =>
      req.url().includes("/api/industry-sp/splits") && req.url().includes("minOfficialRating=90")
    );
    await page.getByTestId("industry-sp-filter-apply").click();
    await request;
  });

  test("an enum selection is sent under its own param name, not name + 's'", async ({ page }) => {
    // `hg` serialises as `headgear`, which is why the registry carries an
    // explicit enumParam rather than deriving one.
    await gotoIsp(page);
    await openPicker(page);
    await page.getByTestId("filter-field-option-hg").click();
    await page.getByTestId("filter-field-chip-hg-b").click();

    const request = page.waitForRequest(req =>
      req.url().includes("/api/industry-sp/splits") && req.url().includes("headgear=b")
    );
    await page.getByTestId("industry-sp-filter-apply").click();
    await request;
  });

  test("an added-but-empty field is not sent", async ({ page }) => {
    // Adding a row and typing nothing is a no-op, and shipping the key would
    // put a meaningless param in the URL and split the splits cache for nothing.
    await gotoIsp(page);
    await openPicker(page);
    await page.getByTestId("filter-field-option-officialRating").click();

    const request = page.waitForRequest(req => req.url().includes("/api/industry-sp/splits"));
    await page.getByTestId("industry-sp-filter-apply").click();
    const url = (await request).url();
    expect(url).not.toContain("minOfficialRating");
    expect(url).not.toContain("maxOfficialRating");
  });

  test("the applied filter lands in the URL", async ({ page }) => {
    await gotoIsp(page);
    await openPicker(page);
    await page.getByTestId("filter-field-option-officialRating").click();
    await page.getByTestId("filter-field-min-officialRating").fill("90");
    await page.getByTestId("industry-sp-filter-apply").click();
    await expect.poll(() => page.url()).toContain("minOfficialRating=90");
  });

  test("a URL carrying only a registry param restores it on mount", async ({ page }) => {
    // urlHasAnyParams() decides whether a fresh mount is a bare /isp (idle
    // until Apply) or a link arriving with filters. It tests an explicit list,
    // so registry params had to be recognised by shape or a link like this one
    // would render as though nothing were set.
    await page.goto("/isp?minOfficialRating=90");
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("filter-field-row-officialRating")).toBeVisible();
    await expect(page.getByTestId("filter-field-min-officialRating")).toHaveValue("90");
  });

  test("removing a field clears its param from the URL", async ({ page }) => {
    // Without an explicit clear the stale param survives, and the next mount
    // faithfully restores a filter the user just deleted.
    await page.goto("/isp?minOfficialRating=90");
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("filter-field-remove-officialRating").click();
    await page.getByTestId("industry-sp-filter-apply").click();
    await expect.poll(() => page.url()).not.toContain("minOfficialRating");
  });

  test("Reset clears every chosen field", async ({ page }) => {
    await page.goto("/isp?minOfficialRating=90");
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("filter-field-row-officialRating")).toBeVisible();
    await page.getByTestId("industry-sp-filter-reset").click();
    await expect(page.getByTestId("filter-field-row-officialRating")).toHaveCount(0);
  });
});
