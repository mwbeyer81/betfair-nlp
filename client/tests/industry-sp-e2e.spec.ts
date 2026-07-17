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

// /isp is the filters + PnL screen — it renders no race list of its own.
async function gotoIsp(page: import("@playwright/test").Page) {
  await page.goto(`${APP_URL}isp?u=matthew&p=beyer`);
  await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 90000 });
}

// /isp/races is the dedicated races-list screen (meetings/races/runners,
// sort, odds mode) — it reads whatever filters are in the URL query string.
async function gotoIspRaces(page: import("@playwright/test").Page, query = "") {
  await page.goto(`${APP_URL}isp/races?u=matthew&p=beyer${query ? `&${query}` : ""}`);
  await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 90000 });
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

test.describe("Industry SP filters screen (Expo web @ localhost:80)", () => {
  test("nav link on Events screen navigates to /isp full-screen view", async ({ page }) => {
    await goToEvents(page);
    await expect(page.getByTestId("events-stats-bar")).toBeVisible({ timeout: 10000 });

    await page.getByTestId("events-nav-isp").click();

    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("events-screen")).not.toBeVisible();
  });

  test("/isp URL shows Industry SP filters screen directly", async ({ page }) => {
    await gotoIsp(page);
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
  });

  test("/ (home page) shows Industry SP filters screen directly", async ({ page }) => {
    await page.goto(`${APP_URL}?u=matthew&p=beyer`);
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("events-screen")).not.toBeVisible();
  });

  test("filters screen loads aggregate totals and shows the View Races button", async ({ page }) => {
    await gotoIsp(page);
    await expect(page.getByTestId("industry-sp-split-card-a")).toBeVisible({ timeout: 60000 });
    const btn = page.getByTestId("industry-sp-view-races-button-a");
    await expect(btn).toBeVisible();
    await expect(btn).toContainText(/View \d+ Races/);
  });

  test("PnL bar shows horse count (react-native-paper Appbar subtitle does not render on web)", async ({ page }) => {
    await gotoIsp(page);
    await expect(page.getByTestId("industry-sp-pnl-count-a")).toContainText("Horses", { timeout: 60000 });
  });

  test("both Race A and Race B splits render their own card and View Races button, defaulting to the first/second half of the matching races", async ({ page }) => {
    await gotoIsp(page);
    await expect(page.getByTestId("industry-sp-split-card-a")).toBeVisible({ timeout: 60000 });
    await expect(page.getByTestId("industry-sp-split-card-b")).toBeVisible({ timeout: 60000 });
    await expect(page.getByTestId("industry-sp-view-races-button-a")).toContainText(/View \d+ Races/);
    await expect(page.getByTestId("industry-sp-view-races-button-b")).toContainText(/View \d+ Races/);

    const fromA = await page.getByTestId("industry-sp-from-row-a").inputValue();
    const toA = await page.getByTestId("industry-sp-to-row-a").inputValue();
    const fromB = await page.getByTestId("industry-sp-from-row-b").inputValue();
    // Split B picks up immediately where split A's default range left off.
    expect(parseInt(fromB, 10)).toBe(parseInt(toA, 10) + 1);
    expect(parseInt(fromA, 10)).toBe(1);
  });

  test("← Events button navigates back to /events", async ({ page }) => {
    await gotoIsp(page);
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });

    await page.getByTestId("industry-sp-screen-events-button").click();

    await expect(page.getByTestId("events-screen")).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId("industry-sp-screen")).not.toBeVisible();
  });

  test("View Races button navigates to /isp/races and shows runner rows", async ({ page }) => {
    await gotoIsp(page);
    await page.getByTestId("industry-sp-view-races-button-a").click();

    await expect(page.getByTestId("industry-sp-races-screen")).toBeVisible({ timeout: 10000 });
    expect(page.url()).toContain("/isp/races");
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 90000 });
    await expect(page.getByTestId("industry-sp-list")).toBeVisible({ timeout: 60000 });

    const items = page.locator('[data-testid^="industry-sp-item-"]');
    await expect(items.first()).toBeVisible({ timeout: 30000 });
    expect(await items.count()).toBeGreaterThan(0);
  });

  test("applying a filter on /isp carries over to /isp/races when View Races is clicked", async ({ page }) => {
    await gotoIsp(page);
    await page.getByTestId("industry-sp-max-rir-value").fill("5");
    await page.getByTestId("industry-sp-filter-apply").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 90000 });
    expect(page.url()).toContain("maxInIspRange=5");

    await page.getByTestId("industry-sp-view-races-button-a").click();
    await expect(page.getByTestId("industry-sp-races-screen")).toBeVisible({ timeout: 10000 });
    // Regression: the router's queryParams state can go stale after
    // history.replaceState calls, silently dropping just-applied filters.
    expect(page.url()).toContain("maxInIspRange=5");
  });

  test("the races screen's back button returns to /isp with filters preserved", async ({ page }) => {
    await gotoIsp(page);
    await page.getByTestId("industry-sp-max-rir-value").fill("5");
    await page.getByTestId("industry-sp-filter-apply").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 90000 });

    await page.getByTestId("industry-sp-view-races-button-a").click();
    await expect(page.getByTestId("industry-sp-races-screen")).toBeVisible({ timeout: 10000 });

    await page.getByTestId("industry-sp-races-back").click();
    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
    expect(page.url()).toContain("maxInIspRange=5");
    await expect(page.getByTestId("industry-sp-max-rir-value")).toHaveValue("5");
  });
});

