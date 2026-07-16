import { test, expect } from "@playwright/test";

const APP_URL = "http://localhost:80/";
const API_URL = "http://localhost:3000";

async function getBearerToken(request: import("@playwright/test").APIRequestContext): Promise<string> {
  const res = await request.post(`${API_URL}/api/auth/login`, {
    data: { username: "matthew", password: "beyer" },
  });
  const body = await res.json();
  return body.token as string;
}

async function goToEvents(page: import("@playwright/test").Page) {
  // ?u=&p= triggers a real login (POST /api/auth/login) and stores the Bearer
  // JWT the app actually needs — plain navigation lands on the login screen.
  // /isp is the home page ("/"), so Events must be requested explicitly.
  await page.goto(`${APP_URL}events?u=matthew&p=beyer`);
  await expect(page.getByTestId("events-screen")).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("event-group-loading")).not.toBeVisible({ timeout: 90000 });
}

async function gotoIsp(page: import("@playwright/test").Page) {
  await page.goto(`${APP_URL}isp?u=matthew&p=beyer`);
}

test.describe("GET /api/industry-sp (live server @ localhost:3000)", () => {
  test("returns races array with raceId on each race", async ({ request }) => {
    const token = await getBearerToken(request);
    const res = await request.get(`${API_URL}/api/industry-sp`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.count).toBe(body.data.length);
    expect(typeof body.totalRunners).toBe("number");
  });

  test("each race has raceId, course, countryCode, runners", async ({ request }) => {
    const token = await getBearerToken(request);
    const res = await request.get(`${API_URL}/api/industry-sp`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    const race = body.data[0];
    expect(typeof race.raceId).toBe("number");
    expect(typeof race.course).toBe("string");
    expect(typeof race.countryCode).toBe("string");
    expect(Array.isArray(race.runners)).toBe(true);
  });

  test("returns 401 without Authorization header", async ({ request }) => {
    const res = await request.get(`${API_URL}/api/industry-sp`);
    expect(res.status()).toBe(401);
  });

  test("runners include isp field", async ({ request }) => {
    const token = await getBearerToken(request);
    const res = await request.get(`${API_URL}/api/industry-sp`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    const allRunners = body.data.flatMap((r: any) => r.runners);
    const runnersWithIsp = allRunners.filter((r: any) => r.isp != null);
    expect(runnersWithIsp.length).toBeGreaterThan(0);
    for (const runner of runnersWithIsp) {
      expect(typeof runner.isp).toBe("number");
    }
  });
});

test.describe("Industry SP screen (Expo web @ localhost:80)", () => {
  test("nav link on Events screen navigates to /isp full-screen view", async ({ page }) => {
    await goToEvents(page);
    await expect(page.getByTestId("events-stats-bar")).toBeVisible({ timeout: 10000 });

    await page.getByTestId("events-nav-isp").click();

    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("events-screen")).not.toBeVisible();
  });

  test("/isp URL shows Industry SP screen directly", async ({ page }) => {
    await gotoIsp(page);
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
  });

  test("/ (home page) shows Industry SP screen directly", async ({ page }) => {
    await page.goto(`${APP_URL}?u=matthew&p=beyer`);
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("events-screen")).not.toBeVisible();
  });

  test("Industry SP screen loads data and shows runner rows", async ({ page }) => {
    await gotoIsp(page);
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 90000 });
    await expect(page.getByTestId("industry-sp-list")).toBeVisible({ timeout: 10000 });

    const items = page.locator('[data-testid^="industry-sp-item-"]');
    await expect(items.first()).toBeVisible({ timeout: 10000 });
    expect(await items.count()).toBeGreaterThan(0);
  });

  test("Industry SP screen shows meeting section headers", async ({ page }) => {
    await gotoIsp(page);
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 90000 });

    const meetingHeaders = page.locator('[data-testid^="industry-sp-meeting-"]');
    await expect(meetingHeaders.first()).toBeVisible({ timeout: 10000 });
    expect(await meetingHeaders.count()).toBeGreaterThan(0);
  });

  test("Industry SP screen shows race time headers within each meeting", async ({ page }) => {
    await gotoIsp(page);
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 90000 });

    const raceHeaders = page.locator('[data-testid^="industry-sp-race-"]');
    await expect(raceHeaders.first()).toBeVisible({ timeout: 10000 });
    expect(await raceHeaders.count()).toBeGreaterThan(1);
  });

  test("PnL bar shows horse count (react-native-paper Appbar subtitle does not render on web)", async ({ page }) => {
    await gotoIsp(page);
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 90000 });
    await expect(page.getByTestId("industry-sp-pnl-count")).toContainText("Horses");
  });

  test("ISP price is displayed for runners", async ({ page }) => {
    await gotoIsp(page);
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 90000 });

    const ispBadges = page.locator('[data-testid^="industry-sp-isp-"]');
    await expect(ispBadges.first()).toBeVisible({ timeout: 10000 });
    expect(await ispBadges.count()).toBeGreaterThan(0);

    const firstIspText = await ispBadges.first().textContent();
    expect(firstIspText).toMatch(/^ISP \d/);
  });

  test("← Events button navigates back to /events", async ({ page }) => {
    await gotoIsp(page);
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });

    await page.getByTestId("industry-sp-screen-events-button").click();

    await expect(page.getByTestId("events-screen")).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId("industry-sp-screen")).not.toBeVisible();
  });
});

