import { test, expect } from "@playwright/test";

// Same deployment shape as storybook-live.spec.ts (punt-storybook.pages.dev)
// but for the new Model Performance Dashboard build, deployed to a plain S3
// static website bucket instead of Cloudflare Pages — see
// apps/storybook-aws/deploy.sh and .claude/commands/deploy-storybook.md.
const BASE_URL = "http://backbet-storybook.s3-website.eu-north-1.amazonaws.com";
const PANEL_VISIBLE_STORY_ID = "components-modelperformancedashboard--panel-visible";
const ITEMS_RENDERED_STORY_ID = "components-modelperformancedashboard--items-rendered";
const CALIBRATION_STORY_ID = "components-modelperformancedashboard--calibration-chart-renders";
const LATEST_VERSION_ROW = "model-performance-dashboard-table-row-xgb-2026-07-10";

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

  // Regression: reported live via screenshot from an actual phone — a
  // redeploy landed, but the phone kept showing stale component code.
  // Root cause: iframe.html/index.json/project.json keep the same
  // filename every build (unlike the content-hashed *.iframe.bundle.js
  // chunks), but an earlier deploy script cached them with
  // max-age=31536000, immutable anyway — a browser that loaded iframe.html
  // once would never even revalidate it again for a year, no matter how
  // many redeploys happened underneath it. Fixed in
  // apps/storybook-aws/deploy.sh (force-upload every entry point with
  // no-cache on every deploy; only the genuinely hash-named bundle chunks
  // keep the long cache). This guards against that split ever regressing.
  test("entry-point files are never long-cached, only hash-named bundle chunks are", async ({ request }) => {
    const nonCacheable = ["iframe.html", "index.html", "index.json", "project.json"];
    for (const path of nonCacheable) {
      const response = await request.get(`${BASE_URL}/${path}`);
      const cacheControl = response.headers()["cache-control"] ?? "";
      expect(cacheControl, `${path} must not be long-cached`).not.toContain("immutable");
      expect(cacheControl).toContain("no-cache");
    }

    // Find one real content-hashed bundle chunk by reading iframe.html's own
    // script tags, rather than hardcoding a filename that changes every build.
    const iframeHtml = await (await request.get(`${BASE_URL}/iframe.html`)).text();
    const match = iframeHtml.match(/[\w.~-]+\.iframe\.bundle\.js/);
    expect(match, "expected to find at least one *.iframe.bundle.js reference in iframe.html").not.toBeNull();
    const bundleResponse = await request.get(`${BASE_URL}/${match![0]}`);
    expect(bundleResponse.headers()["cache-control"]).toContain("immutable");
  });

  test("no uncaught JS errors when loading the dashboard", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", err => errors.push(err.message));
    await page.goto(`${BASE_URL}/?path=/story/${ITEMS_RENDERED_STORY_ID}`);
    await page.waitForTimeout(3000);
    expect(errors).toHaveLength(0);
  });

  // The table listing every model version is the landing screen now — the
  // detail panel (training params/metrics/filters/P&L) only shows up after
  // tapping a row.
  test("table lands first, tapping a row opens the detail view with real height", async ({ page }) => {
    await page.goto(`${BASE_URL}/?path=/story/${ITEMS_RENDERED_STORY_ID}`);
    const previewFrame = page.frameLocator("#storybook-preview-iframe");

    const panel = previewFrame.getByTestId("model-performance-dashboard-panel");
    await expect(panel).toBeVisible({ timeout: 20000 });
    const table = previewFrame.getByTestId("model-performance-dashboard-table");
    await expect(table).toBeVisible();
    await expect(previewFrame.getByTestId("model-performance-dashboard-training-params")).not.toBeVisible();

    await previewFrame.getByTestId(LATEST_VERSION_ROW).click();

    // Regression: reported live via screenshot — the panel's header
    // rendered, but everything below it was a blank white area on this
    // exact deployed page, even though the DOM had all the right content
    // (a Storybook interaction test using toBeInTheDocument() doesn't
    // catch this — the element was present with zero rendered height).
    // Root cause was two pass-through wrapper <div>s between
    // #storybook-root and every story's own root never being given a
    // height, so a story styled with position:absolute + inset:0 had
    // nothing to anchor against and collapsed to 0px. Fixed in
    // .storybook/preview-head.html. A real bounding-box check (not just
    // DOM presence) is the only way to catch a regression of this class.
    const trainingParams = previewFrame.getByTestId("model-performance-dashboard-training-params");
    await expect(trainingParams).toBeVisible({ timeout: 20000 });
    const box = await trainingParams.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThan(50);

    await expect(previewFrame.getByTestId("model-performance-dashboard-pnl-without")).toBeVisible();
    await expect(previewFrame.getByTestId("model-performance-dashboard-pnl-with")).toBeVisible();
    await expect(previewFrame.getByTestId("model-performance-dashboard-back-to-table")).toBeVisible();

    // Storybook renders a full-page overlay with this id when a story throws.
    await expect(previewFrame.locator("#error-message")).not.toBeVisible();
  });

  test("back button returns from detail to the table", async ({ page }) => {
    await page.goto(`${BASE_URL}/?path=/story/${ITEMS_RENDERED_STORY_ID}`);
    const previewFrame = page.frameLocator("#storybook-preview-iframe");

    await previewFrame.getByTestId(LATEST_VERSION_ROW).click();
    await expect(previewFrame.getByTestId("model-performance-dashboard-training-params")).toBeVisible({ timeout: 20000 });

    await previewFrame.getByTestId("model-performance-dashboard-back-to-table").click();

    await expect(previewFrame.getByTestId("model-performance-dashboard-table")).toBeVisible();
    await expect(previewFrame.getByTestId("model-performance-dashboard-training-params")).not.toBeVisible();
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

  test("calibration chart renders its SVG points after opening detail", async ({ page }) => {
    // This story's own play() function (CalibrationChartRenders in
    // ModelPerformanceDashboard.stories.tsx) already clicks through to the
    // detail view on its own — Storybook auto-runs play() on render even
    // outside the test-runner, confirmed by this test timing out waiting to
    // click an already-gone table row before this fix. No manual click
    // needed here; just wait for the chart the story's own play() reveals.
    await page.goto(`${BASE_URL}/?path=/story/${CALIBRATION_STORY_ID}`);
    const previewFrame = page.frameLocator("#storybook-preview-iframe");

    const chart = previewFrame.getByTestId("model-performance-dashboard-calibration-chart");
    await expect(chart).toBeVisible({ timeout: 20000 });
    const box = await chart.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThan(100);
  });

  // Storybook's own "viewport" parameter doesn't actually resize anything in
  // this build (@storybook/addon-viewport was removed for Storybook 9
  // incompatibility — confirmed empirically: window.innerWidth stayed at
  // whatever the real browser viewport was regardless of the parameter), so
  // Storybook interaction tests can't reliably exercise the table's
  // narrow-vs-wide layouts. This is the one place with real control over the
  // browser's actual viewport, which is what useResponsive()'s
  // useWindowDimensions() reads from.
  test("table renders as stacked cards on a narrow (mobile) viewport", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/?path=/story/${ITEMS_RENDERED_STORY_ID}`);
    const previewFrame = page.frameLocator("#storybook-preview-iframe");

    await expect(previewFrame.getByTestId("model-performance-dashboard-table")).toBeVisible({ timeout: 20000 });
    await expect(previewFrame.getByTestId("model-performance-dashboard-table-header")).not.toBeVisible();
    await expect(previewFrame.getByTestId(LATEST_VERSION_ROW)).toBeVisible();

    // Regression: reported live via screenshot from an actual phone — the
    // narrow layout has no header row (unlike wide, where AUC-ROC/LogLoss/
    // Brier tooltips live on the column headers), so a lay person looking
    // at the stacked cards had no way to find out what those fields mean.
    // Fixed with a dedicated metrics legend shown only on narrow layouts.
    const legend = previewFrame.getByTestId("model-performance-dashboard-metrics-legend");
    await expect(legend).toBeVisible();
    await expect(previewFrame.getByTestId("model-performance-dashboard-tooltip-text-aucRoc")).not.toBeVisible();
    await previewFrame.getByTestId("model-performance-dashboard-tooltip-toggle-aucRoc").click();
    await expect(previewFrame.getByTestId("model-performance-dashboard-tooltip-text-aucRoc")).toContainText("coin flip");

    // Tapping a row still works to reach the detail view at this width.
    await previewFrame.getByTestId(LATEST_VERSION_ROW).click();
    await expect(previewFrame.getByTestId("model-performance-dashboard-training-params")).toBeVisible({ timeout: 20000 });

    await context.close();
  });

  test("table renders as a column table on a wide (desktop) viewport", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/?path=/story/${ITEMS_RENDERED_STORY_ID}`);
    const previewFrame = page.frameLocator("#storybook-preview-iframe");

    const header = previewFrame.getByTestId("model-performance-dashboard-table-header");
    await expect(header).toBeVisible({ timeout: 20000 });
    await expect(header).toContainText("AUC-ROC");

    await previewFrame.getByTestId(LATEST_VERSION_ROW).click();
    await expect(previewFrame.getByTestId("model-performance-dashboard-training-params")).toBeVisible({ timeout: 20000 });

    await context.close();
  });
});
