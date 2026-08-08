import { test, expect } from "./fixtures";

const KEY = "a18e5351-b4bb-4a9f-a014-715f72b1f0ee";

test.describe("Why It's Hard — unlisted static page (MSW mocked)", () => {
  test("opens signed-out when the URL carries the key", async ({ page }) => {
    await page.context().clearCookies();
    await page.addInitScript(() => window.localStorage.clear());
    await page.goto(`/why-its-hard?k=${KEY}`);
    await expect(page.getByTestId("why-its-hard-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("why-its-hard-intro")).toContainText("actually makes money");
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
    for (const id of ["not-picking-winners", "behind-before-you-start", "strong-opponent",
                      "quite-good-is-worthless", "luck-vs-skill", "mirages", "bold-opinions"]) {
      await expect(page.getByTestId(`why-its-hard-section-${id}`)).toBeVisible();
    }
    const table = page.getByTestId("why-its-hard-comparison");
    await expect(table).toContainText("35%");
    await expect(table).toContainText("7.5p");
    await expect(table).toContainText("10p");
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
