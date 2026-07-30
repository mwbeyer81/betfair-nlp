import { test, expect, anonTest } from "./fixtures";
import type { Page } from "@playwright/test";

// fixtures.ts mocks 1 race (914592 Cheltenham Chase) with 3 runners (ISP 4.5, 9.2, 2.1).
// Default ISP range 1-1000 means all 3 runners are in range. Default maxRIR=30 shows the race.
// /isp is the filters + PnL screen (no race list of its own); /isp/races is the
// dedicated races-list screen that reads whatever filters are in the URL.

// Drives the DateRangePicker (see DateRangePicker.tsx): open the picker,
// jump straight to a year via the header's year-grid (selecting a year
// always resets the visible month to January, making month navigation
// from there fully deterministic regardless of whatever month happened to
// be showing beforehand), step forward to the target month, tap the day,
// repeat for the second date, then Apply.
async function pickDateRange(page: Page, fromDate: string, toDate: string) {
  const prefix = "industry-sp-date-range-picker";
  await page.getByTestId(prefix).click();
  await expect(page.getByTestId(`${prefix}-modal`)).toBeVisible();

  for (const dateStr of [fromDate, toDate]) {
    const [year, month] = dateStr.split("-").map(Number);
    await page.getByTestId(`${prefix}-header-title`).click();
    await expect(page.getByTestId(`${prefix}-year-grid`)).toBeVisible();
    await page.getByTestId(`${prefix}-year-${year}`).click();
    for (let i = 0; i < month - 1; i++) {
      await page.getByTestId(`${prefix}-next-month`).click();
    }
    await page.getByTestId(`${prefix}-day-${dateStr}`).click();
  }

  await page.getByTestId(`${prefix}-apply`).click();
}

// A bare /isp load (no query string) must not silently run the default
// query and present results the user never asked for — most of this
// suite's tests want the *loaded* state to exist, so they navigate then
// press Apply once via this helper. The bare-load behavior itself gets
// its own dedicated describe block below, which deliberately does NOT
// use this helper.
async function gotoIspAndApplyDefaults(page: Page) {
  await page.goto("/isp");
  await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
  await page.getByTestId("industry-sp-filter-apply").click();
  await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 15000 });
}

test.describe("Industry SP filters screen — bare load applies nothing (MSW mocked)", () => {
  // Regression coverage for: the /isp screen used to auto-run the default
  // query on every mount, so the very first thing a user saw — before
  // touching a single filter — was a fully computed Split A/Split B PnL
  // result and filter chips already populated from real data. That's the
  // opposite of what "Apply" should mean: nothing should be fetched, and
  // nothing should be shown as a result, until the user explicitly presses
  // it (or arrives via a URL that already carries filter state).
  test("does not fetch /splits and shows the idle placeholder, not results", async ({ page }) => {
    const splitsRequests: string[] = [];
    page.on("request", req => {
      if (req.url().includes("/api/industry-sp/splits")) splitsRequests.push(req.url());
    });

    await page.goto("/isp");
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });

    // No loading indicator ever appears — there's nothing in flight.
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible();
    // Split cards show the "not yet applied" placeholder, not real numbers.
    await expect(page.getByTestId("industry-sp-split-idle-a")).toBeVisible();
    await expect(page.getByTestId("industry-sp-split-idle-a")).toContainText("Press Apply");
    await expect(page.getByTestId("industry-sp-split-idle-b")).toBeVisible();
    await expect(page.getByTestId("industry-sp-pnl-a")).not.toBeVisible();
    await expect(page.getByTestId("industry-sp-pnl-b")).not.toBeVisible();
    await expect(page.getByTestId("industry-sp-split-empty-a")).not.toBeVisible();
    // Filter chips don't know about the data either — no course names etc.
    // have been fetched, just the row's own placeholder.
    await expect(page.getByTestId("industry-sp-course-loading")).toBeVisible();
    await expect(page.getByTestId("industry-sp-course-loading")).toContainText("Apply to load options");
    await expect(page.getByTestId("industry-sp-course-Cheltenham")).not.toBeVisible();

    // No amount of waiting changes that — there's no background fetch to
    // eventually resolve, unlike the old "pending" state.
    await page.waitForTimeout(800);
    expect(splitsRequests.length).toBe(0);
  });

  test("pressing Apply for the first time fetches and populates real results", async ({ page }) => {
    const splitsRequests: string[] = [];
    page.on("request", req => {
      if (req.url().includes("/api/industry-sp/splits")) splitsRequests.push(req.url());
    });

    await page.goto("/isp");
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
    expect(splitsRequests.length).toBe(0);

    await page.getByTestId("industry-sp-filter-apply").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 15000 });

    expect(splitsRequests.length).toBe(1);
    await expect(page.getByTestId("industry-sp-split-idle-a")).not.toBeVisible();
    await expect(page.getByTestId("industry-sp-course-Cheltenham")).toBeVisible();
  });

  test("pressing Apply for the first time splits into two distinct halves, not the same full range twice", async ({ page }) => {
    // Regression test: the first-ever Apply (from the idle, bare-load
    // state) read the Split A/B row-range boxes as if they already held a
    // real computed split, but they were still at their pre-fetch
    // placeholder values ("1"/"0") with totalRaces still 0 — this computed
    // Split A as "races 1-<end>" (toA null, since 1 >= totalRaces(0)) and
    // Split B as the exact same "1-<end>", instead of two actual halves.
    // Overrides the fixture's normal 1-race mock with a fixed totalRaces
    // of 2500 so a genuine half/half split has distinguishable boundaries.
    await page.route("**/api/industry-sp/splits*", async (route) => {
      const url = new URL(route.request().url());
      const totalRaces = 2500;
      const fromRowARaw = url.searchParams.get("fromRowA");
      let fromRowA: number, toRowA: number, fromRowB: number, toRowB: number;
      if (fromRowARaw == null) {
        const half = Math.floor(totalRaces / 2);
        fromRowA = 1; toRowA = half; fromRowB = half + 1; toRowB = totalRaces;
      } else {
        fromRowA = parseInt(fromRowARaw, 10);
        toRowA = parseInt(url.searchParams.get("toRowA") ?? String(totalRaces), 10);
        fromRowB = parseInt(url.searchParams.get("fromRowB") ?? "1", 10);
        toRowB = totalRaces;
      }
      const pnl = { staked: 3.97, returns: 5.55, pnl: 1.58, count: 4 };
      await route.fulfill({
        json: {
          success: true,
          totalRaces,
          totalRunners: totalRaces * 2,
          filterBounds: { maxRunnersPerRace: 29, maxIsp: 1000, minIsp: 1.1 },
          countries: ["GB", "IE"],
          courses: ["Cheltenham", "Ascot"],
          goings: ["Good", "Soft"],
          raceClasses: ["Class 1", "Class 2"],
          raceTypes: ["Chase", "Hurdle"],
          splitA: { fromRow: fromRowA, toRow: toRowA, total: toRowA - fromRowA + 1, totalRunners: 2, pnlStats: pnl },
          splitB: { fromRow: fromRowB, toRow: toRowB, total: toRowB - fromRowB + 1, totalRunners: 2, pnlStats: pnl },
        },
      });
    });

    await page.goto("/isp");
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-sp-split-idle-a")).toBeVisible();

    await page.getByTestId("industry-sp-filter-apply").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 15000 });

    // Two distinct, non-overlapping race ranges, which is what this test
    // actually guards against (the same full range appearing twice).
    await expect(page.getByTestId("industry-sp-split-card-a")).toContainText("races 1–1250");
    await expect(page.getByTestId("industry-sp-split-card-b")).toContainText("races 1251–2500");
  });

  test("editing Split A/B before ever pressing Apply is still honored on that first Apply", async ({ page }) => {
    // Regression: reported live via screenshot — a user who typed into the
    // Split A/B race boxes as their very first interaction (instead of
    // applying the default split first) had their edit silently discarded;
    // Apply just re-showed the auto-computed default split. Root cause was
    // in applyFilter's split-bound math: totalRaces is still 0 before any
    // fetch has ever resolved, so clamping the typed value against that
    // unknown 0 ceiling crushed it down to 1 and then read that as "reached
    // the end" (null / open-ended), indistinguishable from an untouched
    // placeholder box. See splitBoxesEditedRef / resolveSplitBound in
    // IndustrySpScreen.tsx.
    let capturedToRowA: string | null | undefined;
    await page.route("**/api/industry-sp/splits*", async (route) => {
      const url = new URL(route.request().url());
      if (capturedToRowA === undefined) {
        capturedToRowA = url.searchParams.get("toRowA");
      }
      await route.fallback();
    });

    await page.goto("/isp");
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("industry-sp-to-row-a").fill("1589");
    await page.getByTestId("industry-sp-filter-apply").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 15000 });

    expect(capturedToRowA).toBe("1589");
  });

  test("a URL that already carries filter params fetches immediately, without an extra Apply", async ({ page }) => {
    // Distinguishes a genuinely bare load from one arriving via a
    // bookmark/shared link/back-navigation, which already represents
    // explicit, already-applied filter intent and should show results
    // right away — same as before this change.
    await page.goto("/isp?maxInIspRange=2");
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("industry-sp-split-idle-a")).not.toBeVisible();
  });
});

