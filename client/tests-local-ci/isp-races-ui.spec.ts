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

  test("opening a month loads only the first day with data; the rest stay unloaded", async ({ page }) => {
    await gotoIspRacesForNottingham(page);
    await page.getByTestId(`industry-sp-year-toggle-${YEAR}`).click();
    await page.getByTestId(`industry-sp-month-toggle-${MONTH}`).click();

    // The one day that actually has races reports a real count...
    const loaded = page.getByTestId(`industry-sp-day-count-${DAY}`);
    await expect(loaded).toContainText("races", { timeout: 20000 });
    await expect(loaded).not.toContainText("Tap to load");

    // ...and every other day in the month is untouched, so it says so rather
    // than claiming a confirmed zero.
    for (const other of ["2026-06-10", "2026-06-20", "2026-06-30"]) {
      await expect(page.getByTestId(`industry-sp-day-count-${other}`)).toContainText("Tap to load");
    }
  });

  test("tapping an unloaded day fetches that day alone, not the whole month", async ({ page }) => {
    const dayRequests: string[] = [];
    await page.route("**/api/industry-sp**", route => {
      const url = new URL(route.request().url());
      const sub = url.searchParams.get("subMinDate");
      if (sub) dayRequests.push(`${sub}..${url.searchParams.get("subMaxDate")}`);
      return route.continue();
    });

    await gotoIspRacesForNottingham(page);
    await page.getByTestId(`industry-sp-year-toggle-${YEAR}`).click();
    await page.getByTestId(`industry-sp-month-toggle-${MONTH}`).click();
    await expect(page.getByTestId(`industry-sp-day-count-${DAY}`)).toContainText("races", { timeout: 20000 });

    dayRequests.length = 0;
    await page.getByTestId("industry-sp-day-toggle-2026-06-10").click();
    await expect(page.getByTestId("industry-sp-day-count-2026-06-10")).not.toContainText("Tap to load", {
      timeout: 15000,
    });

    // Exactly one fetch, scoped to that single day.
    expect(dayRequests).toEqual(["2026-06-10..2026-06-10"]);
  });

  // Reported with a screenshot of build 924fb98: "when I tap on day it still
  // expands. It should load pnl but not expand. Tapping [anywhere] else other
  // than tap to load should expand." Days were the last level still missing
  // the load-only tap target years and months already had. Against the real
  // backend here, not a mock — the count and P&L that arrive are the server's
  // own for that date.
  test("tapping a day's Tap to load count fetches its numbers and leaves the row shut", async ({ page }) => {
    await gotoIspRacesForNottingham(page);
    await page.getByTestId(`industry-sp-year-toggle-${YEAR}`).click();
    await page.getByTestId(`industry-sp-month-toggle-${MONTH}`).click();
    await expect(page.getByTestId(`industry-sp-day-count-${DAY}`)).toContainText("races", { timeout: 20000 });

    // The seeded slice is one day, so every other day in June is a real,
    // never-probed placeholder — and offers its own load.
    const other = "2026-06-10";
    await expect(page.getByTestId(`industry-sp-day-count-${other}`)).toContainText("Tap to load");
    await page.getByTestId(`industry-sp-day-load-${other}`).click();

    // It answers in place: a confirmed count from the server, no row opened.
    await expect(page.getByTestId(`industry-sp-day-count-${other}`)).toContainText("0 races", { timeout: 20000 });
    await expect(page.getByTestId(`industry-sp-day-load-${other}`)).toHaveCount(0);
    await expect(page.locator(`[data-testid="industry-sp-meeting-${MEETING}"]`)).toHaveCount(0);
  });

  test("a loaded day still expands from anywhere other than its count", async ({ page }) => {
    await gotoIspRacesForNottingham(page);
    await page.getByTestId(`industry-sp-year-toggle-${YEAR}`).click();
    await page.getByTestId(`industry-sp-month-toggle-${MONTH}`).click();
    await expect(page.getByTestId(`industry-sp-day-count-${DAY}`)).toContainText("races", { timeout: 20000 });

    // The seeded day already has its numbers, so its count is inert text —
    // there is nothing left to load.
    await expect(page.locator(`[data-testid="industry-sp-day-load-${DAY}"]`)).toHaveCount(0);
    await expect(page.locator(`[data-testid="industry-sp-meeting-${MEETING}"]`)).toHaveCount(0);

    // Tapping the row itself opens it, exactly as it always did.
    await page.getByTestId(`industry-sp-day-toggle-${DAY}`).click();
    await expect(page.getByTestId(`industry-sp-meeting-${MEETING}`)).toBeVisible({ timeout: 15000 });
  });
});
