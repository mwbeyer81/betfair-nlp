import { test, expect } from "@playwright/test";

// Same deployment shape as storybook-live.spec.ts (punt-storybook.pages.dev)
// but for the new Model Performance Dashboard build, deployed to a plain S3
// static website bucket instead of Cloudflare Pages — see
// apps/storybook-aws/deploy.sh and .claude/commands/deploy-storybook.md.
const BASE_URL = "http://backbet-storybook.s3-website.eu-north-1.amazonaws.com";
const PANEL_VISIBLE_STORY_ID = "components-modelperformancedashboard--panel-visible";
const ITEMS_RENDERED_STORY_ID = "components-modelperformancedashboard--items-rendered";
const CALIBRATION_STORY_ID = "components-modelperformancedashboard--calibration-chart-renders";

test.describe("backbet-storybook.s3-website — Model Performance Dashboard", () => {
  test("GET / returns 200 and serves HTML", async ({ request }) => {
    const response = await request.get(`${BASE_URL}/`);
    expect(response.status()).toBe(200);
    const ct = response.headers()["content-type"] ?? "";
    expect(ct).toContain("text/html");
  });

  test("story index.json lists the new dashboard stories", async ({ request }) => {
    const response = await request.get(`${BASE_URL}/index.json`);
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.entries[PANEL_VISIBLE_STORY_ID]).toBeDefined();
    expect(body.entries[ITEMS_RENDERED_STORY_ID]).toBeDefined();
  });

  test("iframe.html resolves directly", async ({ request }) => {
    const response = await request.get(
      `${BASE_URL}/iframe.html?viewMode=story&id=${PANEL_VISIBLE_STORY_ID}`
    );
    expect(response.status()).toBe(200);
    const ct = response.headers()["content-type"] ?? "";
    expect(ct).toContain("text/html");
  });

  test("no uncaught JS errors when loading the dashboard", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", err => errors.push(err.message));
    await page.goto(`${BASE_URL}/?path=/story/${ITEMS_RENDERED_STORY_ID}`);
    await page.waitForTimeout(3000);
    expect(errors).toHaveLength(0);
  });

  // Regression: reported live via screenshot — the panel's header rendered,
  // but everything below it was a blank white area on this exact deployed
  // page, even though the DOM had all the right content (a Storybook
  // interaction test using toBeInTheDocument() doesn't catch this — the
  // element was present with zero rendered height). Root cause was two
  // pass-through wrapper <div>s between #storybook-root and every story's
  // own root never being given a height, so a story styled with
  // position:absolute + inset:0 had nothing to anchor against and
  // collapsed to 0px. Fixed in .storybook/preview-head.html. A real
  // bounding-box check (not just DOM presence) is the only way to catch a
  // regression of this exact class again.
  test("dashboard content actually renders with real height, not zero-height DOM", async ({ page }) => {
    await page.goto(`${BASE_URL}/?path=/story/${ITEMS_RENDERED_STORY_ID}`);
    const previewFrame = page.frameLocator("#storybook-preview-iframe");

    const panel = previewFrame.getByTestId("model-performance-dashboard-panel");
    await expect(panel).toBeVisible({ timeout: 20000 });

    const list = previewFrame.getByTestId("model-performance-dashboard-list");
    await expect(list).toBeVisible();
    const box = await list.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThan(200);

    await expect(previewFrame.getByTestId("model-performance-dashboard-training-params")).toBeVisible();
    await expect(previewFrame.getByTestId("model-performance-dashboard-pnl-without")).toBeVisible();
    await expect(previewFrame.getByTestId("model-performance-dashboard-pnl-with")).toBeVisible();

    // Storybook renders a full-page overlay with this id when a story throws.
    await expect(previewFrame.locator("#error-message")).not.toBeVisible();
  });

  // Regression: reported live via screenshot — text rendered in the
  // browser's fallback serif font (Times New Roman) instead of Inter,
  // because App.tsx loads Inter via useFonts() before the real app
  // renders, but Storybook's preview.tsx decorator never did. Fixed with
  // @font-face rules in .storybook/preview-head.html serving the same
  // .ttf files from client/public/fonts.
  test("title text renders in Inter, not a fallback serif font", async ({ page }) => {
    await page.goto(`${BASE_URL}/?path=/story/${PANEL_VISIBLE_STORY_ID}`);
    const previewFrame = page.frameLocator("#storybook-preview-iframe");
    const title = previewFrame.getByText("Model Performance", { exact: true });
    await expect(title).toBeVisible({ timeout: 20000 });

    const fontFamily = await title.evaluate(el => getComputedStyle(el).fontFamily);
    expect(fontFamily).toContain("Inter");
    expect(fontFamily.toLowerCase()).not.toContain("times");
  });

  test("calibration chart story renders its SVG points", async ({ page }) => {
    await page.goto(`${BASE_URL}/?path=/story/${CALIBRATION_STORY_ID}`);
    const previewFrame = page.frameLocator("#storybook-preview-iframe");
    const chart = previewFrame.getByTestId("model-performance-dashboard-calibration-chart");
    await expect(chart).toBeVisible({ timeout: 20000 });
    const box = await chart.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThan(100);
  });
});
