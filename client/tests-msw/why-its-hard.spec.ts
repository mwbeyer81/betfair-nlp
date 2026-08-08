import { test, expect } from "./fixtures";

const KEY = "a18e5351-b4bb-4a9f-a014-715f72b1f0ee";

test.describe("Why It's Hard — unlisted static page (MSW mocked)", () => {
  test("opens signed-out when the URL carries the key", async ({ page }) => {
    await page.context().clearCookies();
    await page.addInitScript(() => window.localStorage.clear());
    await page.goto(`/why-its-hard?k=${KEY}`);
    await expect(page.getByTestId("why-its-hard-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("why-its-hard-intro")).toContainText("doesn't beat the book");
  });

  // The point of the key: without it the page is not reachable by guessing the
  // path. It is obscurity rather than security (the key ships in the bundle),
  // so this pins the behaviour, not a secrecy guarantee.
  test("signed-out without the key falls back to the auth wall", async ({ page }) => {
    await page.context().clearCookies();
    await page.addInitScript(() => window.localStorage.clear());
    await page.goto("/why-its-hard");
    await expect(page.getByTestId("why-its-hard-screen")).toHaveCount(0);
  });

  test("a wrong key is refused", async ({ page }) => {
    await page.context().clearCookies();
    await page.addInitScript(() => window.localStorage.clear());
    await page.goto("/why-its-hard?k=not-the-key");
    await expect(page.getByTestId("why-its-hard-screen")).toHaveCount(0);
  });

  test("every section renders, and the comparison table is present", async ({ page }) => {
    await page.goto(`/why-its-hard?k=${KEY}`);
    await expect(page.getByTestId("why-its-hard-screen")).toBeVisible({ timeout: 10000 });
    for (const id of ["the-model", "inputs", "testing", "results", "why-hard", "improvements"]) {
      await expect(page.getByTestId(`why-its-hard-section-${id}`)).toBeVisible();
    }
    const results = page.getByTestId("why-its-hard-section-results");
    await expect(results).toContainText("35.0%");
    await expect(results).toContainText("−7.5%");
    await expect(results).toContainText("−10.3%");
  });

  // The audience is an expert punter, not a data scientist: XGBoost is named
  // but described, and the accuracy score is explained in words rather than
  // left as a term to look up. If either reverts to bare jargon the page has
  // drifted back to the wrong reader.
  test("names XGBoost but explains it, and explains the accuracy score in words", async ({ page }) => {
    await page.goto(`/why-its-hard?k=${KEY}`);
    const model = page.getByTestId("why-its-hard-section-the-model");
    await expect(model).toContainText("XGBoost");
    await expect(model).toContainText("yes/no rules");
    await expect(page.getByTestId("why-its-hard-section-testing")).toContainText(
      "report card for percentages"
    );
  });

  // The single most important honesty point on the page: the comparison is
  // against a fair price, not a margined one, so "just bet the exchange"
  // cannot be read as the answer.
  test("states that the comparison has the bookmaker's margin removed", async ({ page }) => {
    await page.goto(`/why-its-hard?k=${KEY}`);
    await expect(page.getByTestId("why-its-hard-section-testing")).toContainText(
      "margin taken out"
    );
    await expect(page.getByTestId("why-its-hard-section-why-hard")).toContainText(
      "already losing to the fair price"
    );
  });

  // The page argues for honesty; it must not itself imply a profitable system.
  test("carries the responsible-gambling disclaimer", async ({ page }) => {
    await page.goto(`/why-its-hard?k=${KEY}`);
    await expect(page.getByTestId("why-its-hard-disclaimer")).toContainText("betting advice");
    await expect(page.getByTestId("why-its-hard-disclaimer")).toContainText("gamble responsibly");
  });

  test("signed-in users reach it from the burger menu, key and all", async ({ page }) => {
    await page.goto("/events");
    await expect(page.getByTestId("events-screen")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("events-menu-why-its-hard-link").click();
    await expect(page.getByTestId("why-its-hard-screen")).toBeVisible({ timeout: 10000 });
    // The address bar must hold the shareable URL, so it can be copied out.
    expect(page.url()).toContain(`/why-its-hard?k=${KEY}`);
  });
});