test.describe("# in ISP range filter (real app at localhost:80)", () => {
  test("# in ISP filter controls are visible on /isp", async ({ page }) => {
    await gotoIsp(page);
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 90000 });
    await expect(page.getByTestId("industry-sp-min-rir-value")).toBeVisible();
    await expect(page.getByTestId("industry-sp-max-rir-value")).toBeVisible();
  });

  test("setting maxRunnersInRange=1 hides multi-runner races", async ({ page }) => {
    await gotoIsp(page);
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 90000 });
    const raceRows = page.locator(`[data-testid^="industry-sp-race-"]`);
    await expect(raceRows.first()).toBeVisible({ timeout: 10000 });
    const before = await raceRows.count();
    await page.getByTestId("industry-sp-max-rir-value").fill("1");
    await page.getByTestId("industry-sp-filter-apply").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 90000 });
    const after = await raceRows.count();
    expect(after).toBeLessThan(before);
  });

  test("resetting filter restores original race count", async ({ page }) => {
    await gotoIsp(page);
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 90000 });
    const raceRows = page.locator(`[data-testid^="industry-sp-race-"]`);
    await expect(raceRows.first()).toBeVisible({ timeout: 10000 });
    const original = await raceRows.count();
    await page.getByTestId("industry-sp-max-rir-value").fill("1");
    await page.getByTestId("industry-sp-filter-apply").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 90000 });
    await page.getByTestId("industry-sp-min-rir-value").fill("1");
    await page.getByTestId("industry-sp-max-rir-value").fill("30");
    await page.getByTestId("industry-sp-filter-apply").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 90000 });
    await expect(raceRows.first()).toBeVisible({ timeout: 10000 });
    const restored = await raceRows.count();
    expect(restored).toBe(original);
  });
});

test.describe("Filter query param persistence + Reset button (real app at localhost:80)", () => {
  test("applying a filter updates the URL query string", async ({ page }) => {
    await gotoIsp(page);
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 90000 });

    await page.getByTestId("industry-sp-max-rir-value").fill("5");
    await page.getByTestId("industry-sp-filter-apply").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 90000 });

    expect(page.url()).toContain("maxInIspRange=5");
  });

  test("reloading a URL with filter params restores those filter values", async ({ page }) => {
    await gotoIsp(page);
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 90000 });

    await page.getByTestId("industry-sp-max-rir-value").fill("5");
    await page.getByTestId("industry-sp-filter-apply").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 90000 });
    const urlAfterApply = page.url();

    await page.goto(urlAfterApply);
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 90000 });

    await expect(page.getByTestId("industry-sp-max-rir-value")).toHaveValue("5");
  });

  test("Reset button restores default filter values and clears the URL query string", async ({ page }) => {
    await gotoIsp(page);
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 90000 });

    await page.getByTestId("industry-sp-max-rir-value").fill("5");
    await page.getByTestId("industry-sp-filter-apply").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 90000 });
    expect(page.url()).toContain("maxInIspRange=5");

    await page.getByTestId("industry-sp-filter-reset").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 90000 });

    await expect(page.getByTestId("industry-sp-max-rir-value")).toHaveValue("30");
    expect(page.url()).not.toContain("maxInIspRange");
  });
});