test.describe("Industry SP filters screen (MSW mocked)", () => {
  test.beforeEach(async ({ page }) => {
    await gotoIspAndApplyDefaults(page);
  });

  test("nav link from /events opens /isp", async ({ page }) => {
    await page.goto("/events");
    await expect(page.getByTestId("events-screen")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("events-menu-isp-link").click();
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
  });

  test("Log Out button clears the session without leaving /isp (it's public)", async ({ page }) => {
    await expect(page.getByTestId("industry-sp-logout-button")).toBeVisible();
    await page.getByTestId("industry-sp-logout-button").click();
    // /isp is public — logging out doesn't navigate anywhere, it just
    // swaps the header buttons back to Sign Up / Log In.
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible();
    await expect(page.getByTestId("industry-sp-signup-button")).toBeVisible();
    await expect(page.getByTestId("industry-sp-login-button")).toBeVisible();
    await expect(page.getByTestId("industry-sp-logout-button")).not.toBeVisible();
  });

  test("/ (home page) shows Industry SP screen directly", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("events-screen")).not.toBeVisible();
  });

  test("Account button toggles a panel showing the signed-in email and verification status", async ({ page }) => {
    await expect(page.getByTestId("industry-sp-account-panel")).not.toBeVisible();

    await page.getByTestId("industry-sp-account-button").click();
    const panel = page.getByTestId("industry-sp-account-panel");
    await expect(panel).toBeVisible();
    // fixtures.ts's default /api/auth/me mock (see setupApiMocks).
    await expect(panel).toContainText("matthew@backbet.co.uk");
    await expect(panel).toContainText("Email verified");

    await page.getByTestId("industry-sp-account-panel-close").click();
    await expect(page.getByTestId("industry-sp-account-panel")).not.toBeVisible();
  });

  test("View Races button navigates to /isp/races", async ({ page }) => {
    await page.getByTestId("industry-sp-view-races-button-a").click();
    await expect(page.getByTestId("industry-sp-races-screen")).toBeVisible({ timeout: 10000 });
    expect(page.url()).toContain("/isp/races");
  });

  test("both split cards are shown, each with their own View Races button", async ({ page }) => {
    await expect(page.getByTestId("industry-sp-split-card-a")).toBeVisible();
    await expect(page.getByTestId("industry-sp-split-card-b")).toBeVisible();
    await expect(page.getByTestId("industry-sp-view-races-button-a")).toBeVisible();
    await expect(page.getByTestId("industry-sp-view-races-button-b")).toBeVisible();
  });

  test("# in ISP filter controls are present", async ({ page }) => {
    await expect(page.getByTestId("industry-sp-min-rir-value")).toBeVisible();
    await expect(page.getByTestId("industry-sp-max-rir-value")).toBeVisible();
  });

  test("trainer-form filter controls are present and respond to Apply/Reset", async ({ page }) => {
    // React Native Web's accessibilityState={{checked}} only emits
    // aria-checked when true — it's simply absent from the DOM when false,
    // rather than rendered as aria-checked="false".
    await expect(page.getByTestId("industry-sp-trainer-form-min-win-rate")).toBeVisible();
    await expect(page.getByTestId("industry-sp-has-trainer-form")).toBeVisible();
    await expect(page.getByTestId("industry-sp-has-trainer-form")).not.toHaveAttribute("aria-checked", "true");

    await page.getByTestId("industry-sp-has-trainer-form").click();
    await expect(page.getByTestId("industry-sp-has-trainer-form")).toHaveAttribute("aria-checked", "true");
    await page.getByTestId("industry-sp-filter-apply").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-sp-has-trainer-form")).toHaveAttribute("aria-checked", "true");

    await page.getByTestId("industry-sp-filter-reset").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-sp-has-trainer-form")).not.toHaveAttribute("aria-checked", "true");
  });

  test("checking 'Has trainer form' sends minTrainerFormRunners=1 to /api/industry-sp/splits", async ({ page }) => {
    let capturedMinTFR: string | null = null;
    await page.route("**/api/industry-sp/splits*", async (route) => {
      const url = new URL(route.request().url());
      capturedMinTFR = url.searchParams.get("minTrainerFormRunners");
      await route.continue();
    });

    await page.getByTestId("industry-sp-has-trainer-form").click();
    await page.getByTestId("industry-sp-filter-apply").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 10000 });
    expect(capturedMinTFR).toBe("1");
  });

  test("Model Win % filter is present and sends minModelWinProbability to /api/industry-sp/splits", async ({ page }) => {
    await expect(page.getByTestId("industry-sp-min-model-win-probability")).toBeVisible();

    let captured: string | null = null;
    await page.route("**/api/industry-sp/splits*", async (route) => {
      const url = new URL(route.request().url());
      captured = url.searchParams.get("minModelWinProbability");
      await route.continue();
    });

    await page.getByTestId("industry-sp-min-model-win-probability").fill("30");
    await page.getByTestId("industry-sp-filter-apply").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 10000 });
    expect(captured).toBe("30");

    await page.getByTestId("industry-sp-filter-reset").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-sp-min-model-win-probability")).toHaveValue("0");
  });

  test("'Model beats SP' checkbox is present and sends onlyModelBeatsSp=true to /api/industry-sp/splits", async ({ page }) => {
    await expect(page.getByTestId("industry-sp-only-model-beats-sp")).toBeVisible();
    await expect(page.getByTestId("industry-sp-only-model-beats-sp")).not.toHaveAttribute("aria-checked", "true");

    let captured: string | null = null;
    await page.route("**/api/industry-sp/splits*", async (route) => {
      const url = new URL(route.request().url());
      captured = url.searchParams.get("onlyModelBeatsSp");
      await route.continue();
    });

    await page.getByTestId("industry-sp-only-model-beats-sp").click();
    await expect(page.getByTestId("industry-sp-only-model-beats-sp")).toHaveAttribute("aria-checked", "true");
    await page.getByTestId("industry-sp-filter-apply").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 10000 });
    expect(captured).toBe("true");

    await page.getByTestId("industry-sp-filter-reset").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-sp-only-model-beats-sp")).not.toHaveAttribute("aria-checked", "true");
  });

  test("Split A/B's race-range boxes are always visible, with a '/totalRaces' hint", async ({ page }) => {
    await expect(page.getByTestId("industry-sp-from-row-a")).toBeVisible();
    await expect(page.getByTestId("industry-sp-to-row-a")).toBeVisible();
    await expect(page.getByTestId("industry-sp-from-row-b")).toBeVisible();
    await expect(page.getByTestId("industry-sp-to-row-b")).toBeVisible();
    await expect(page.getByTestId("industry-sp-race-bound-a")).toContainText("/");
  });

  test("typing a custom race range and applying sends fromRowA/toRowA/fromRowB", async ({ page }) => {
    // Overrides the shared beforeEach's tiny 1-race default fixture with a
    // real multi-race total, needed for THIS test's very first Apply too —
    // resolveSplitBound (IndustrySpScreen.tsx) clamps a typed "to" value
    // down to the open-ended (null) sentinel once it reaches the
    // currently-known total, and a 1-race total leaves no room for any
    // typed value at all.
    // Echoes back whatever fromRowA/toRowA/fromRowB the request actually
    // carried (falling back to a fixed 1250/2500 half/half default when
    // none are present) — the URL is synced from the *response*
    // (syncUrl reads result.splitA.fromRow/toRow), so a mock that just
    // returns fixed numbers regardless of the request would make the URL
    // reflect the mock's canned values instead of what was actually typed.
    let captured: Record<string, string | null> = {};
    await page.route("**/api/industry-sp/splits*", async (route) => {
      const url = new URL(route.request().url());
      captured = {
        fromRowA: url.searchParams.get("fromRowA"),
        toRowA: url.searchParams.get("toRowA"),
        fromRowB: url.searchParams.get("fromRowB"),
      };
      const totalRaces = 2500;
      const fromRowARaw = url.searchParams.get("fromRowA");
      let fromRowA: number, toRowA: number | null, fromRowB: number, toRowB: number | null;
      if (fromRowARaw == null) {
        fromRowA = 1; toRowA = 1250; fromRowB = 1251; toRowB = null;
      } else {
        fromRowA = parseInt(fromRowARaw, 10);
        toRowA = url.searchParams.get("toRowA") != null ? parseInt(url.searchParams.get("toRowA")!, 10) : null;
        fromRowB = url.searchParams.get("fromRowB") != null ? parseInt(url.searchParams.get("fromRowB")!, 10) : 1;
        toRowB = url.searchParams.get("toRowB") != null ? parseInt(url.searchParams.get("toRowB")!, 10) : null;
      }
      const pnl = { staked: 3.97, returns: 5.55, pnl: 1.58, count: 4 };
      await route.fulfill({
        json: {
          success: true, totalRaces, totalRunners: totalRaces * 2, raceCap: 1000,
          filterBounds: { maxRunnersPerRace: 29, maxIsp: 1000, minIsp: 1.1 },
          countries: ["GB", "IE"], courses: ["Cheltenham", "Ascot"], goings: ["Good", "Soft"],
          raceClasses: ["Class 1", "Class 2"], raceTypes: ["Chase", "Hurdle"],
          splitA: { fromRow: fromRowA, toRow: toRowA, total: (toRowA ?? totalRaces) - fromRowA + 1, totalRunners: 4, pnlStats: pnl },
          splitB: { fromRow: fromRowB, toRow: toRowB, total: (toRowB ?? totalRaces) - fromRowB + 1, totalRunners: 4, pnlStats: pnl },
        },
      });
    });

    await page.goto("/isp");
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("industry-sp-filter-apply").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 10000 });

    await page.getByTestId("industry-sp-to-row-a").fill("700");
    await page.getByTestId("industry-sp-filter-apply").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 10000 });

    expect(captured.fromRowA).toBe("1");
    expect(captured.toRowA).toBe("700");
    expect(page.url()).toContain("toRowA=700");
  });

  test("reloading a URL with an explicit race-range split restores it as the active split (not the default)", async ({ page }) => {
    // A large enough mocked totalRaces that splitB.fromRow=3 doesn't
    // exceed it — otherwise the "stale explicit split" self-heal
    // (isStaleSplit in IndustrySpScreen.tsx) correctly kicks in and
    // discards the explicit params on an automatic follow-up fetch, which
    // is real, intentional behavior this test isn't about.
    let captured: Record<string, string | null> = {};
    await page.route("**/api/industry-sp/splits*", async (route) => {
      const url = new URL(route.request().url());
      captured = {
        fromRowA: url.searchParams.get("fromRowA"),
        toRowA: url.searchParams.get("toRowA"),
        fromRowB: url.searchParams.get("fromRowB"),
        toRowB: url.searchParams.get("toRowB"),
      };
      await route.fulfill({
        json: {
          success: true, totalRaces: 900, totalRunners: 1800, raceCap: 1000,
          filterBounds: { maxRunnersPerRace: 29, maxIsp: 1000, minIsp: 1.1 },
          countries: ["GB", "IE"], courses: ["Cheltenham", "Ascot"], goings: ["Good", "Soft"],
          raceClasses: ["Class 1", "Class 2"], raceTypes: ["Chase", "Hurdle"],
          splitA: { fromRow: 1, toRow: 2, total: 2, totalRunners: 4, pnlStats: { staked: 3.97, returns: 5.55, pnl: 1.58, count: 4 } },
          splitB: { fromRow: 3, toRow: 3, total: 1, totalRunners: 2, pnlStats: { staked: 1, returns: 2, pnl: 1, count: 2 } },
        },
      });
    });

    await page.goto("/isp?fromRowA=1&toRowA=2&fromRowB=3&toRowB=3");
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 15000 });

    expect(captured.fromRowA).toBe("1");
    expect(captured.toRowA).toBe("2");
    expect(captured.fromRowB).toBe("3");
    expect(captured.toRowB).toBe("3");
  });

  test("setting maxRunnersInRange=2 zeroes out the aggregate (mocked race has 3 runners in range)", async ({ page }) => {
    const maxInput = page.getByTestId("industry-sp-max-rir-value");
    await maxInput.fill("2");
    await page.getByTestId("industry-sp-filter-apply").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-sp-split-card-a")).toContainText("View 0 Races");
    await expect(page.getByTestId("industry-sp-split-card-b")).toContainText("View 0 Races");
  });

  test("filter bar is visible by default and the toggle hides/shows it", async ({ page }) => {
    await expect(page.getByTestId("industry-sp-filter-bar")).toBeVisible();
    await expect(page.getByTestId("industry-sp-filters-toggle")).toHaveText("Hide filters ▾");

    await page.getByTestId("industry-sp-filters-toggle").click();
    await expect(page.getByTestId("industry-sp-filter-bar")).not.toBeVisible();
    await expect(page.getByTestId("industry-sp-filters-toggle")).toHaveText("Show filters ▸");

    await page.getByTestId("industry-sp-filters-toggle").click();
    await expect(page.getByTestId("industry-sp-filter-bar")).toBeVisible();
  });

  test("course/going/race class/race type chips are present; trainer/jockey search is hidden", async ({ page }) => {
    await expect(page.getByTestId("industry-sp-course-Cheltenham")).toBeVisible();
    await expect(page.getByTestId("industry-sp-going-Good")).toBeVisible();
    await expect(page.getByTestId("industry-sp-race-class-Class 1")).toBeVisible();
    await expect(page.getByTestId("industry-sp-race-type-Chase")).toBeVisible();
    await expect(page.getByTestId("industry-sp-trainer-search")).not.toBeVisible();
    await expect(page.getByTestId("industry-sp-jockey-search")).not.toBeVisible();
  });

  test("clicking a course chip shows a pending state and does NOT query the API or update the URL until Apply", async ({ page }) => {
    const splitsRequests: string[] = [];
    page.on("request", req => {
      if (req.url().includes("/api/industry-sp/splits")) splitsRequests.push(req.url());
    });

    const chip = page.getByTestId("industry-sp-course-Cheltenham");
    await expect(chip).not.toContainText("•");

    await chip.click();
    // Pending: selected in the draft, marked with a trailing "•", but not
    // yet sent to the backend or reflected in the URL.
    await expect(chip).toContainText("Cheltenham •");
    expect(page.url()).not.toContain("courses=Cheltenham");
    expect(splitsRequests.some(u => u.includes("courses=Cheltenham"))).toBe(false);
  });

  test("Apply commits a pending course chip to the URL and the /splits request; chip loses its pending marker", async ({ page }) => {
    const splitsRequests: string[] = [];
    page.on("request", req => {
      if (req.url().includes("/api/industry-sp/splits")) splitsRequests.push(req.url());
    });

    const chip = page.getByTestId("industry-sp-course-Cheltenham");
    await chip.click();
    await expect(chip).toContainText("Cheltenham •");

    await page.getByTestId("industry-sp-filter-apply").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 10000 });

    expect(page.url()).toContain("courses=Cheltenham");
    expect(splitsRequests.some(u => u.includes("courses=Cheltenham"))).toBe(true);
    await expect(chip).not.toContainText("•");
  });

  test("Reset clears course chip selection (draft and applied)", async ({ page }) => {
    const chip = page.getByTestId("industry-sp-course-Cheltenham");
    await chip.click();
    await expect(chip).toContainText("Cheltenham •");
    await page.getByTestId("industry-sp-filter-apply").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 10000 });
    expect(page.url()).toContain("courses=Cheltenham");
    await expect(chip).not.toContainText("•");

    await page.getByTestId("industry-sp-filter-reset").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 10000 });

    expect(page.url()).not.toContain("courses");
    await expect(chip).not.toContainText("•");
  });

  test("country filter bar is not shown — the dataset is UK-only", async ({ page }) => {
    await expect(page.getByTestId("industry-sp-country-bar")).not.toBeVisible();
  });
});