test.describe("Industry SP races screen (Expo web @ localhost:80)", () => {
  test("Industry SP races screen loads data and shows runner rows", async ({ page }) => {
    await gotoIspRaces(page);
    await expect(page.getByTestId("industry-sp-list")).toBeVisible({ timeout: 60000 });

    const items = page.locator('[data-testid^="industry-sp-item-"]');
    await expect(items.first()).toBeVisible({ timeout: 30000 });
    expect(await items.count()).toBeGreaterThan(0);
  });

  test("Industry SP races screen shows meeting section headers", async ({ page }) => {
    await gotoIspRaces(page);

    const meetingHeaders = page.locator('[data-testid^="industry-sp-meeting-"]');
    await expect(meetingHeaders.first()).toBeVisible({ timeout: 30000 });
    expect(await meetingHeaders.count()).toBeGreaterThan(0);
  });

  test("Industry SP races screen shows race time headers within each meeting", async ({ page }) => {
    await gotoIspRaces(page);

    const raceHeaders = page.locator('[data-testid^="industry-sp-race-"]');
    await expect(raceHeaders.first()).toBeVisible({ timeout: 30000 });
    expect(await raceHeaders.count()).toBeGreaterThan(1);
  });

  test("ISP price is displayed for runners", async ({ page }) => {
    await gotoIspRaces(page);

    const ispBadges = page.locator('[data-testid^="industry-sp-isp-"]');
    await expect(ispBadges.first()).toBeVisible({ timeout: 30000 });
    expect(await ispBadges.count()).toBeGreaterThan(0);

    const firstIspText = await ispBadges.first().textContent();
    // Default display is fraction ("ISP 8/15") or the textual "ISP Evens" —
    // not necessarily starting with a digit.
    expect(firstIspText).toMatch(/^ISP (\d+\/\d+|Evens)$/);
  });

  test("← Filters button navigates back to /isp", async ({ page }) => {
    await gotoIspRaces(page);

    await page.getByTestId("industry-sp-races-back").click();

    await expect(page.getByTestId("industry-sp-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-sp-races-screen")).not.toBeVisible();
  });
});

