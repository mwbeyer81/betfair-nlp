import { test, expect } from "@playwright/test";

const BASE_URL = "https://punt-storybook.pages.dev";
const STORY_ID = "components-allrunnerspanel--default";
const RUNNERS_SCREEN_STORY_ID = "components-allrunnersscreen--default";
const RUNNERS_SCREEN_EMPTY_STORY_ID = "components-allrunnersscreen--empty";

test.describe("punt-storybook.pages.dev — Storybook static build", () => {
  test("GET / returns 200 and serves HTML", async ({ request }) => {
    const response = await request.get(`${BASE_URL}/`);
    expect(response.status()).toBe(200);
    const ct = response.headers()["content-type"] ?? "";
    expect(ct).toContain("text/html");
  });

  test("manager UI loads with correct title", async ({ page }) => {
    await page.goto(`${BASE_URL}/`);
    await expect(page).toHaveTitle(/Storybook/);
  });

  test("story index.json is served and lists stories", async ({
    request,
  }) => {
    const response = await request.get(`${BASE_URL}/index.json`);
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(Object.keys(body.entries).length).toBeGreaterThan(0);
    expect(body.entries[STORY_ID]).toBeDefined();
  });

  // Cloudflare Pages' default HTML handling redirects `/iframe.html` -> `/iframe`.
  // Storybook's manager loads the preview via an explicit `iframe.html` src, so
  // this redirect must still resolve to a real page, not a 404.
  test("iframe.html resolves (following Cloudflare's .html redirect)", async ({
    request,
  }) => {
    const response = await request.get(
      `${BASE_URL}/iframe.html?viewMode=story&id=${STORY_ID}`
    );
    expect(response.status()).toBe(200);
    const ct = response.headers()["content-type"] ?? "";
    expect(ct).toContain("text/html");
  });

  test("preview iframe mounts inside the manager UI", async ({ page }) => {
    await page.goto(`${BASE_URL}/?path=/story/${STORY_ID}`);
    const previewFrame = page.frameLocator("#storybook-preview-iframe");
    await expect(
      previewFrame.getByTestId("all-runners-panel")
    ).toBeVisible({ timeout: 20000 });
  });

  test("no uncaught JS errors when loading a story", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await page.goto(`${BASE_URL}/?path=/story/${STORY_ID}`);
    await page.waitForTimeout(3000);
    expect(errors).toHaveLength(0);
  });

  // Regression: MSW mocks stories against http://localhost:3000, but
  // client/src/config/index.ts used to fall back to a same-origin relative
  // baseUrl on any non-localhost host. On the deployed Pages site that meant
  // real (unmocked) requests to the static host, which 404'd and surfaced
  // as "Failed to load runners" instead of the mocked data.
  test("data-fetching story loads mocked runners, not an error state", async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/?path=/story/${RUNNERS_SCREEN_STORY_ID}`);
    const previewFrame = page.frameLocator("#storybook-preview-iframe");
    await expect(
      previewFrame.getByTestId("all-runners-list")
    ).toBeVisible({ timeout: 20000 });
    await expect(
      previewFrame.getByText("Failed to load runners")
    ).not.toBeVisible();
    await expect(previewFrame.getByText("Galopin Des Champs")).toBeVisible();
  });

  // Regression: the "Empty" story's MSW handler returned an /api/runners
  // response with no `pnlStats` field. AllRunnersScreen unconditionally does
  // `setPnlStats(result.pnlStats)`, so pnlStats became undefined and the
  // component crashed on `displayPnl.staked`, replacing the story with
  // Storybook's full-page error overlay instead of the empty state.
  test("Empty story renders the empty state, not a crash overlay", async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto(`${BASE_URL}/?path=/story/${RUNNERS_SCREEN_EMPTY_STORY_ID}`);
    const previewFrame = page.frameLocator("#storybook-preview-iframe");

    await expect(
      previewFrame.getByTestId("all-runners-list")
    ).toBeVisible({ timeout: 20000 });
    await expect(previewFrame.getByText("No runners found.")).toBeVisible();

    // Storybook renders a full-page overlay with this id when a story throws.
    await expect(previewFrame.locator("#error-message")).not.toBeVisible();
    expect(pageErrors).toHaveLength(0);
  });
});