// Standalone, deliberately outside the describe block above and its shared
// beforeEach: that beforeEach's own Apply (against the fixture's tiny
// 3-runner default mock) already counts as "a real load happened", so a
// *second* Apply inside a test body — even the very first thing that test
// does — is no longer the fresh, auto-computed default split (see
// hasLoadedOnce/splitsAreDefaultRef in IndustrySpScreen.tsx's applyFilter).
// These tests need that first, real Apply to go through their OWN
// large-total mock (see resolveSplitPair's comment) so Split A/B's boxes
// actually populate with the 850/851-style numbers the regression needs —
// reusing the shared beforeEach's tiny mock for that first load would
// silently mask the bug these exist to catch.
test("editing only Split A's box carries Split B forward to continue right after it, not its own stale value", async ({ page }) => {
  // Regression: reported live via screenshot — editing only Split A's "to"
  // box (extending it from a prior 850 out to 700) and pressing Apply sent
  // Split B's *stale* prior boundary (still 851, left over from before A
  // moved) instead of continuing right after A's new one. The two ranges
  // silently overlapped — races 701-850 got counted in both splits' P&L —
  // while the result card's label for Split B (built independently, not
  // from what was actually queried) looked like a clean, non-overlapping
  // continuation even though the underlying request wasn't.
  // Echoes back whatever fromRowA/toRowA/fromRowB/toRowB the request
  // actually carried (falling back to a fixed 850/851 default split when
  // none are present, i.e. the very first Apply) — race mode has no
  // server-side snapping/resolution step, so a faithful mock (like the
  // real backend) just reflects the request straight back, letting the
  // displayed boxes (synced from the response in applyResult) actually
  // prove what was carried forward, not just what applyFilter itself
  // computed client-side a moment earlier.
  let lastUrl = "";
  await page.route("**/api/industry-sp/splits*", async (route) => {
    lastUrl = route.request().url();
    const url = new URL(lastUrl);
    const totalRaces = 900;
    const fromRowARaw = url.searchParams.get("fromRowA");
    let fromRowA: number, toRowA: number | null, fromRowB: number, toRowB: number | null;
    if (fromRowARaw == null) {
      fromRowA = 1; toRowA = 850; fromRowB = 851; toRowB = null;
    } else {
      fromRowA = parseInt(fromRowARaw, 10);
      toRowA = url.searchParams.get("toRowA") != null ? parseInt(url.searchParams.get("toRowA")!, 10) : null;
      fromRowB = url.searchParams.get("fromRowB") != null ? parseInt(url.searchParams.get("fromRowB")!, 10) : 1;
      toRowB = url.searchParams.get("toRowB") != null ? parseInt(url.searchParams.get("toRowB")!, 10) : null;
    }
    const pnl = { staked: 10, returns: 9, pnl: -1, count: 5 };
    await route.fulfill({
      json: {
        success: true, totalRaces, totalRunners: totalRaces * 2, raceCap: 1000,
        filterBounds: { maxRunnersPerRace: 29, maxIsp: 1000, minIsp: 1.1 },
        countries: ["GB", "IE"], courses: ["Cheltenham", "Ascot"], goings: ["Good", "Soft"],
        raceClasses: ["Class 1", "Class 2"], raceTypes: ["Chase", "Hurdle"],
        splitA: { fromRow: fromRowA, toRow: toRowA, total: (toRowA ?? totalRaces) - fromRowA + 1, totalRunners: 2, pnlStats: pnl },
        splitB: { fromRow: fromRowB, toRow: toRowB, total: (toRowB ?? totalRaces) - fromRowB + 1, totalRunners: 2, pnlStats: pnl },
      },
    });
  });

  await page.goto("/isp");
  await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
  await page.getByTestId("industry-sp-filter-apply").click();
  await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 10000 });

  // Split B's own box, left untouched, shows its default continuation from
  // that first (genuinely default, auto-computed) apply.
  await expect(page.getByTestId("industry-sp-from-row-b")).toHaveValue("851");

  await page.getByTestId("industry-sp-to-row-a").fill("700");
  await page.getByTestId("industry-sp-filter-apply").click();
  await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 10000 });

  const url = new URL(lastUrl);
  expect(url.searchParams.get("fromRowA")).toBe("1");
  expect(url.searchParams.get("toRowA")).toBe("700");
  expect(url.searchParams.get("fromRowB")).toBe("701");
  expect(url.searchParams.get("toRowB")).toBeNull();
  await expect(page.getByTestId("industry-sp-from-row-b")).toHaveValue("701");
});

test("editing only Split B's box carries Split A forward to end right before it", async ({ page }) => {
  // Symmetric case of the regression above — editing Split B instead of
  // Split A must carry Split A's own end forward the same way. Same
  // echo-the-request mock as above.
  let lastUrl = "";
  await page.route("**/api/industry-sp/splits*", async (route) => {
    lastUrl = route.request().url();
    const url = new URL(lastUrl);
    const totalRaces = 900;
    const fromRowARaw = url.searchParams.get("fromRowA");
    let fromRowA: number, toRowA: number | null, fromRowB: number, toRowB: number | null;
    if (fromRowARaw == null) {
      fromRowA = 1; toRowA = 850; fromRowB = 851; toRowB = null;
    } else {
      fromRowA = parseInt(fromRowARaw, 10);
      toRowA = url.searchParams.get("toRowA") != null ? parseInt(url.searchParams.get("toRowA")!, 10) : null;
      fromRowB = url.searchParams.get("fromRowB") != null ? parseInt(url.searchParams.get("fromRowB")!, 10) : 1;
      toRowB = url.searchParams.get("toRowB") != null ? parseInt(url.searchParams.get("toRowB")!, 10) : null;
    }
    const pnl = { staked: 10, returns: 9, pnl: -1, count: 5 };
    await route.fulfill({
      json: {
        success: true, totalRaces, totalRunners: totalRaces * 2, raceCap: 1000,
        filterBounds: { maxRunnersPerRace: 29, maxIsp: 1000, minIsp: 1.1 },
        countries: ["GB", "IE"], courses: ["Cheltenham", "Ascot"], goings: ["Good", "Soft"],
        raceClasses: ["Class 1", "Class 2"], raceTypes: ["Chase", "Hurdle"],
        splitA: { fromRow: fromRowA, toRow: toRowA, total: (toRowA ?? totalRaces) - fromRowA + 1, totalRunners: 2, pnlStats: pnl },
        splitB: { fromRow: fromRowB, toRow: toRowB, total: (toRowB ?? totalRaces) - fromRowB + 1, totalRunners: 2, pnlStats: pnl },
      },
    });
  });

  await page.goto("/isp");
  await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
  await page.getByTestId("industry-sp-filter-apply").click();
  await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 10000 });

  await page.getByTestId("industry-sp-from-row-b").fill("400");
  await page.getByTestId("industry-sp-filter-apply").click();
  await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 10000 });

  const url = new URL(lastUrl);
  expect(url.searchParams.get("fromRowB")).toBe("400");
  expect(url.searchParams.get("fromRowA")).toBe("1");
  expect(url.searchParams.get("toRowA")).toBe("399");
  await expect(page.getByTestId("industry-sp-to-row-a")).toHaveValue("399");
});