test.describe("Filter query param persistence + Reset button (real app at localhost:80)", () => {
  test("applying a filter updates the URL query string", async ({ page }) => {
    await gotoIsp(page);

    await page.getByTestId("industry-sp-max-rir-value").fill("5");
    await page.getByTestId("industry-sp-filter-apply").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 90000 });

    expect(page.url()).toContain("maxInIspRange=5");
  });

  test("reloading a URL with filter params restores those filter values", async ({ page }) => {
    await gotoIsp(page);

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

test.describe("# in ISP range filter (real app at localhost:80)", () => {
  test("# in ISP filter controls are visible on /isp", async ({ page }) => {
    await gotoIsp(page);
    await expect(page.getByTestId("industry-sp-min-rir-value")).toBeVisible();
    await expect(page.getByTestId("industry-sp-max-rir-value")).toBeVisible();
  });

  test("setting maxRunnersInRange=1 reduces the total races matching the filter", async ({ page }) => {
    await gotoIsp(page);
    await expect(page.getByTestId("industry-sp-split-card-a")).toBeVisible({ timeout: 60000 });
    const before = await page.getByTestId("industry-sp-split-card-a").textContent();

    await page.getByTestId("industry-sp-max-rir-value").fill("1");
    await page.getByTestId("industry-sp-filter-apply").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 90000 });

    const after = await page.getByTestId("industry-sp-split-card-a").textContent();
    expect(after).not.toBe(before);
  });

  test("resetting filter restores original race count", async ({ page }) => {
    await gotoIsp(page);
    await expect(page.getByTestId("industry-sp-split-card-a")).toBeVisible({ timeout: 60000 });
    const original = await page.getByTestId("industry-sp-split-card-a").textContent();

    await page.getByTestId("industry-sp-max-rir-value").fill("1");
    await page.getByTestId("industry-sp-filter-apply").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 90000 });

    await page.getByTestId("industry-sp-min-rir-value").fill("1");
    await page.getByTestId("industry-sp-max-rir-value").fill("30");
    await page.getByTestId("industry-sp-filter-apply").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 90000 });

    const restored = await page.getByTestId("industry-sp-split-card-a").textContent();
    expect(restored).toBe(original);
  });
});

test.describe("Sort order toggle (real app at localhost:80, on the races screen)", () => {
  test("sort toggle button is visible on /isp/races", async ({ page }) => {
    await gotoIspRaces(page);
    await expect(page.getByTestId("industry-sp-sort-toggle")).toBeVisible();
  });

  test("sort toggle starts showing 'First → Last'", async ({ page }) => {
    await gotoIspRaces(page);
    await expect(page.getByTestId("industry-sp-sort-toggle")).toHaveText("First → Last");
  });

  test("clicking toggle switches to 'Last → First' and reloads data", async ({ page }) => {
    await gotoIspRaces(page);

    await page.getByTestId("industry-sp-sort-toggle").click();
    await expect(page.getByTestId("industry-sp-sort-toggle")).toHaveText("Last → First");
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 90000 });
    await expect(page.getByTestId("industry-sp-list")).toBeVisible({ timeout: 30000 });
  });

  test("desc sort sends sort=desc to the API", async ({ page }) => {
    let sortParam: string | null = null;
    await page.route(`${API_URL}/api/industry-sp**`, (route) => {
      const url = new URL(route.request().url());
      sortParam = url.searchParams.get("sort");
      route.continue();
    });

    await gotoIspRaces(page);
    await page.getByTestId("industry-sp-sort-toggle").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 90000 });

    expect(sortParam).toBe("desc");
  });

  async function fetchGroundTruthExtremes(request: import("@playwright/test").APIRequestContext) {
    const token = await getBearerToken(request);
    // minRunners/maxRunners must mirror the frontend's own defaults
    // (IndustrySpScreen.tsx's FILTER_DEFAULTS) — the backend's own default
    // maxRunners (30) is wider, so leaving it off here could pick a "true"
    // earliest/latest race that the frontend's default view wouldn't
    // actually include, causing a false mismatch.
    //
    // Each extreme is fetched with its own server-side sort + limit=1 rather
    // than pulling a big page and reducing client-side: with ~109,775 races
    // in the full GB history, a single ascending page (even limit=5000) only
    // covers a small chronological slice from the start of the dataset, so
    // reducing that slice for "latest" silently returns the latest race
    // *within the slice*, not the true dataset-wide latest — a bug that
    // previously made this test compare against the wrong race entirely.
    const [earliestRes, latestRes] = await Promise.all([
      request.get(`${API_URL}/api/industry-sp?limit=1&sort=asc&minRunners=1&maxRunners=20`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      request.get(`${API_URL}/api/industry-sp?limit=1&sort=desc&minRunners=1&maxRunners=20`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    ]);
    const earliestBody = await earliestRes.json();
    const latestBody = await latestRes.json();
    const earliest: { raceTime: string; course: string } = earliestBody.data[0];
    const latest: { raceTime: string; course: string } = latestBody.data[0];
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

    await gotoIspRaces(page);
    const firstMeeting = page.locator('[data-testid^="industry-sp-meeting-"]').first();
    await expect(firstMeeting).toBeVisible({ timeout: 30000 });
    await expect(firstMeeting).toContainText(earliest.course);
  });

  test("'Last → First' shows the true latest race in the full dataset", async ({ page, request }) => {
    const { latest } = await fetchGroundTruthExtremes(request);

    await gotoIspRaces(page);
    await page.getByTestId("industry-sp-sort-toggle").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 90000 });

    const firstMeeting = page.locator('[data-testid^="industry-sp-meeting-"]').first();
    await expect(firstMeeting).toBeVisible({ timeout: 30000 });
    await expect(firstMeeting).toContainText(latest.course);
  });

  test("toggling back to 'First → Last' still shows the true earliest race", async ({ page, request }) => {
    const { earliest } = await fetchGroundTruthExtremes(request);

    await gotoIspRaces(page);
    await page.getByTestId("industry-sp-sort-toggle").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 90000 });
    await page.getByTestId("industry-sp-sort-toggle").click();
    await expect(page.getByTestId("industry-sp-loading")).not.toBeVisible({ timeout: 90000 });

    const firstMeeting = page.locator('[data-testid^="industry-sp-meeting-"]').first();
    await expect(firstMeeting).toBeVisible({ timeout: 30000 });
    await expect(firstMeeting).toContainText(earliest.course);
  });
});

