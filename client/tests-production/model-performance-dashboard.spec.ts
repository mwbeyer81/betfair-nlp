import { test, expect } from "@playwright/test";

// Exercises the Model Performance Dashboard (client/src/components/
// ModelPerformanceDashboard.tsx) against the real deployed develop app
// (app.backbet.co.uk) and real Lambda/Atlas backend — no mocks. This is the
// dashboard the comment-nlp-features retrain (modelVersionId
// xgb-20260726-110115) is meant to surface a new row in.
const APP_URL = "https://app.backbet.co.uk";
const LAMBDA_URL = "https://fd0xrhcmj0.execute-api.eu-north-1.amazonaws.com";

async function fetchRealToken(request: import("@playwright/test").APIRequestContext): Promise<string> {
  const response = await request.post(`${LAMBDA_URL}/api/auth/login`, {
    data: { username: "matthew", password: "beyer" },
  });
  const body = await response.json();
  return body.token as string;
}

// Same pattern as runners-load-smoke.spec.ts: inject a real JWT so the app
// is already authenticated on first paint, then apply the ISP filters
// (industry-sp-screen renders nothing until Apply is pressed) before
// opening the dashboard from its badge button.
async function gotoIspAndOpenDashboard(page: import("@playwright/test").Page) {
  const token = await fetchRealToken(page.request);
  await page.addInitScript((t) => {
    window.localStorage.setItem("auth_token", t);
  }, token);

  await page.goto(`${APP_URL}/isp`);
  await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 15000 });
  await page.getByTestId("industry-sp-filter-apply").click();
  await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 90000 });

  await expect(page.getByTestId("industry-sp-model-performance-button")).toBeVisible({ timeout: 15000 });
  await page.getByTestId("industry-sp-model-performance-button").click();
  await expect(page.getByTestId("model-performance-dashboard-panel")).toBeVisible({ timeout: 15000 });
}

test.describe("app.backbet.co.uk — Model Performance Dashboard", () => {
  test("badge opens the dashboard and the table lists real model_evaluations data", async ({ page }) => {
    await gotoIspAndOpenDashboard(page);

    await expect(page.getByTestId("model-performance-dashboard-loading")).not.toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("model-performance-dashboard-error")).not.toBeVisible();
    await expect(page.getByTestId("model-performance-dashboard-table")).toBeVisible();

    // The comment-nlp-features retrain wrote this exact run — confirms the
    // dashboard is reading live Atlas data, not stale/mocked data.
    await expect(page.getByTestId("model-performance-dashboard-table-row-xgb-20260726-110115")).toBeVisible({
      timeout: 15000,
    });
  });

  test("clicking a row shows metrics, training params, and calibration chart", async ({ page }) => {
    await gotoIspAndOpenDashboard(page);

    const row = page.getByTestId("model-performance-dashboard-table-row-xgb-20260726-110115");
    await expect(row).toBeVisible({ timeout: 15000 });
    await row.click();

    await expect(page.getByTestId("model-performance-dashboard-metrics")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("model-performance-dashboard-training-params")).toBeVisible();
    await expect(page.getByTestId("model-performance-dashboard-calibration-chart")).toBeVisible();

    // Values from the real retrain run (see AGENTS.md / this session) —
    // confirms the detail view surfaces genuine metrics, not placeholders.
    await expect(page.getByTestId("model-performance-dashboard-auc")).toContainText("0.7");
    await expect(page.getByTestId("model-performance-dashboard-logloss")).toContainText("0.3");
    await expect(page.getByTestId("model-performance-dashboard-brier")).toContainText("0.0");

    await page.getByTestId("model-performance-dashboard-back-to-table").click();
    await expect(page.getByTestId("model-performance-dashboard-table")).toBeVisible();
  });

  test("close button dismisses the panel", async ({ page }) => {
    await gotoIspAndOpenDashboard(page);

    await page.getByTestId("model-performance-dashboard-panel-close").click();
    await expect(page.getByTestId("model-performance-dashboard-panel")).not.toBeVisible();
  });

  test("diagnostic: GET /api/model-versions against the Lambda API directly returns the new run", async ({
    request,
  }) => {
    const token = await fetchRealToken(request);
    const response = await request.get(`${LAMBDA_URL}/api/model-versions`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.ok()).toBe(true);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    const entry = body.data.find((v: { id: string }) => v.id === "xgb-20260726-110115");
    expect(entry, "expected the comment-nlp-features retrain run to be present").toBeTruthy();
    expect(entry.runLabel).toBe("comment-nlp-features-merge");
    expect(entry.runMeta.featureCols).toEqual(
      expect.arrayContaining(["horseAvgExcuseScore", "horseTroubleInRunningRate", "horseTravelledWellRate"])
    );
  });
});