test("editing Split B's from down to 1 (claiming the whole dataset) doesn't collapse Split A to an empty range", async ({ page }) => {
  // Regression: reported live via screenshot. Split A had already been
  // edited to 700 (carrying Split B forward to 701, per the fix above).
  // Editing Split B's "from" back down to 1 made the naive complementary
  // range for Split A come out as fromA=1/toA=0 — an inverted, empty
  // range that would have silently wiped out whatever Split A's own box
  // actually held. resolveSplitPair falls back to resolving Split A
  // independently from its own last-committed box in this case, instead
  // of sending a "0" that means "empty" to a range Split A never asked to
  // give up.
  let lastUrl = "";
  await page.route("**/api/industry-sp/splits*", async (route) => {
    lastUrl = route.request().url();
    await route.fulfill({
      json: {
        success: true, totalRaces: 900, totalRunners: 5963, raceCap: 1000,
        filterBounds: { maxRunnersPerRace: 29, maxIsp: 1000, minIsp: 1.1 },
        countries: ["GB", "IE"], courses: ["Cheltenham", "Ascot"], goings: ["Good", "Soft"],
        raceClasses: ["Class 1", "Class 2"], raceTypes: ["Chase", "Hurdle"],
        splitA: { fromRow: 1, toRow: 850, total: 850, totalRunners: 2983, pnlStats: { staked: 10, returns: 9, pnl: -1, count: 5 } },
        splitB: { fromRow: 851, toRow: null, total: 50, totalRunners: 2980, pnlStats: { staked: 10, returns: 9, pnl: -1, count: 5 } },
      },
    });
  });

  await page.goto("/isp");
  await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
  await page.getByTestId("industry-sp-filter-apply").click();
  await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 10000 });

  await page.getByTestId("industry-sp-to-row-a").fill("700");
  await page.getByTestId("industry-sp-filter-apply").click();
  await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 10000 });

  await page.getByTestId("industry-sp-from-row-b").fill("1");
  await page.getByTestId("industry-sp-filter-apply").click();
  await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 10000 });

  const url = new URL(lastUrl);
  expect(url.searchParams.get("fromRowB")).toBe("1");
  // toRowA must never be "0" — that would silently empty Split A instead
  // of keeping its own last-committed range.
  expect(url.searchParams.get("toRowA")).not.toBe("0");
  await expect(page.getByTestId("industry-sp-to-row-a")).not.toHaveValue("0");
});

test("Split B's result card shows the range that was actually queried, not a fabricated continuation from Split A", async ({ page }) => {
  // Regression: reported live via screenshot. With Split A already edited
  // to 700 and Split B's "from" box explicitly set back down to 1
  // (deliberately overlapping A, per the zero-guard fallback above), the
  // card still showed a fabricated range computed inline at the card's own
  // call site instead of reading the resolved fromRow/toRow the request
  // itself was built from.
  await page.route("**/api/industry-sp/splits*", async (route) => {
    await route.fulfill({
      json: {
        success: true, totalRaces: 900, totalRunners: 8946, raceCap: 1000,
        filterBounds: { maxRunnersPerRace: 29, maxIsp: 1000, minIsp: 1.1 },
        countries: ["GB", "IE"], courses: ["Cheltenham", "Ascot"], goings: ["Good", "Soft"],
        raceClasses: ["Class 1", "Class 2"], raceTypes: ["Chase", "Hurdle"],
        splitA: { fromRow: 1, toRow: 850, total: 850, totalRunners: 2983, pnlStats: { staked: 10, returns: 9, pnl: -1, count: 5 } },
        splitB: { fromRow: 1, toRow: 900, total: 900, totalRunners: 5963, pnlStats: { staked: 10, returns: 9, pnl: -1, count: 5 } },
      },
    });
  });

  await page.goto("/isp");
  await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
  await page.getByTestId("industry-sp-filter-apply").click();
  await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 10000 });

  await page.getByTestId("industry-sp-to-row-a").fill("700");
  await page.getByTestId("industry-sp-filter-apply").click();
  await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 10000 });

  await page.getByTestId("industry-sp-from-row-b").fill("1");
  await page.getByTestId("industry-sp-filter-apply").click();
  await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 10000 });

  await expect(page.getByTestId("industry-sp-split-card-b")).toContainText("races 1–900");
});