// The 59 racecourses currently licensed by the British Horseracing Authority
// in Great Britain (England/Scotland/Wales) — sourced from
// britishhorseracing.com and cross-checked against Wikipedia's "List of
// British racecourses", using the short course-name forms (no "Park"/"City"/
// "-on-Avon" suffixes) that match how this dataset's `course` field is
// written. Deliberately excludes Down Royal/Downpatrick (Northern Ireland —
// administered by Horse Racing Ireland, not the BHA) since the requirement
// is Great Britain only, not "anything under the UK state".
const UK_RACECOURSES = new Set([
  "Aintree", "Ascot", "Ayr", "Bangor-on-Dee", "Bath", "Beverley", "Brighton",
  "Carlisle", "Cartmel", "Catterick", "Chelmsford", "Cheltenham", "Chepstow", "Chester",
  "Doncaster", "Epsom", "Exeter", "Fakenham", "Ffos Las", "Fontwell", "Goodwood",
  "Hamilton", "Haydock", "Hereford", "Hexham", "Huntingdon",
  "Kelso", "Kempton", "Leicester", "Lingfield", "Ludlow",
  "Market Rasen", "Musselburgh", "Newbury", "Newcastle", "Newmarket", "Newton Abbot",
  "Nottingham", "Perth", "Plumpton", "Pontefract", "Redcar", "Ripon",
  "Salisbury", "Sandown", "Sedgefield", "Southwell", "Stratford", "Taunton", "Thirsk",
  "Uttoxeter", "Warwick", "Wetherby", "Wincanton", "Windsor", "Wolverhampton", "Worcester",
  "Yarmouth", "York",
]);

