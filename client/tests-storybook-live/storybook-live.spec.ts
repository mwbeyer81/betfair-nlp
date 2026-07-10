import { test, expect } from "@playwright/test";

const BASE_URL = "https://punt-storybook.pages.dev";
const STORY_ID = "components-allrunnerspanel--default";

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
});