test.describe("Industry SP filters screen - session cache across navigation (MSW mocked)", () => {
  // Regression coverage for: navigating away from /isp and back used to
  // re-fetch /api/industry-sp/splits from scratch every time (component
  // unmounts on route change, wiping all state) — reported live as
  // "tapped Filters and it reloaded, which took ages". Filters should only
  // ever be *reapplied* (a genuine network request) when Apply or Reset is
  // pressed; any other reason this screen re-mounts should reuse the
  // sessionStorage-cached result instead.
  test("returning to /isp via ← Filters reuses the cached result — no second /splits request", async ({ page }) => {
    const splitsRequests: string[] = [];
    page.on("request", req => {
      if (req.url().includes("/api/industry-sp/splits")) splitsRequests.push(req.url());
    });

    await gotoIspAndApplyDefaults(page);
    expect(splitsRequests.length).toBe(1);

    await page.getByTestId("industry-sp-view-races-button-a").click();
    await expect(page.getByTestId("industry-sp-races-screen")).toBeVisible({ timeout: 10000 });

    await page.getByTestId("industry-sp-races-back-button").click();
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
    // The split cards must still show real data immediately — proves the
    // cache actually populated state, not just that no request fired.
    await expect(page.getByTestId("industry-sp-split-card-a")).toBeVisible();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible();

    expect(splitsRequests.length).toBe(1);
  });

  test("closing the split detail panel doesn't trigger a new /splits request either", async ({ page }) => {
    const splitsRequests: string[] = [];
    page.on("request", req => {
      if (req.url().includes("/api/industry-sp/splits")) splitsRequests.push(req.url());
    });

    await gotoIspAndApplyDefaults(page);
    expect(splitsRequests.length).toBe(1);

    await page.getByTestId("industry-sp-split-details-button-a").click();
    await expect(page.getByTestId("split-detail-panel-a")).toBeVisible();
    await page.getByTestId("split-detail-panel-filters-a").click();
    await expect(page.getByTestId("split-detail-panel-a")).not.toBeVisible();

    expect(splitsRequests.length).toBe(1);
  });

  test("each split card's Graph button opens its own P&L convergence panel, scoped to its own race range", async ({ page }) => {
    await page.goto("/isp");
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });

    // A large, well-defined mock total (the default fixture's default split
    // totals happen to be 0/1 races here, too degenerate to show two
    // distinct meaningful ranges) so Split A and Split B clearly have their
    // own, different, non-trivial race ranges.
    await page.route("**/api/industry-sp/splits*", async (route) => {
      await route.fulfill({
        json: {
          success: true, totalRaces: 900, totalRunners: 1000, raceCap: 1000,
          filterBounds: { maxRunnersPerRace: 29, maxIsp: 1000, minIsp: 1.1 },
          countries: ["GB", "IE"], courses: ["Cheltenham", "Ascot"], goings: ["Good", "Soft"],
          raceClasses: ["Class 1", "Class 2"], raceTypes: ["Chase", "Hurdle"],
          splitA: { fromRow: 1, toRow: 450, total: 450, totalRunners: 500, pnlStats: { staked: 3.97, returns: 5.55, pnl: 1.58, count: 4 } },
          splitB: { fromRow: 451, toRow: 900, total: 450, totalRunners: 500, pnlStats: { staked: 3.97, returns: 5.55, pnl: 1.58, count: 4 } },
        },
      });
    });
    await page.getByTestId("industry-sp-filter-apply").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 10000 });

    await page.getByTestId("industry-sp-split-graph-button-a").click();
    await expect(page.getByTestId("pnl-convergence-panel")).toBeVisible();
    // The mock resolves fast enough that the loading indicator can come
    // and go before an assertion catches it visible — only its eventual
    // absence is asserted, not the transient visible state.
    await expect(page.getByTestId("pnl-convergence-loading")).not.toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("pnl-convergence-chart")).toBeVisible();
    await expect(page.getByTestId("pnl-convergence-final-roi")).toBeVisible();
    // Split A's own graph is races 1-450 (its own fromRow/toRow).
    await expect(page.getByTestId("pnl-convergence-range-subtitle")).toHaveText("Races 1–450");
    // No filter (course/going/date/...) was ever touched this test — the
    // panel must say so explicitly rather than leaving the user to guess.
    await expect(page.getByTestId("pnl-convergence-no-filters")).toBeVisible();

    await page.getByTestId("pnl-convergence-panel-close").click();
    await expect(page.getByTestId("pnl-convergence-panel")).not.toBeVisible();

    // Split B's own Graph button opens a panel scoped to its own range —
    // 451-900, continuing directly after Split A's own 1-450, not
    // restarting at 1 and not showing the combined 1-900 range on both
    // buttons.
    await page.getByTestId("industry-sp-split-graph-button-b").click();
    await expect(page.getByTestId("pnl-convergence-panel")).toBeVisible();
    await expect(page.getByTestId("pnl-convergence-chart")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("pnl-convergence-range-subtitle")).toHaveText("Races 451–900");
  });

  test("the P&L convergence panel shows exactly which filters produced its result", async ({ page }) => {
    // Requested live via screenshot: the convergence graph gave no
    // indication of which filters (course, date range, ...) narrowed the
    // result being viewed — only implicit in the Filters screen's own
    // state. The panel must surface a summary of exactly what was applied.
    await page.goto("/isp");
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });

    await page.route("**/api/industry-sp/splits*", async (route) => {
      await route.fulfill({
        json: {
          success: true, totalRaces: 900, totalRunners: 1000, raceCap: 1000,
          filterBounds: { maxRunnersPerRace: 29, maxIsp: 1000, minIsp: 1.1 },
          countries: ["GB", "IE"], courses: ["Cheltenham", "Ascot"], goings: ["Good", "Soft"],
          raceClasses: ["Class 1", "Class 2"], raceTypes: ["Chase", "Hurdle"],
          splitA: { fromRow: 1, toRow: 450, total: 450, totalRunners: 500, pnlStats: { staked: 3.97, returns: 5.55, pnl: 1.58, count: 4 } },
          splitB: { fromRow: 451, toRow: 900, total: 450, totalRunners: 500, pnlStats: { staked: 3.97, returns: 5.55, pnl: 1.58, count: 4 } },
        },
      });
    });

    // Course chip options only populate from a /splits response's own
    // `courses` field — before any Apply, the row shows "Apply to load
    // options" with no clickable chip yet (see the "bare load" describe
    // block above). Apply once with nothing selected first so the chip
    // exists, then select it and Apply again to actually commit the filter.
    await page.getByTestId("industry-sp-filter-apply").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 10000 });

    await page.getByTestId("industry-sp-course-Cheltenham").click();
    await page.getByTestId("industry-sp-filter-apply").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 10000 });

    await page.getByTestId("industry-sp-split-graph-button-a").click();
    await expect(page.getByTestId("pnl-convergence-panel")).toBeVisible();

    await expect(page.getByTestId("pnl-convergence-no-filters")).not.toBeVisible();
    await expect(page.getByTestId("pnl-convergence-filters-summary")).toBeVisible();
    await expect(page.getByTestId("pnl-convergence-filter-chip-courses")).toHaveText("Courses: Cheltenham");
  });

  test("Split B's Graph button uses the range that was actually applied, not a fabricated continuation from Split A", async ({ page }) => {
    // Regression: reported live via screenshot. Split A was edited to
    // 1-1000 and Split B explicitly edited to 1-3000 (deliberately
    // overlapping A) — the box and result card both correctly showed
    // "races 1–3000" (per the split-b-label fix), but the Graph button
    // still opened a different, fabricated range: loadConvergence had its
    // own, separate copy of a "derive B's range from A's totals" formula,
    // never updated when the card's own copy was fixed. Same for the
    // Details panel (SplitDetailPanel) a few lines below in
    // IndustrySpScreen.tsx — a third and fourth independent copy of the
    // exact same formula.
    await page.goto("/isp");
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });

    await page.route("**/api/industry-sp/splits*", async (route) => {
      await route.fulfill({
        json: {
          success: true, totalRaces: 900, totalRunners: 3173, raceCap: 1000,
          filterBounds: { maxRunnersPerRace: 29, maxIsp: 1000, minIsp: 1.1 },
          countries: ["GB", "IE"], courses: ["Cheltenham", "Ascot"], goings: ["Good", "Soft"],
          raceClasses: ["Class 1", "Class 2"], raceTypes: ["Chase", "Hurdle"],
          splitA: { fromRow: 1, toRow: 300, total: 211, totalRunners: 1000, pnlStats: { staked: 10, returns: 9, pnl: -1, count: 5 } },
          splitB: { fromRow: 1, toRow: 3000, total: 637, totalRunners: 3000, pnlStats: { staked: 10, returns: 9, pnl: -1, count: 5 } },
        },
      });
    });
    let convergenceUrl = "";
    await page.route("**/api/industry-sp/race-convergence*", async (route) => {
      convergenceUrl = route.request().url();
      await route.fulfill({
        json: { success: true, data: [{ raceRowNumber: 1, cumulativeStaked: 1, cumulativeReturns: 0.5, cumulativePnl: -0.5, roiPercent: -50 }] },
      });
    });

    await page.getByTestId("industry-sp-filter-apply").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 10000 });

    await page.getByTestId("industry-sp-to-row-a").fill("1000");
    await page.getByTestId("industry-sp-filter-apply").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 10000 });

    await page.getByTestId("industry-sp-from-row-b").fill("1");
    await page.getByTestId("industry-sp-to-row-b").fill("3000");
    await page.getByTestId("industry-sp-filter-apply").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 10000 });

    await expect(page.getByTestId("industry-sp-split-card-b")).toContainText("races 1–3000");

    await page.getByTestId("industry-sp-split-graph-button-b").click();
    await expect(page.getByTestId("pnl-convergence-panel")).toBeVisible();

    const url = new URL(convergenceUrl);
    expect(url.searchParams.get("fromRow")).toBe("1");
    expect(url.searchParams.get("toRow")).toBe("3000");
  });

  test("tapping the P&L convergence chart snaps a marker and tooltip to the nearest race", async ({ page }) => {
    // Requested live: "tap somewhere on the graph and a snap appears...
    // for current profit loss and race count on spot on the line."
    await page.goto("/isp");
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });

    await page.route("**/api/industry-sp/splits*", async (route) => {
      await route.fulfill({
        json: {
          success: true, totalRaces: 900, totalRunners: 1000, raceCap: 1000,
          filterBounds: { maxRunnersPerRace: 29, maxIsp: 1000, minIsp: 1.1 },
          countries: ["GB", "IE"], courses: ["Cheltenham", "Ascot"], goings: ["Good", "Soft"],
          raceClasses: ["Class 1", "Class 2"], raceTypes: ["Chase", "Hurdle"],
          splitA: { fromRow: 1, toRow: 450, total: 450, totalRunners: 500, pnlStats: { staked: 3.97, returns: 5.55, pnl: 1.58, count: 4 } },
          splitB: { fromRow: 451, toRow: 900, total: 450, totalRunners: 500, pnlStats: { staked: 3.97, returns: 5.55, pnl: 1.58, count: 4 } },
        },
      });
    });
    await page.getByTestId("industry-sp-filter-apply").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 10000 });

    await page.getByTestId("industry-sp-split-graph-button-a").click();
    await expect(page.getByTestId("pnl-convergence-panel")).toBeVisible();
    const chart = page.getByTestId("pnl-convergence-chart");
    await expect(chart).toBeVisible({ timeout: 10000 });

    await expect(page.getByTestId("pnl-convergence-tooltip")).not.toBeVisible();

    // Tap near the left edge — should snap to a low race row number (Split
    // A covers races 1-450).
    await chart.click({ position: { x: 5, y: 100 } });
    await expect(page.getByTestId("pnl-convergence-tooltip")).toBeVisible();
    await expect(page.getByTestId("pnl-convergence-snap-dot")).toBeVisible();
    // Not .toBeVisible() — a near-vertical SVG <line> has a zero-width
    // bounding box, which Playwright's visibility heuristic (width>0 &&
    // height>0) reports as "hidden" even though it renders correctly.
    await expect(page.getByTestId("pnl-convergence-snap-guide")).toHaveCount(1);
    const leftTooltipText = await page.getByTestId("pnl-convergence-tooltip").textContent();
    const leftMatch = leftTooltipText?.match(/Race (\d+)/);
    expect(leftMatch).toBeTruthy();
    const leftRowNumber = Number(leftMatch![1]);
    expect(leftRowNumber).toBeGreaterThanOrEqual(1);
    expect(leftRowNumber).toBeLessThan(100);
    await expect(page.getByTestId("pnl-convergence-tooltip-pnl")).toContainText("£");

    // Tap near the right edge — should snap to a much higher race row
    // number, proving the marker actually tracks the tap position rather
    // than always landing on the same point.
    const box = await chart.boundingBox();
    await chart.click({ position: { x: (box?.width ?? 300) - 5, y: 100 } });
    const rightTooltipText = await page.getByTestId("pnl-convergence-tooltip").textContent();
    const rightMatch = rightTooltipText?.match(/Race (\d+)/);
    expect(rightMatch).toBeTruthy();
    const rightRowNumber = Number(rightMatch![1]);
    expect(rightRowNumber).toBeGreaterThan(leftRowNumber);
    expect(rightRowNumber).toBeGreaterThan(400);
  });

  test("pressing Apply always fetches fresh, even with unchanged filters", async ({ page }) => {
    const splitsRequests: string[] = [];
    page.on("request", req => {
      if (req.url().includes("/api/industry-sp/splits")) splitsRequests.push(req.url());
    });

    await gotoIspAndApplyDefaults(page);
    expect(splitsRequests.length).toBe(1);

    await page.getByTestId("industry-sp-filter-apply").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 10000 });
    expect(splitsRequests.length).toBe(2);
  });

  test("changing filters and returning later reuses each combination's own cached result", async ({ page }) => {
    const splitsRequests: string[] = [];
    page.on("request", req => {
      if (req.url().includes("/api/industry-sp/splits")) splitsRequests.push(req.url());
    });

    await gotoIspAndApplyDefaults(page);
    expect(splitsRequests.length).toBe(1);

    // Apply a real filter change — a genuine new request, new cache entry.
    await page.getByTestId("industry-sp-max-rir-value").fill("2");
    await page.getByTestId("industry-sp-filter-apply").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 10000 });
    expect(splitsRequests.length).toBe(2);

    // Leave and come back — reuses the filtered result's cache entry.
    await page.getByTestId("industry-sp-view-races-button-a").click();
    await expect(page.getByTestId("industry-sp-races-screen")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("industry-sp-races-back-button").click();
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible();
    expect(splitsRequests.length).toBe(2);
  });
});