test.describe("Sort order toggle (real app at localhost:80)", () => {
  test("sort toggle button is visible on /isp", async ({ page }) => {
    await gotoIsp(page);
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 90000 });
    await expect(page.getByTestId("industry-sp-sort-toggle")).toBeVisible();
  });

  test("sort toggle starts showing 'First → Last'", async ({ page }) => {
    await gotoIsp(page);
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 90000 });
    await expect(page.getByTestId("industry-sp-sort-toggle")).toHaveText("First → Last");
  });

  test("clicking toggle switches to 'Last → First' and reloads data", async ({ page }) => {
    await gotoIsp(page);
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 90000 });

    await page.getByTestId("industry-sp-sort-toggle").click();
    await expect(page.getByTestId("industry-sp-sort-toggle")).toHaveText("Last → First");
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId("industry-sp-list")).toBeVisible();
  });

  test("desc sort sends sort=desc to the API", async ({ page }) => {
    let sortParam: string | null = null;
    await page.route(`${API_URL}/api/industry-sp**`, (route) => {
      const url = new URL(route.request().url());
      sortParam = url.searchParams.get("sort");
      route.continue();
    });

    await gotoIsp(page);
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 90000 });
    await page.getByTestId("industry-sp-sort-toggle").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 30000 });

    expect(sortParam).toBe("desc");
  });

  async function fetchGroundTruthExtremes(request: import("@playwright/test").APIRequestContext) {
    const token = await getBearerToken(request);
    // minRunners/maxRunners must mirror the frontend's own defaults
    // (IndustrySpScreen.tsx's FILTER_DEFAULTS) — the backend's own default
    // maxRunners (30) is wider, so leaving it off here could pick a "true"
    // earliest/latest race that the frontend's default view wouldn't
    // actually include, causing a false mismatch.
    const res = await request.get(`${API_URL}/api/industry-sp?limit=5000&sort=asc&minRunners=1&maxRunners=20`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    const races: { raceTime: string; course: string }[] = body.data;
    const earliest = races.reduce((min, r) => (r.raceTime < min.raceTime ? r : min), races[0]);
    const latest = races.reduce((max, r) => (r.raceTime > max.raceTime ? r : max), races[0]);
    return { earliest, latest };
  }

  // Compares by course name (raw, no timezone-dependent formatting) rather
  // than the displayed HH:MM, which goes through a UTC-naive-string ->
  // Europe/London conversion (formatRaceTime) that shifts by an hour across
  // the BST boundary — comparing formatted time text would be a fragile,
  // timezone-dependent test in its own right.
  test("'First → Last' shows the true earliest race in the full dataset, not just a locally-sorted page", async ({ page, request }) => {
    // Regression test: the aggregation used to $sort documents that still
    // carried their full embedded runners array, risking Atlas M0's 32MB
    // in-memory sort limit as the collection grows (this already caused a
    // MongoServerError 292 / 500 in production for the equivalent Betfair-SP
    // query). A bug in that neighborhood — e.g. paginating before sorting —
    // would produce a page whose races are consistent with each other while
    // silently missing the actual earliest race, which is exactly what was
    // reported. Ground truth here comes from a raw, high-limit API call
    // rather than a UI-only check, so this can't pass by coincidence.
    const { earliest } = await fetchGroundTruthExtremes(request);

    await gotoIsp(page);
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 90000 });
    const firstMeeting = page.locator('[data-testid^="industry-sp-meeting-"]').first();
    await expect(firstMeeting).toBeVisible({ timeout: 10000 });
    await expect(firstMeeting).toContainText(earliest.course);
  });

  test("'Last → First' shows the true latest race in the full dataset", async ({ page, request }) => {
    const { latest } = await fetchGroundTruthExtremes(request);

    await gotoIsp(page);
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 90000 });
    await page.getByTestId("industry-sp-sort-toggle").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 30000 });

    const firstMeeting = page.locator('[data-testid^="industry-sp-meeting-"]').first();
    await expect(firstMeeting).toBeVisible({ timeout: 10000 });
    await expect(firstMeeting).toContainText(latest.course);
  });

  test("toggling back to 'First → Last' still shows the true earliest race", async ({ page, request }) => {
    const { earliest } = await fetchGroundTruthExtremes(request);

    await gotoIsp(page);
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 90000 });
    await page.getByTestId("industry-sp-sort-toggle").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 30000 });
    await page.getByTestId("industry-sp-sort-toggle").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 30000 });

    const firstMeeting = page.locator('[data-testid^="industry-sp-meeting-"]').first();
    await expect(firstMeeting).toBeVisible({ timeout: 10000 });
    await expect(firstMeeting).toContainText(earliest.course);
  });
});