test.describe("Industry SP data is UK-only (real app at localhost:80)", () => {
  // Regression test for the reported bug: the Kaggle source dataset is
  // titled "UK/Ireland" but actually covers Racing Post's full international
  // betting-market coverage (Hong Kong, Japan, Australia, US, France, UAE,
  // etc.) — Sha Tin (Hong Kong) was the very first race in the imported
  // trial window. This test intentionally has no import/reseed step of its
  // own: it checks whatever data is *currently live*, so it fails against
  // the un-filtered dataset and passes once the import is UK-only.
  test("every race returned by the API is at a genuine UK (Great Britain) racecourse", async ({ request }) => {
    const token = await getBearerToken(request);
    const res = await request.get(`${API_URL}/api/industry-sp?limit=5000`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.length).toBeGreaterThan(0);

    const nonUkCourses = [...new Set(body.data.map((r: { course: string }) => r.course))].filter(
      (course) => !UK_RACECOURSES.has(course as string)
    );
    expect(nonUkCourses, `Found non-UK courses in the data: ${JSON.stringify(nonUkCourses)}`).toEqual([]);
  });

  test("no Irish racecourses are present either", async ({ request }) => {
    const IRISH_COURSES = [
      "Ballinrobe", "Bellewstown", "Clonmel", "Cork", "Curragh", "Down Royal", "Downpatrick",
      "Dundalk", "Fairyhouse", "Gowran Park", "Kilbeggan", "Killarney", "Leopardstown",
      "Limerick", "Naas", "Navan", "Punchestown", "Roscommon", "Sligo", "Thurles",
      "Tramore", "Wexford",
    ];
    const token = await getBearerToken(request);
    const res = await request.get(`${API_URL}/api/industry-sp?limit=5000`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    const courses = new Set(body.data.map((r: { course: string }) => r.course));
    const irishFound = IRISH_COURSES.filter((c) => courses.has(c));
    expect(irishFound, `Found Irish courses in the data: ${JSON.stringify(irishFound)}`).toEqual([]);
  });

  test("the countries filter never offers IE, only GB", async ({ request }) => {
    const token = await getBearerToken(request);
    const res = await request.get(`${API_URL}/api/industry-sp/countries`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    expect(body.data).toEqual(["GB"]);
  });
});

test.describe("GET /api/industry-sp/meeting/:meetingId and /race/:raceId (live server @ localhost:3000)", () => {
  test("meeting endpoint returns all races for a meeting, sorted by time", async ({ request }) => {
    const token = await getBearerToken(request);
    const listRes = await request.get(`${API_URL}/api/industry-sp?limit=1`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const listBody = await listRes.json();
    const meetingId = listBody.data[0].meetingId;

    const res = await request.get(`${API_URL}/api/industry-sp/meeting/${encodeURIComponent(meetingId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
    for (const race of body.data) {
      expect(race.meetingId).toBe(meetingId);
    }
    for (let i = 1; i < body.data.length; i++) {
      expect(body.data[i].raceTime >= body.data[i - 1].raceTime).toBe(true);
    }
  });

  test("meeting endpoint returns 401 without auth", async ({ request }) => {
    const res = await request.get(`${API_URL}/api/industry-sp/meeting/anything`);
    expect(res.status()).toBe(401);
  });

  test("race endpoint returns a single race with its runners", async ({ request }) => {
    const token = await getBearerToken(request);
    const listRes = await request.get(`${API_URL}/api/industry-sp?limit=1`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const listBody = await listRes.json();
    const raceId = listBody.data[0].raceId;

    const res = await request.get(`${API_URL}/api/industry-sp/race/${raceId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.raceId).toBe(raceId);
    expect(Array.isArray(body.data.runners)).toBe(true);
    expect(body.data.runners.length).toBeGreaterThan(0);
  });

  test("race endpoint returns 404 for an unknown raceId", async ({ request }) => {
    const token = await getBearerToken(request);
    const res = await request.get(`${API_URL}/api/industry-sp/race/999999999`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(404);
  });

  test("race endpoint returns 401 without auth", async ({ request }) => {
    const res = await request.get(`${API_URL}/api/industry-sp/race/123`);
    expect(res.status()).toBe(401);
  });
});

test.describe("Meeting and race drill-down navigation (real app at localhost:80)", () => {
  test("tapping a meeting header opens a full-screen view of just that meeting", async ({ page }) => {
    await gotoIspRaces(page);

    const meetingLink = page.locator('[data-testid^="industry-sp-meeting-link-"]').first();
    const meetingText = (await meetingLink.textContent()) ?? "";
    await meetingLink.click();

    await expect(page.getByTestId("industry-meeting-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-sp-races-screen")).not.toBeVisible();
    await expect(page.getByTestId("industry-meeting-loading")).not.toBeVisible({ timeout: 30000 });
    expect(page.url()).toContain("/isp/meeting?id=");

    // Every race shown belongs to the meeting that was tapped.
    const races = page.locator('[data-testid^="industry-meeting-race-"]');
    await expect(races.first()).toBeVisible({ timeout: 10000 });
    expect(await races.count()).toBeGreaterThan(0);
    // Sanity: the tapped meeting's course name appears in the header title.
    const courseName = meetingText.split("—")[0].trim();
    await expect(page.getByText(courseName, { exact: false }).first()).toBeVisible();
  });

  test("meeting screen's back button returns to /isp/races", async ({ page }) => {
    await gotoIspRaces(page);
    await page.locator('[data-testid^="industry-sp-meeting-link-"]').first().click();
    await expect(page.getByTestId("industry-meeting-screen")).toBeVisible({ timeout: 10000 });

    await page.getByTestId("industry-meeting-back").click();

    await expect(page.getByTestId("industry-sp-races-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-meeting-screen")).not.toBeVisible();
    expect(page.url()).toMatch(/\/isp\/races(\?|$)/);
  });

  test("tapping a race (from the races list) opens a full-screen view of just that race", async ({ page }) => {
    await gotoIspRaces(page);

    const raceRow = page.locator('[data-testid^="industry-sp-race-"]:not([data-testid="industry-sp-race-bound"])').first();
    await raceRow.click();

    await expect(page.getByTestId("industry-race-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-sp-races-screen")).not.toBeVisible();
    await expect(page.getByTestId("industry-race-loading")).not.toBeVisible({ timeout: 30000 });
    expect(page.url()).toContain("/isp/race?id=");

    const runners = page.locator('[data-testid^="industry-race-item-"]');
    await expect(runners.first()).toBeVisible({ timeout: 10000 });
    expect(await runners.count()).toBeGreaterThan(0);
  });

  test("tapping a race from within the meeting view opens that race, and back returns to the meeting", async ({ page }) => {
    await gotoIspRaces(page);
    await page.locator('[data-testid^="industry-sp-meeting-link-"]').first().click();
    await expect(page.getByTestId("industry-meeting-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-meeting-loading")).not.toBeVisible({ timeout: 30000 });
    const meetingUrl = page.url();

    const raceRow = page.locator('[data-testid^="industry-meeting-race-"]').first();
    await raceRow.click();
    await expect(page.getByTestId("industry-race-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-race-loading")).not.toBeVisible({ timeout: 30000 });

    await page.getByTestId("industry-race-back").click();

    await expect(page.getByTestId("industry-meeting-screen")).toBeVisible({ timeout: 10000 });
    expect(page.url()).toBe(meetingUrl);
  });

  test("the race header shows a runner count that matches the number of runner rows shown", async ({ page }) => {
    await gotoIspRaces(page);
    await page.locator('[data-testid^="industry-sp-race-"]:not([data-testid="industry-sp-race-bound"])').first().click();
    await expect(page.getByTestId("industry-race-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-race-loading")).not.toBeVisible({ timeout: 30000 });

    const headerText = await page.getByTestId("industry-race-header").textContent();
    const match = headerText?.match(/(\d+) runners/);
    expect(match).not.toBeNull();
    const expectedCount = parseInt(match![1], 10);

    const actualCount = await page.locator('[data-testid^="industry-race-item-"]').count();
    expect(actualCount).toBe(expectedCount);
  });
});

test.describe("Odds display mode (real app at localhost:80, on the races screen)", () => {
  test("ISP defaults to fraction display", async ({ page }) => {
    await gotoIspRaces(page);
    await expect(page.getByTestId("industry-sp-odds-mode-toggle")).toHaveText("Odds: Fraction");

    const firstBadge = await page.locator('[data-testid^="industry-sp-isp-"]').first().textContent();
    // A fraction badge looks like "ISP 8/15" or "ISP Evens" — never a decimal point.
    expect(firstBadge).toMatch(/^ISP (\d+\/\d+|Evens)$/);
  });

  test("toggling to decimal shows a clean, rounded value — never a raw floating-point artifact", async ({ page }) => {
    await gotoIspRaces(page);

    await page.getByTestId("industry-sp-odds-mode-toggle").click();
    await expect(page.getByTestId("industry-sp-odds-mode-toggle")).toHaveText("Odds: Decimal");

    const ispBadges = page.locator('[data-testid^="industry-sp-isp-"]');
    // .allTextContents() below doesn't auto-wait like .first() does — it just
    // reads whatever's in the DOM at that instant, which can race the toggle's
    // re-render. Wait for at least one badge first.
    await expect(ispBadges.first()).toBeVisible({ timeout: 30000 });
    const badges = await ispBadges.allTextContents();
    expect(badges.length).toBeGreaterThan(0);
    for (const badge of badges) {
      // "ISP 3.13" — exactly 2 decimal places, never a long float like
      // "ISP 1.5333333333333332" (the original reported bug).
      expect(badge).toMatch(/^ISP \d+\.\d{2}$/);
    }
  });

  test("toggling back to fraction restores fraction display", async ({ page }) => {
    await gotoIspRaces(page);

    await page.getByTestId("industry-sp-odds-mode-toggle").click();
    await expect(page.getByTestId("industry-sp-odds-mode-toggle")).toHaveText("Odds: Decimal");
    await page.getByTestId("industry-sp-odds-mode-toggle").click();
    await expect(page.getByTestId("industry-sp-odds-mode-toggle")).toHaveText("Odds: Fraction");

    const badge = await page.locator('[data-testid^="industry-sp-isp-"]').first().textContent();
    expect(badge).toMatch(/^ISP (\d+\/\d+|Evens)$/);
  });

  test("the meeting screen also has a fraction/decimal toggle", async ({ page }) => {
    await gotoIspRaces(page);
    await page.locator('[data-testid^="industry-sp-meeting-link-"]').first().click();
    await expect(page.getByTestId("industry-meeting-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-meeting-loading")).not.toBeVisible({ timeout: 30000 });

    await expect(page.getByTestId("industry-meeting-odds-mode-toggle")).toHaveText("Odds: Fraction");
    const before = await page.locator('[data-testid^="industry-meeting-isp-"]').first().textContent();
    expect(before).toMatch(/^ISP (\d+\/\d+|Evens)$/);

    await page.getByTestId("industry-meeting-odds-mode-toggle").click();
    const after = await page.locator('[data-testid^="industry-meeting-isp-"]').first().textContent();
    expect(after).toMatch(/^ISP \d+\.\d{2}$/);
  });

  test("the race screen also has a fraction/decimal toggle", async ({ page }) => {
    await gotoIspRaces(page);
    await page.locator('[data-testid^="industry-sp-race-"]:not([data-testid="industry-sp-race-bound"])').first().click();
    await expect(page.getByTestId("industry-race-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("industry-race-loading")).not.toBeVisible({ timeout: 30000 });

    await expect(page.getByTestId("industry-race-odds-mode-toggle")).toHaveText("Odds: Fraction");
    const before = await page.locator('[data-testid^="industry-race-isp-"]').first().textContent();
    expect(before).toMatch(/^ISP (\d+\/\d+|Evens)$/);

    await page.getByTestId("industry-race-odds-mode-toggle").click();
    const after = await page.locator('[data-testid^="industry-race-isp-"]').first().textContent();
    expect(after).toMatch(/^ISP \d+\.\d{2}$/);
  });
});

test.describe("Filters visibility toggle (real app at localhost:80)", () => {
  test("filters are visible by default and the toggle button hides/shows them", async ({ page }) => {
    await gotoIsp(page);

    await expect(page.getByTestId("industry-sp-filter-bar")).toBeVisible();
    await expect(page.getByTestId("industry-sp-filters-toggle")).toHaveText("Hide filters ▾");

    await page.getByTestId("industry-sp-filters-toggle").click();
    await expect(page.getByTestId("industry-sp-filter-bar")).not.toBeVisible();
    await expect(page.getByTestId("industry-sp-filters-toggle")).toHaveText("Show filters ▸");

    // Hiding filters must not affect the aggregate totals shown below.
    await expect(page.getByTestId("industry-sp-split-card-a")).toBeVisible({ timeout: 30000 });

    await page.getByTestId("industry-sp-filters-toggle").click();
    await expect(page.getByTestId("industry-sp-filter-bar")).toBeVisible();
    await expect(page.getByTestId("industry-sp-filters-toggle")).toHaveText("Hide filters ▾");
  });
});