test.describe("Industry SP filters screen - filter URL persistence + Reset (MSW mocked)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/isp");
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 15000 });
  });

  test("applying a filter writes it to the URL query string", async ({ page }) => {
    await page.getByTestId("industry-sp-max-rir-value").fill("2");
    await page.getByTestId("industry-sp-filter-apply").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 10000 });
    expect(page.url()).toContain("maxInIspRange=2");
  });

  test("loading /isp with filter params in the URL pre-fills those filters", async ({ page }) => {
    await page.goto("/isp?maxInIspRange=2");
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("industry-sp-max-rir-value")).toHaveValue("2");
  });

  test("Reset button restores default filter values and clears the URL", async ({ page }) => {
    await page.getByTestId("industry-sp-max-rir-value").fill("2");
    await page.getByTestId("industry-sp-filter-apply").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 10000 });
    expect(page.url()).toContain("maxInIspRange=2");

    await page.getByTestId("industry-sp-filter-reset").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 10000 });

    await expect(page.getByTestId("industry-sp-max-rir-value")).toHaveValue("30");
    expect(page.url()).not.toContain("maxInIspRange");
  });

  test("View Races carries the applied filter query string over to /isp/races", async ({ page }) => {
    await page.getByTestId("industry-sp-max-rir-value").fill("2");
    await page.getByTestId("industry-sp-filter-apply").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 10000 });

    await page.getByTestId("industry-sp-view-races-button-a").click();
    await expect(page.getByTestId("industry-sp-races-screen")).toBeVisible({ timeout: 10000 });
    // Regression: the router's queryParams state goes stale after
    // history.replaceState calls, which could silently drop just-applied
    // filters when navigating to the races screen.
    expect(page.url()).toContain("maxInIspRange=2");
  });

  test("date filter defaults to 2024-01-01 – 2024-01-31 and stays out of the URL at that default", async ({ page }) => {
    await expect(page.getByTestId("industry-sp-date-range-picker")).toContainText("Jan 1, 2024");
    await expect(page.getByTestId("industry-sp-date-range-picker")).toContainText("Jan 31, 2024");
    expect(page.url()).not.toContain("minDate");
    expect(page.url()).not.toContain("maxDate");
  });

  test("applying a custom date range (within one month) writes minDate/maxDate to the URL and the /splits request", async ({ page }) => {
    const splitsRequests: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/api/industry-sp/splits")) splitsRequests.push(req.url());
    });

    await pickDateRange(page, "2023-01-01", "2023-01-20");
    await page.getByTestId("industry-sp-filter-apply").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 10000 });

    expect(page.url()).toContain("minDate=2023-01-01");
    expect(page.url()).toContain("maxDate=2023-01-20");
    const lastRequest = splitsRequests[splitsRequests.length - 1];
    expect(lastRequest).toContain("minDate=2023-01-01");
    expect(lastRequest).toContain("maxDate=2023-01-20");
  });

  test("a date range wider than one year is clamped to minDate + 1 year on Apply", async ({ page }) => {
    // Mirrors IndustrySpScreen.tsx's applyFilter(): a maxDate more than one
    // year past minDate is pulled back to minDate + 1 year (addOneYear)
    // rather than rejected — same self-correcting pattern as every other
    // range filter on this screen. (This test previously asserted a
    // 1-month cap, which no longer matches the component's 1-year cap.)
    await pickDateRange(page, "2023-01-01", "2025-06-30");
    await page.getByTestId("industry-sp-filter-apply").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 10000 });

    expect(page.url()).toContain("minDate=2023-01-01");
    expect(page.url()).toContain("maxDate=2024-01-01");
    expect(page.url()).not.toContain("maxDate=2025-06-30");
    await expect(page.getByTestId("industry-sp-date-range-picker")).toContainText("Jan 1, 2024");
  });

  test("Reset restores the date range to the 2024-01 default and clears it from the URL", async ({ page }) => {
    await pickDateRange(page, "2023-01-01", "2023-01-20");
    await page.getByTestId("industry-sp-filter-apply").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 10000 });
    expect(page.url()).toContain("minDate=2023-01-01");

    await page.getByTestId("industry-sp-filter-reset").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 10000 });

    await expect(page.getByTestId("industry-sp-date-range-picker")).toContainText("Jan 1, 2024");
    await expect(page.getByTestId("industry-sp-date-range-picker")).toContainText("Jan 31, 2024");
    expect(page.url()).not.toContain("minDate");
    expect(page.url()).not.toContain("maxDate");
  });

  test("a stale explicit split beyond the current total self-heals back to the default split", async ({ page }) => {
    // Reproduces a bookmarked/old URL carrying fromRowA/fromRowB row numbers
    // computed against a much larger total (e.g. from before the date
    // filter existed) landing on today's smaller default — Split B should
    // never render as a broken, permanently-empty "races 54622-9800/9800"
    // split; it should self-correct back to an even default split.
    //
    // Overrides the fixture's normal 1-race mock with a fixed totalRaces
    // of 2500 — large enough that the corrected half/half default (see
    // getSplitStats) has real, non-empty content in both splits, which
    // the standard 1-race mock can never demonstrate.
    await page.route("**/api/industry-sp/splits*", async (route) => {
      const url = new URL(route.request().url());
      const totalRaces = 2500;
      const fromRowARaw = url.searchParams.get("fromRowA");
      let fromRowA: number, toRowA: number, fromRowB: number, toRowB: number;
      if (fromRowARaw == null) {
        const half = Math.floor(totalRaces / 2);
        fromRowA = 1; toRowA = half; fromRowB = half + 1; toRowB = totalRaces;
      } else {
        fromRowA = parseInt(fromRowARaw, 10);
        toRowA = parseInt(url.searchParams.get("toRowA") ?? String(totalRaces), 10);
        fromRowB = parseInt(url.searchParams.get("fromRowB") ?? "1", 10);
        toRowB = totalRaces;
      }
      const totalA = Math.max(0, Math.min(toRowA, totalRaces) - fromRowA + 1);
      const totalB = Math.max(0, Math.min(toRowB, totalRaces) - fromRowB + 1);
      const pnl = { staked: 3.97, returns: 5.55, pnl: 1.58, count: 4 };
      await route.fulfill({
        json: {
          success: true,
          totalRaces,
          totalRunners: totalRaces * 2,
          filterBounds: { maxRunnersPerRace: 29, maxIsp: 1000, minIsp: 1.1 },
          countries: ["GB", "IE"],
          courses: ["Cheltenham", "Ascot"],
          goings: ["Good", "Soft"],
          raceClasses: ["Class 1", "Class 2"],
          raceTypes: ["Chase", "Hurdle"],
          splitA: { fromRow: fromRowA, toRow: toRowA, total: totalA, totalRunners: totalA * 2, pnlStats: totalA > 0 ? pnl : { staked: 0, returns: 0, pnl: 0, count: 0 } },
          splitB: { fromRow: fromRowB, toRow: toRowB, total: totalB, totalRunners: totalB * 2, pnlStats: totalB > 0 ? pnl : { staked: 0, returns: 0, pnl: 0, count: 0 } },
        },
      });
    });

    await page.goto("/isp?fromRowA=1&toRowA=54621&fromRowB=54622");
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 15000 });

    // The self-heal fires a second fetch, so isLoading briefly cycles
    // false→true→false again — poll on the split card's own text settling
    // rather than the loading indicator's timing, which could otherwise
    // catch the transient gap between the two fetches.
    await expect(page.getByTestId("industry-sp-split-card-a")).not.toContainText("54621", { timeout: 10000 });
    await expect(page.getByTestId("industry-sp-split-empty-b")).not.toBeVisible();
  });

  test("split cards always show a 'races X–Y' label", async ({ page }) => {
    // Custom route with a real multi-race total (unlike the default 1-race
    // fixture, where Split A is always empty) so both splits have
    // non-trivial, distinct race ranges to display.
    await page.route("**/api/industry-sp/splits*", async (route) => {
      const totalRaces = 2500;
      const totalRunners = 5000;
      const pnl = { staked: 3.97, returns: 5.55, pnl: 1.58, count: 4 };
      await route.fulfill({
        json: {
          success: true,
          totalRaces,
          totalRunners,
          filterBounds: { maxRunnersPerRace: 29, maxIsp: 1000, minIsp: 1.1 },
          countries: ["GB", "IE"],
          courses: ["Cheltenham", "Ascot"],
          goings: ["Good", "Soft"],
          raceClasses: ["Class 1", "Class 2"],
          raceTypes: ["Chase", "Hurdle"],
          splitA: { fromRow: 1, toRow: 1250, total: 1250, totalRunners: 2500, pnlStats: pnl },
          splitB: { fromRow: 1251, toRow: null, total: 1250, totalRunners: 2500, pnlStats: pnl },
        },
      });
    });

    await page.getByTestId("industry-sp-filter-apply").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 10000 });

    await expect(page.getByTestId("industry-sp-split-card-a")).toContainText("races 1–1250");
    await expect(page.getByTestId("industry-sp-split-card-b")).toContainText("races 1251–2500");
  });

  test("manual Split A/Split B race-range editing boxes are always visible", async ({ page }) => {
    await expect(page.getByTestId("industry-sp-from-row-a")).toBeVisible();
    await expect(page.getByTestId("industry-sp-from-row-b")).toBeVisible();
  });
});

