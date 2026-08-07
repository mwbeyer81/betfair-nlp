import { test, expect } from "@playwright/test";

// Real browser, real frontend build, real backend, real (throwaway) Mongo —
// no mocking anywhere. Mirrors the auth/navigation conventions of
// client/tests/industry-sp-e2e.spec.ts (the ?email=&password= URL-login
// pattern is the current working mechanism; some older docs/specs reference
// a stale Basic-auth/auth-login-button convention that no longer matches
// AuthScreen.tsx).
// Overridable via LOCAL_CI_APP_URL so a second worktree can run this suite
// concurrently on its own claimed ports (see .claude/commands/worktree-ports.md
// and scripts/local-ci-e2e.sh's LOCAL_CI_FRONTEND_PORT). The script already
// let mongo/backend move; this hardcoded URL was what still forced every
// concurrent run onto the same frontend port. Default unchanged.
const APP_URL = process.env.LOCAL_CI_APP_URL ?? "http://localhost:8090/";

// The seeded slice is a single day — Nottingham, 3 June 2026 — so the whole
// hierarchy is known up front: year 2026 -> month 2026-06 -> day 2026-06-03.
const YEAR = "2026";
const MONTH = "2026-06";
const DAY = "2026-06-03";
const MEETING = "Nottingham|2026-06-03";
const RACE_ID = "919979";

async function gotoIspRacesForNottingham(page: import("@playwright/test").Page) {
  await page.goto(`${APP_URL}isp/races?email=matthew%40backbet.co.uk&password=beyer&courses=Nottingham`);
  await expect(page.getByTestId("industry-sp-races-screen")).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 30000 });
}

// Nothing on this screen auto-expands — every group is shut on arrival and
// only a tap opens it (see IspRacesScreen's expandedKeys). Any test that
// needs a race row has to walk the tree down by hand, which is exactly what
// a user does.
async function drillToRaces(page: import("@playwright/test").Page) {
  await page.getByTestId(`industry-sp-year-toggle-${YEAR}`).click();
  await page.getByTestId(`industry-sp-month-toggle-${MONTH}`).click();
  await expect(page.getByTestId(`industry-sp-day-${DAY}`)).toBeVisible({ timeout: 15000 });
  await page.getByTestId(`industry-sp-day-toggle-${DAY}`).click();
  await expect(page.getByTestId(`industry-sp-meeting-${MEETING}`)).toBeVisible({ timeout: 15000 });
  await page.getByTestId(`industry-sp-meeting-toggle-${MEETING}`).click();
}

