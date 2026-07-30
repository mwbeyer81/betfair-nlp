import { test, expect } from "./fixtures";

// fixtures.ts's daily-races mock has hrs_1 "Fixture Star" (Newton Abbot,
// rac_test_0001) with modelWinProbability 25 — qualifies for Today's
// Picks once the min-model-win-probability filter is applied at 20 (same
// fixture other daily-races.spec.ts tests already rely on).
async function applyPicksFilterAndOpenBetDialog(page: import("@playwright/test").Page) {
  await page.goto("/daily-races");
  await expect(page.getByTestId("daily-races-screen")).toBeVisible({ timeout: 10000 });
  await page.getByTestId("daily-races-min-model-win-probability").fill("20");
  await page.getByTestId("daily-races-filter-apply").click();
  await expect(page.getByTestId("daily-races-picks-list")).toBeVisible();
  await expect(page.getByTestId("daily-races-pick-bet-hrs_1")).toBeVisible();
  await page.getByTestId("daily-races-pick-bet-hrs_1").click();
  await expect(page.getByTestId("place-bet-dialog")).toBeVisible();
}

test.describe("Bet button — full loop (MSW mocked)", () => {
  test("badge opens dialog without navigating to the race", async ({ page }) => {
    await applyPicksFilterAndOpenBetDialog(page);
    await expect(page.getByTestId("place-bet-dialog")).toContainText("Fixture Star");
    // Proves the badge's own stopPropagation worked — still on Daily Races,
    // not navigated into the race screen.
    await expect(page.getByTestId("daily-races-screen")).toBeVisible();
  });

  test("confirming schedules a real bet order and closes the dialog", async ({ page }) => {
    await applyPicksFilterAndOpenBetDialog(page);
    await page.getByTestId("place-bet-dialog-target-profit-input").fill("20");
    await page.getByTestId("place-bet-dialog-max-stake-input").fill("10");
    await expect(page.getByTestId("place-bet-dialog-min-price-preview")).toContainText("2/1 (3.00)");
    await page.getByTestId("place-bet-dialog-confirm").click();
    await expect(page.getByTestId("place-bet-dialog")).not.toBeVisible({ timeout: 10000 });
  });

  test("validation error from the API keeps the dialog open with the message shown", async ({ page }) => {
    await applyPicksFilterAndOpenBetDialog(page);
    // 0 stake still passes this dialog's own client-side validation gate
    // (it disables Confirm before submit) — override the route so this
    // test exercises the server's own 400 response path instead, not the
    // client-side check already covered by Storybook.
    await page.route((url) => url.pathname === "/api/bet-orders", (route) => {
      if (route.request().method() === "POST") {
        route.fulfill({ status: 400, json: { success: false, error: "targetProfit must be a positive number" } });
        return;
      }
      route.fulfill({ json: { success: true, data: [], count: 0 } });
    });
    await page.getByTestId("place-bet-dialog-target-profit-input").fill("20");
    await page.getByTestId("place-bet-dialog-max-stake-input").fill("10");
    await page.getByTestId("place-bet-dialog-confirm").click();
    await expect(page.getByTestId("place-bet-dialog-error")).toHaveText("targetProfit must be a positive number");
    await expect(page.getByTestId("place-bet-dialog")).toBeVisible();
  });

  test("Bets header link -> Scheduled Bets screen shows the just-created order, cancel updates its status", async ({ page }) => {
    await applyPicksFilterAndOpenBetDialog(page);
    await page.getByTestId("place-bet-dialog-target-profit-input").fill("20");
    await page.getByTestId("place-bet-dialog-max-stake-input").fill("10");
    await page.getByTestId("place-bet-dialog-confirm").click();
    await expect(page.getByTestId("place-bet-dialog")).not.toBeVisible({ timeout: 10000 });

    await page.getByTestId("daily-races-menu-bets-link").click();
    await expect(page.getByTestId("scheduled-bets-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("scheduled-bets-list")).toBeVisible();

    const item = page.locator('[data-testid^="scheduled-bet-item-"]').filter({ hasText: "Fixture Star" });
    await expect(item).toBeVisible();
    await expect(item.getByText("Pending")).toBeVisible();
    await expect(item).toContainText("Back at 2/1 (3.00)+ to win £20.00 (stake up to £10.00)");

    const itemTestId = await item.getAttribute("data-testid");
    await item.locator(`[data-testid="${itemTestId!.replace("scheduled-bet-item-", "scheduled-bet-cancel-")}"]`).click();
    await expect(item.getByText("Cancelled")).toBeVisible({ timeout: 10000 });
    await expect(page.locator(`[data-testid="${itemTestId!.replace("scheduled-bet-item-", "scheduled-bet-cancel-")}"]`)).not.toBeVisible();
  });

  test("Scheduled Bets screen shows the empty state with no orders", async ({ page }) => {
    await page.goto("/bets");
    await expect(page.getByTestId("scheduled-bets-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("scheduled-bets-empty")).toBeVisible();
    await expect(page.getByTestId("scheduled-bets-list")).not.toBeVisible();
  });

  test("Scheduled Bets back button returns to Daily Races", async ({ page }) => {
    await page.goto("/bets");
    await expect(page.getByTestId("scheduled-bets-screen")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("scheduled-bets-back-button").click();
    await expect(page.getByTestId("daily-races-screen")).toBeVisible({ timeout: 10000 });
  });
});

// Regression test for a real production screenshot (a desktop browser
// window on /daily-races): PlaceBetDialog passed no style to Paper's
// Dialog, which only insets itself by a fixed margin — so the bet form
// stretched to nearly the full window width, putting the Schedule/Bet now
// toggle and the Cancel/Confirm buttons at opposite ends of the screen.
// Fixed with a maxWidth cap on the Dialog itself. Runs at a wide viewport
// specifically; every other test in this file uses the default one, where
// this bug is invisible.
test.describe("Bet dialog at a wide desktop viewport (MSW mocked)", () => {
  test.use({ viewport: { width: 1900, height: 1000 } });

  test("the dialog is capped well short of the viewport width, and centered", async ({ page }) => {
    await applyPicksFilterAndOpenBetDialog(page);
    // Paper puts the testID on the full-screen modal wrapper and exposes
    // the visible card as "<testID>-surface" — that's the box to measure.
    const box = (await page.getByTestId("place-bet-dialog-surface").boundingBox())!;
    // Before the fix this measured ~1850px — essentially the full window.
    expect(box.width).toBeLessThanOrEqual(480);
    expect(box.width).toBeGreaterThan(300);
    // Centered means roughly equal empty space on both sides.
    const rightGap = 1900 - (box.x + box.width);
    expect(Math.abs(box.x - rightGap)).toBeLessThan(5);
  });

  test("the dialog's own controls stay together rather than spanning the window", async ({ page }) => {
    await applyPicksFilterAndOpenBetDialog(page);
    const toggle = (await page.getByTestId("place-bet-dialog-order-type-scheduled").boundingBox())!;
    const confirm = (await page.getByTestId("place-bet-dialog-confirm").boundingBox())!;
    // The Schedule half of the toggle used to be ~900px wide on its own.
    expect(toggle.width).toBeLessThan(300);
    // Confirm sits at the dialog's right edge, not the window's.
    expect(confirm.x + confirm.width).toBeLessThan(1900 / 2 + 240 + 1);
  });

  test("still fills the width at a phone viewport — the cap must not shrink it there", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await applyPicksFilterAndOpenBetDialog(page);
    const box = (await page.getByTestId("place-bet-dialog-surface").boundingBox())!;
    expect(box.width).toBeGreaterThan(390 - 120);
  });
});