test.describe("Industry SP races screen (MSW mocked)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/isp/races");
    await expect(page.getByTestId("industry-sp-races-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 15000 });
  });

  test("default state shows the mocked race (3 runners in range, default maxRIR=30)", async ({ page }) => {
    await expect(page.getByTestId("industry-sp-race-914592")).toBeVisible({ timeout: 5000 });
  });

  // Regression test: formatRaceTime (ispFormat.ts) relied on "en-GB" defaulting
  // to a 24-hour clock, but some browsers instead render a 12-hour time with
  // no AM/PM suffix — e.g. the fixture's 14:01 race silently showing as
  // "02:01", indistinguishable from an actual 2am race. hour12: false now
  // forces the 24-hour format explicitly rather than relying on locale
  // defaults.
  test("race time renders in 24-hour format, not an ambiguous 12-hour one", async ({ page }) => {
    await expect(page.getByTestId("industry-sp-race-914592")).toContainText("14:01");
  });

  test("shows the trainer-form badge for a runner with a sample, and omits it for one without", async ({ page }) => {
    // Fixture: runner 12347 (Fact To File) has trainerFormRuns=14/Wins=3/WinRate=21.43;
    // runner 12345 (Springwell Bay) has a trainer but no trainerFormRuns field at
    // all; runner 12346 (Gaelic Warrior) has trainerFormRuns=0. Only the first
    // should show the win/run/rate fragment.
    await expect(page.getByTestId("industry-sp-item-trainer-12347")).toContainText("W P Mullins");
    await expect(page.getByTestId("industry-sp-item-trainer-form-12347")).toContainText("3/14");
    await expect(page.getByTestId("industry-sp-item-trainer-form-12347")).toContainText("21%");

    await expect(page.getByTestId("industry-sp-item-trainer-12345")).toContainText("W P Mullins");
    await expect(page.getByTestId("industry-sp-item-trainer-form-12345")).not.toBeVisible();

    await expect(page.getByTestId("industry-sp-item-trainer-12346")).toContainText("G Elliott");
    await expect(page.getByTestId("industry-sp-item-trainer-form-12346")).not.toBeVisible();
  });

  test("shows the model win-probability badge on every runner (no cold-start gap, unlike trainer form)", async ({ page }) => {
    await expect(page.getByTestId("industry-sp-item-model-12345")).toContainText("13%");
    await expect(page.getByTestId("industry-sp-item-model-12346")).toContainText("8%");
    await expect(page.getByTestId("industry-sp-item-model-12347")).toContainText("39%");
  });

  test("shows the SP-implied win% next to the model badge for easy comparison", async ({ page }) => {
    // isp 4.5 -> implied 100/4.5 = 22.2%; isp 9.2 -> 10.9%; isp 2.1 -> 47.6%.
    await expect(page.getByTestId("industry-sp-item-implied-sp-12345")).toContainText("SP 22%");
    await expect(page.getByTestId("industry-sp-item-implied-sp-12346")).toContainText("SP 11%");
    await expect(page.getByTestId("industry-sp-item-implied-sp-12347")).toContainText("SP 48%");
  });

  test("filters applied via the URL query string are respected", async ({ page }) => {
    await page.goto("/isp/races?maxInIspRange=2");
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("industry-sp-list")).toContainText("No races found.");
  });

  test("hasTrainerForm=true in the URL excludes a race whose runners have no trainer-form sample", async ({ page }) => {
    // Regression test: IndustrySpScreen's "Has trainer form" checkbox only
    // ever affected the Split A/B aggregate totals — it was never actually
    // threaded through to this screen's own fetch, so tapping "View Races"
    // and clicking into an individual race could land on a runner with no
    // trainer form at all, despite the filter being checked. Fixture race
    // 773337 (Southwell Bombardier Handicap) has exactly one runner with
    // trainerFormRuns=0 — it must disappear once this filter is on, leaving
    // only 914592 (which has a runner with real form).
    await page.goto("/isp/races?hasTrainerForm=true");
    await expect(page.getByTestId("industry-sp-races-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("industry-sp-race-914592")).toBeVisible();
    await expect(page.getByTestId("industry-sp-race-773337")).not.toBeVisible();
  });

  test("hasTrainerForm=true hides individual runners within a matching race who don't themselves have a sample", async ({ page }) => {
    // Regression test: the race-level filter only guarantees *a* runner in
    // the race qualifies, not that every runner shown does — reported live:
    // user checked the filter, tapped through fresh, and landed on a
    // runner (the first one shown) with no trainer form, even though the
    // race itself had qualifying runners further down the list. Fixture
    // race 914592 has 3 runners: 12347 (Fact To File) qualifies, 12345 and
    // 12346 don't — only 12347 should render once the filter is active.
    await page.goto("/isp/races?hasTrainerForm=true");
    await expect(page.getByTestId("industry-sp-races-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("industry-sp-item-12347")).toBeVisible();
    await expect(page.getByTestId("industry-sp-item-12345")).not.toBeVisible();
    await expect(page.getByTestId("industry-sp-item-12346")).not.toBeVisible();
    // The race header's own runner count should reflect what's actually
    // shown (1), not the full field (3).
    await expect(page.getByTestId("industry-sp-race-914592")).toContainText("1 runners");
  });

  test("minModelWinProbability hides individual runners below the threshold, and excludes races with none above it", async ({ page }) => {
    // Fixture race 914592 has modelWinProbability 12.5/8.3/39.2 for runners
    // 12345/12346/12347 — a 20% threshold should show only 12347. Fixture
    // race 773337 (Teston, modelWinProbability=100) should still be
    // included since its one runner clears the bar.
    await page.goto("/isp/races?minModelWinProbability=20");
    await expect(page.getByTestId("industry-sp-races-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("industry-sp-item-12347")).toBeVisible();
    await expect(page.getByTestId("industry-sp-item-12345")).not.toBeVisible();
    await expect(page.getByTestId("industry-sp-item-12346")).not.toBeVisible();
    await expect(page.getByTestId("industry-sp-race-914592")).toContainText("1 runners");
    await expect(page.getByTestId("industry-sp-race-773337")).toBeVisible();
    await expect(page.getByTestId("industry-sp-item-99001")).toBeVisible();
  });

  test("shows a Value badge only for runners whose model win% beats their SP-implied win%", async ({ page }) => {
    // Fixture race 556677 (Kempton) has runner 55501 (isp 10 -> implied 10%,
    // model 25% -> beats SP) and runner 55502 (isp 1.5 -> implied 66.7%,
    // model 20% -> doesn't). Fixture race 914592's three runners (12345/
    // 12346/12347) all fall short of their own implied SP%, so none show
    // the badge.
    await expect(page.getByTestId("industry-sp-item-value-55501")).toBeVisible();
    await expect(page.getByTestId("industry-sp-item-value-55502")).not.toBeVisible();
    await expect(page.getByTestId("industry-sp-item-value-12345")).not.toBeVisible();
    await expect(page.getByTestId("industry-sp-item-value-12346")).not.toBeVisible();
    await expect(page.getByTestId("industry-sp-item-value-12347")).not.toBeVisible();
  });

  test("onlyModelBeatsSp=true hides individual runners who don't beat their own SP, and excludes races with none that do", async ({ page }) => {
    // Race 914592's three runners all fall short of their own implied SP%,
    // so the whole race should disappear. Race 556677 (Kempton) has one
    // runner (55501) that beats SP and one (55502) that doesn't — only
    // 55501 should render.
    await page.goto("/isp/races?onlyModelBeatsSp=true");
    await expect(page.getByTestId("industry-sp-races-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("industry-sp-race-914592")).not.toBeVisible();
    await expect(page.getByTestId("industry-sp-race-556677")).toBeVisible();
    await expect(page.getByTestId("industry-sp-item-55501")).toBeVisible();
    await expect(page.getByTestId("industry-sp-item-55502")).not.toBeVisible();
    await expect(page.getByTestId("industry-sp-race-556677")).toContainText("1 runners");
    // The single-runner Teston race (99001, modelWinProbability=100,
    // isp=11 -> implied 9.1%) also beats its own SP, so it stays visible.
    await expect(page.getByTestId("industry-sp-race-773337")).toBeVisible();
  });

  test("runner name stays legible even when every other badge is present on the same row", async ({ page }) => {
    // Regression: reported live — a runner with ISP/Bet/PnL, trainer +
    // trainer-form, Model, Value and status badges all present at once
    // squeezed the runner name down to an illegible sliver. runnerName used
    // flex:1 in a flexWrap row — a flex-grow item gets shrunk toward its
    // minWidth (0) to stay on the current line instead of wrapping itself,
    // once enough sibling badges are present. Fixture runner 55501 carries
    // every optional badge at once (see fixtures.ts) to reproduce it. Only
    // manifests on a narrow (mobile) viewport — a wide desktop row has room
    // for every badge without ever needing to shrink the name.
    await page.setViewportSize({ width: 375, height: 812 });
    const name = page.getByTestId("industry-sp-item-name-55501");
    await expect(name).toBeVisible();
    await expect(name).toHaveText("Value Bet Horse With A Longer Name");
    const box = await name.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(40);
  });

  test("meeting-level PnL bar totals the meeting's races (Cheltenham: Springwell Bay -£0.29, Gaelic Warrior -£0.12, Fact To File +£1.00 = +£0.59)", async ({ page }) => {
    const bar = page.getByTestId("industry-sp-meeting-pnl-bar-Cheltenham|2025-01-01");
    await expect(bar).toBeVisible();
    await expect(page.getByTestId("industry-sp-meeting-pnl-count-Cheltenham|2025-01-01")).toContainText("Horses 3");
    await expect(bar).toContainText("Staked £1.32");
    await expect(bar).toContainText("Return £1.91");
    await expect(page.getByTestId("industry-sp-meeting-pnl-Cheltenham|2025-01-01")).toContainText("+£0.59");
  });

  test("← Filters button returns to /isp", async ({ page }) => {
    await page.getByTestId("industry-sp-races-back-button").click();
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Industry SP races screen - sort order toggle (MSW mocked)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/isp/races");
    await expect(page.getByTestId("industry-sp-races-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 15000 });
  });

  test("sort toggle button is present with default 'First → Last' label", async ({ page }) => {
    await expect(page.getByTestId("industry-sp-sort-toggle")).toBeVisible();
    await expect(page.getByTestId("industry-sp-sort-toggle")).toHaveText("First → Last");
  });

  test("clicking sort toggle changes label to 'Last → First'", async ({ page }) => {
    await page.getByTestId("industry-sp-sort-toggle").click();
    await expect(page.getByTestId("industry-sp-sort-toggle")).toHaveText("Last → First");
  });

  test("clicking sort toggle twice returns to 'First → Last'", async ({ page }) => {
    await page.getByTestId("industry-sp-sort-toggle").click();
    await page.getByTestId("industry-sp-sort-toggle").click();
    await expect(page.getByTestId("industry-sp-sort-toggle")).toHaveText("First → Last");
  });

  test("sort toggle sends sort=desc query param to /api/industry-sp", async ({ page }) => {
    let capturedSort: string | null = null;
    await page.route("**/api/industry-sp*", async (route) => {
      const url = new URL(route.request().url());
      capturedSort = url.searchParams.get("sort");
      // .fallback() (not .continue()) defers to the fixture's own
      // /api/industry-sp handler — .continue() sends the request straight
      // to the real network (localhost:3000) instead, which the MSW suite
      // has no business depending on being up.
      await route.fallback();
    });

    await page.getByTestId("industry-sp-sort-toggle").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 10000 });
    expect(capturedSort).toBe("desc");
  });

  test("loading /isp/races with sort=desc in the URL starts sorted descending", async ({ page }) => {
    await page.goto("/isp/races?sort=desc");
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("industry-sp-sort-toggle")).toHaveText("Last → First");
  });
});

// Standalone, deliberately outside the describe block above: that block's
// beforeEach already navigates to /isp/races once for every test in it, so
// observing the *initial* request would need a second page.goto to the
// exact same URL — but Chromium/Playwright doesn't reliably fire a fresh
// navigation (and therefore a fresh fetch) for a goto() whose target URL is
// byte-identical to the page's current URL. Registering the route once and
// navigating exactly once, before anything else has loaded the page, avoids
// relying on that same-URL reload behavior entirely.
//
// Uses page.waitForRequest (a passive observer) instead of page.route: a
// page.route handler registered here — even one that calls
// route.fallback() to defer to the fixture's own /api/industry-sp mock —
// intermittently swallowed this specific request without ever reaching
// that fallback handler or firing Playwright's own "request" event,
// leaving the app to hang past its loading state. waitForRequest doesn't
// intercept anything, so it can't race the fixture's routing at all.
test("sort=asc is sent on initial load", async ({ page }) => {
  const [request] = await Promise.all([
    page.waitForRequest(req => req.url().includes("/api/industry-sp?")),
    page.goto("/isp/races"),
  ]);
  await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 15000 });

  const url = new URL(request.url());
  expect(url.searchParams.get("sort")).toBe("asc");
});

test.describe("Industry SP meeting/race drill-down (MSW mocked)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/isp/races");
    await expect(page.getByTestId("industry-sp-races-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 15000 });
  });

  test("tapping the meeting header opens a full-screen meeting view", async ({ page }) => {
    await page.getByTestId("industry-sp-meeting-link-Cheltenham|2025-01-01").click();

    await expect(page.getByTestId("industry-meeting-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-sp-races-screen")).not.toBeVisible();
    await expect(page.getByTestId("industry-meeting-loading")).not.toBeVisible({ timeout: 10000 });
    expect(page.url()).toContain("/isp/meeting?id=");

    // Both mocked races for this meeting are shown.
    await expect(page.getByTestId("industry-meeting-race-914592")).toBeVisible();
    await expect(page.getByTestId("industry-meeting-race-914593")).toBeVisible();
  });

  test("meeting screen back button returns to /isp/races", async ({ page }) => {
    await page.getByTestId("industry-sp-meeting-link-Cheltenham|2025-01-01").click();
    await expect(page.getByTestId("industry-meeting-screen")).toBeVisible({ timeout: 10000 });

    await page.getByTestId("industry-meeting-back-button").click();

    await expect(page.getByTestId("industry-sp-races-screen")).toBeVisible({ timeout: 10000 });
    expect(page.url()).toMatch(/\/isp\/races(\?|$)/);
  });

  test("tapping a race from the races list opens a full-screen race view", async ({ page }) => {
    await page.getByTestId("industry-sp-race-914592").click();

    await expect(page.getByTestId("industry-race-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-race-loading")).not.toBeVisible({ timeout: 10000 });
    expect(page.url()).toContain("/isp/race?id=914592");

    await expect(page.getByTestId("industry-race-item-12345")).toBeVisible();
    await expect(page.getByTestId("industry-race-item-12346")).toBeVisible();
    await expect(page.getByTestId("industry-race-item-12347")).toBeVisible();
  });

  test("race screen back button returns to the race's meeting", async ({ page }) => {
    await page.getByTestId("industry-sp-race-914592").click();
    await expect(page.getByTestId("industry-race-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-race-loading")).not.toBeVisible({ timeout: 10000 });

    await page.getByTestId("industry-race-back-button").click();

    await expect(page.getByTestId("industry-meeting-screen")).toBeVisible({ timeout: 10000 });
    expect(page.url()).toContain("/isp/meeting?id=");
  });

  test("404 race shows an error state", async ({ page }) => {
    await page.goto("/isp/race?id=999999");
    await expect(page.getByTestId("industry-race-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-race-loading")).not.toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-race-error")).toBeVisible();
  });
});

test.describe("Odds display mode (MSW mocked, on the races screen)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/isp/races");
    await expect(page.getByTestId("industry-sp-races-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 15000 });
  });

  test("ISP defaults to fraction display", async ({ page }) => {
    await expect(page.getByTestId("industry-sp-odds-mode-toggle")).toHaveText("Odds: Fraction");
    await expect(page.getByTestId("industry-sp-isp-12345")).toHaveText("ISP 7/2");
  });

  test("toggling switches to decimal, rounded to 2dp", async ({ page }) => {
    await page.getByTestId("industry-sp-odds-mode-toggle").click();
    await expect(page.getByTestId("industry-sp-odds-mode-toggle")).toHaveText("Odds: Decimal");
    await expect(page.getByTestId("industry-sp-isp-12345")).toHaveText("ISP 4.50");
  });

  test("meeting screen has its own fraction/decimal toggle", async ({ page }) => {
    await page.getByTestId("industry-sp-meeting-link-Cheltenham|2025-01-01").click();
    await expect(page.getByTestId("industry-meeting-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-meeting-loading")).not.toBeVisible({ timeout: 10000 });

    await expect(page.getByTestId("industry-meeting-isp-12345")).toHaveText("ISP 7/2");
    await page.getByTestId("industry-meeting-odds-mode-toggle").click();
    await expect(page.getByTestId("industry-meeting-isp-12345")).toHaveText("ISP 4.50");
  });

  test("race screen has its own fraction/decimal toggle", async ({ page }) => {
    await page.getByTestId("industry-sp-race-914592").click();
    await expect(page.getByTestId("industry-race-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-race-loading")).not.toBeVisible({ timeout: 10000 });

    await expect(page.getByTestId("industry-race-isp-12345")).toHaveText("ISP 7/2");
    await page.getByTestId("industry-race-odds-mode-toggle").click();
    await expect(page.getByTestId("industry-race-isp-12345")).toHaveText("ISP 4.50");
  });
});