test.describe("Industry SP races screen against the seeded slice (real frontend + backend)", () => {
  test("meeting header shows the seeded Nottingham meeting", async ({ page }) => {
    await gotoIspRacesForNottingham(page);
    await drillToRaces(page);
    const meeting = page.locator(`[data-testid="industry-sp-meeting-${MEETING}"]`);
    await expect(meeting).toBeVisible({ timeout: 15000 });
    await expect(meeting).toContainText("Nottingham");
  });

  test("drilling into the race shows the seeded winner with correct ISP", async ({ page }) => {
    await gotoIspRacesForNottingham(page);
    await drillToRaces(page);
    await page.getByTestId(`industry-sp-race-${RACE_ID}`).click();
    await expect(page.getByTestId("industry-race-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-race-loading")).not.toBeVisible({ timeout: 15000 });
    await expect(page.getByText("The Ginger Kid (IRE)")).toBeVisible();
    await expect(page.getByText("ISP 20/1")).toBeVisible();
  });

  test("arrives fully collapsed — only year headers, nothing below them", async ({ page }) => {
    await gotoIspRacesForNottingham(page);

    // The year the seeded data lives in is present and shut...
    await expect(page.getByTestId(`industry-sp-year-${YEAR}`)).toBeVisible();
    // ...and nothing below year level exists in the DOM at all.
    await expect(page.locator(`[data-testid="industry-sp-month-${MONTH}"]`)).toHaveCount(0);
    await expect(page.locator(`[data-testid="industry-sp-day-${DAY}"]`)).toHaveCount(0);
    await expect(page.locator(`[data-testid="industry-sp-meeting-${MEETING}"]`)).toHaveCount(0);
    await expect(page.locator(`[data-testid="industry-sp-race-${RACE_ID}"]`)).toHaveCount(0);

    // With nothing expanded, the toolbar offers to expand rather than collapse.
    await expect(page.getByTestId("industry-sp-collapse-all-toggle")).toContainText("Expand All");
  });

  test("a collapsed year still shows a real race count, not a placeholder", async ({ page }) => {
    await gotoIspRacesForNottingham(page);

    // Collapsed must not mean empty: the mount fetch still resolves the
    // year's first month, then that month's first day, so the shut year
    // header carries a real count rather than "Tap to load".
    const count = page.getByTestId(`industry-sp-year-count-${YEAR}`);
    await expect(count).toContainText("races", { timeout: 20000 });
    await expect(count).not.toContainText("Tap to load");
    // Still shut while showing it.
    await expect(page.locator(`[data-testid="industry-sp-month-${MONTH}"]`)).toHaveCount(0);
  });

  test("opening a month lists every day in it, all collapsed", async ({ page }) => {
    await gotoIspRacesForNottingham(page);
    await page.getByTestId(`industry-sp-year-toggle-${YEAR}`).click();
    await page.getByTestId(`industry-sp-month-toggle-${MONTH}`).click();

    // Every day the month could still contain gets its own row — not just
    // the one the seeded data falls on. Days before a month's confirmed data
    // start are clipped as provably empty (see mergeDayPlaceholders), so the
    // 3rd onward is what's expected here.
    await expect(page.getByTestId(`industry-sp-day-${DAY}`)).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("industry-sp-day-2026-06-10")).toBeVisible();
    await expect(page.getByTestId("industry-sp-day-2026-06-30")).toBeVisible();

    // Not one of those days is expanded — no meeting or race row exists yet,
    // including under the day that *did* load its races.
    await expect(page.locator(`[data-testid="industry-sp-meeting-${MEETING}"]`)).toHaveCount(0);
    await expect(page.locator(`[data-testid="industry-sp-race-${RACE_ID}"]`)).toHaveCount(0);
  });

  test("opening a month reveals every day's own count, unasked", async ({ page }) => {
    await gotoIspRacesForNottingham(page);
    await page.getByTestId(`industry-sp-year-toggle-${YEAR}`).click();
    await page.getByTestId(`industry-sp-month-toggle-${MONTH}`).click();

    // The one day that actually has races reports a real count...
    await expect(page.getByTestId(`industry-sp-day-count-${DAY}`)).toContainText("races", { timeout: 20000 });

    // ...and so does every other day in the month, without being tapped: the
    // seeded slice is one day, so these are honest, server-confirmed zeros.
    for (const other of ["2026-06-10", "2026-06-20", "2026-06-30"]) {
      await expect(page.getByTestId(`industry-sp-day-count-${other}`)).toContainText("0 races", { timeout: 20000 });
    }
    // "Tap to load" now means only "that probe failed" — nothing here should
    // be wearing it.
    await expect(page.getByTestId("industry-sp-races-screen")).not.toContainText("Tap to load");
  });

  test("revealing a day's count does not pull its races", async ({ page }) => {
    await gotoIspRacesForNottingham(page);
    await page.getByTestId(`industry-sp-year-toggle-${YEAR}`).click();
    await page.getByTestId(`industry-sp-month-toggle-${MONTH}`).click();
    await expect(page.getByTestId(`industry-sp-day-count-${DAY}`)).toContainText("races", { timeout: 20000 });

    // Numbers everywhere, but not a single meeting or race row: those still
    // wait for the row to be opened.
    await expect(page.locator(`[data-testid="industry-sp-meeting-${MEETING}"]`)).toHaveCount(0);
    await expect(page.locator(`[data-testid="industry-sp-race-${RACE_ID}"]`)).toHaveCount(0);
  });

  test("tapping an unloaded day fetches that day alone, not the whole month", async ({ page }) => {
    // Records the limit too: every day in the month is being probed for its
    // own count at the same time (limit=1, see enqueueStats), and those are a
    // different thing from the data page a tap pulls.
    const dayRequests: { window: string; limit: number }[] = [];
    await page.route("**/api/industry-sp**", route => {
      const url = new URL(route.request().url());
      const sub = url.searchParams.get("subMinDate");
      if (sub) {
        dayRequests.push({
          window: `${sub}..${url.searchParams.get("subMaxDate")}`,
          limit: parseInt(url.searchParams.get("limit") || "20", 10),
        });
      }
      return route.continue();
    });

    await gotoIspRacesForNottingham(page);
    await page.getByTestId(`industry-sp-year-toggle-${YEAR}`).click();
    await page.getByTestId(`industry-sp-month-toggle-${MONTH}`).click();
    await expect(page.getByTestId(`industry-sp-day-count-${DAY}`)).toContainText("races", { timeout: 20000 });

    // Every day in the month is probed for its count as it renders, so wait
    // for that to settle before measuring what the tap itself causes.
    await expect(page.getByTestId("industry-sp-day-count-2026-06-10")).toContainText("races", { timeout: 20000 });
    dayRequests.length = 0;
    await page.getByTestId("industry-sp-day-toggle-2026-06-10").click();
    await page.waitForTimeout(3000);

    // The races the tap pulled were scoped to that single day — never widened
    // to the month, and never a walk through the days before it.
    const dataPages = dayRequests.filter(r => r.limit > 1);
    expect(dataPages.length).toBeGreaterThan(0);
    expect(dataPages.every(r => r.window === "2026-06-10..2026-06-10")).toBe(true);
  });

  test("a loaded day still expands from anywhere other than its count", async ({ page }) => {
    await gotoIspRacesForNottingham(page);
    await page.getByTestId(`industry-sp-year-toggle-${YEAR}`).click();
    await page.getByTestId(`industry-sp-month-toggle-${MONTH}`).click();
    await expect(page.getByTestId(`industry-sp-day-count-${DAY}`)).toContainText("races", { timeout: 20000 });

    // Every count arrives on its own now, so no row is a tap target at all
    // (that is reserved for a failed probe) — and the day is still shut.
    await expect(page.locator(`[data-testid="industry-sp-day-load-${DAY}"]`)).toHaveCount(0);
    await expect(page.locator(`[data-testid="industry-sp-meeting-${MEETING}"]`)).toHaveCount(0);

    // Tapping the row itself opens it, exactly as it always did.
    await page.getByTestId(`industry-sp-day-toggle-${DAY}`).click();
    await expect(page.getByTestId(`industry-sp-meeting-${MEETING}`)).toBeVisible({ timeout: 15000 });
  });
});