// /isp is public — anonTest (see fixtures.ts) deliberately doesn't inject
// an auth token, unlike every other describe block in this file.
anonTest.describe("Industry SP filters screen — anonymous access (MSW mocked)", () => {
  anonTest("/isp loads with no token and shows Sign Up/Log In, not a login wall", async ({ page }) => {
    await page.goto("/isp");
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("auth-email-input")).not.toBeVisible();

    await expect(page.getByTestId("industry-sp-signup-button")).toBeVisible();
    await expect(page.getByTestId("industry-sp-login-button")).toBeVisible();
    await expect(page.getByTestId("industry-sp-logout-button")).not.toBeVisible();
  });

  anonTest("Sign Up button opens a dismissible auth overlay", async ({ page }) => {
    await page.goto("/isp");
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });

    await page.getByTestId("industry-sp-signup-button").click();
    await expect(page.getByTestId("auth-email-input")).toBeVisible();

    await page.getByTestId("auth-cancel-button").click();
    await expect(page.getByTestId("auth-email-input")).not.toBeVisible();
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible();
  });

  anonTest("cap banner appears when the matched total exceeds the anonymous raceCap", async ({ page }) => {
    await page.route((url) => url.pathname === "/api/industry-sp/splits", (route) =>
      route.fulfill({
        json: {
          success: true,
          totalRaces: 500,
          totalRunners: 1500,
          raceCap: 100,
          filterBounds: { maxRunnersPerRace: 29, maxIsp: 1000, minIsp: 1.1 },
          countries: ["GB", "IE"],
          courses: ["Cheltenham", "Ascot"],
          goings: ["Good", "Soft"],
          raceClasses: ["Class 1", "Class 2"],
          raceTypes: ["Chase", "Hurdle"],
          splitA: { fromRow: 1, toRow: 100, total: 100, totalRunners: 300, pnlStats: { staked: 1.6, returns: 2.6, pnl: 1.0, count: 3 } },
          splitB: { fromRow: 101, toRow: 200, total: 100, totalRunners: 300, pnlStats: { staked: 1.6, returns: 2.6, pnl: 1.0, count: 3 } },
        },
      })
    );

    await page.goto("/isp");
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("industry-sp-filter-apply").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 15000 });

    const banner = page.getByTestId("industry-sp-cap-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("Showing 100 of 500 races");

    await page.getByTestId("industry-sp-cap-banner-signup").click();
    await expect(page.getByTestId("auth-email-input")).toBeVisible();
  });

  anonTest("/events still requires login even though /isp doesn't", async ({ page }) => {
    await page.goto("/events");
    await expect(page.getByTestId("auth-email-input")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("events-screen")).not.toBeVisible();
  });

  anonTest("signing up via the overlay requires matching passwords and shows the verify-email banner afterward", async ({ page }) => {
    await page.route((url) => url.pathname === "/api/auth/signup", (route) =>
      route.fulfill({ json: { token: "fake.jwt.token", emailVerified: false }, status: 201 })
    );
    await page.route((url) => url.pathname === "/api/auth/me", (route) =>
      route.fulfill({ json: { success: true, email: "new.user@backbet.co.uk", emailVerified: false } })
    );

    await page.goto("/isp");
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-sp-benefits-banner")).toBeVisible();

    await page.getByTestId("industry-sp-signup-button").click();
    await expect(page.getByTestId("auth-email-input")).toBeVisible();
    await page.getByTestId("auth-mode-toggle").click();

    await page.getByTestId("auth-email-input").fill("new.user@backbet.co.uk");
    await page.getByTestId("auth-password-input").fill("correct-horse-battery");
    await page.getByTestId("auth-confirm-password-input").fill("a-different-password");
    await expect(page.getByTestId("auth-confirm-password-error")).toBeVisible();
    await expect(page.getByTestId("auth-signup-button")).toBeDisabled();

    await page.getByTestId("auth-confirm-password-input").fill("correct-horse-battery");
    await expect(page.getByTestId("auth-confirm-password-error")).not.toBeVisible();
    await expect(page.getByTestId("auth-signup-button")).toBeEnabled();
    await page.getByTestId("auth-signup-button").click();

    await expect(page.getByTestId("auth-email-input")).not.toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId("industry-sp-benefits-banner")).not.toBeVisible();
    await expect(page.getByTestId("industry-sp-verify-banner")).toBeVisible();

    await page.getByTestId("industry-sp-verify-resend").click();
    await expect(page.getByTestId("industry-sp-verify-banner")).toContainText("Verification email sent");
  });
});
