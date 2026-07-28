import { test, expect } from "@playwright/test";

// One-off prod repro — see .claude/commands/prod-repro-scripts.md. Run
// once, against the REAL deployed app.backbet.co.uk bundle (which now
// includes the isp-year-walk-error fix — MAX_WALK_BATCH cap +
// overlap-trim, see AGENTS.md), to check the user's report that it's
// "still broke" tapping "Tap to load" on a collapsed year.
//
// User's report (screenshots, 2026-07-28, AFTER the isp-year-walk-error
// fix was deployed): Split B (fromRow=4925, toRow=9848, no Model
// win%/Model-beats-SP/trainer-form filters this time — a plainer
// scenario than the one the previous fix targeted), Date Jan 2024 ->
// Jan 2025, total 4924 races in the split. Initial load shows "20/4924
// races", 2024 expanded showing its first 20 races, 2025 collapsed
// showing "Tap to load". User says tapping "Tap to load" on 2025 still
// breaks — asked to write this as a Playwright script and to
// specifically wait a while after tapping to let any error surface.
//
// Same anonymous-request-cap constraint as every other prod-repro script
// for this feature (backend caps unauthenticated /api/industry-sp calls
// to 100 rows total) — intercepts just the API responses (page.route())
// with a synthetic ~4924-race dataset shaped like the real report,
// layered on the real, currently-deployed JS bundle. This exercises the
// real frontend walk algorithm; it can't exercise real backend/Mongo
// behavior (see the isp-year-walk-error entry in AGENTS.md for why a
// direct-to-DAO script was used instead to verify that layer).
const TOTAL = 4924;
// 2025 is a thin sliver at the very tail, same shape as the real report.
const YEAR_BOUNDARY = 4900;

function makeRace(index: number) {
  let raceTime: string;
  if (index >= YEAR_BOUNDARY) {
    const hour = 8 + ((index - YEAR_BOUNDARY) % 12);
    raceTime = `2025-01-01T${String(hour).padStart(2, "0")}:00:00`;
  } else {
    const dayOfYear = Math.floor((index / YEAR_BOUNDARY) * 365);
    const ms = Date.UTC(2024, 0, 1 + dayOfYear, 12, 0, 0);
    raceTime = new Date(ms).toISOString().slice(0, 19);
  }
  const date = raceTime.slice(0, 10);
  return {
    raceId: 950000 + index,
    meetingId: `SyntheticCourse|${date}`,
    meetingName: `Synthetic Course — ${date}`,
    course: "Synthetic Course",
    countryCode: "GB",
    raceTime,
    raceName: `Race ${index}`,
    raceType: "Flat",
    ran: 1,
    runners: [
      {
        id: 2950000 + index,
        name: `Runner ${index}`,
        num: 1,
        draw: null,
        status: "LOSER",
        sortPriority: 1,
        isp: 5,
        ispFraction: "4/1",
        isFavourite: false,
      },
    ],
  };
}

test("REPRO (2026-07-28, post-fix): tapping 'Tap to load' on a distant year, no Model filters, Split B", async ({ page }) => {
  test.setTimeout(150000);

  let requestCount = 0;
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", msg => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", err => {
    pageErrors.push(err.message);
  });

  await page.route("**/api/industry-sp?*", async route => {
    requestCount++;
    const url = new URL(route.request().url());
    const pageNum = parseInt(url.searchParams.get("page") || "1", 10);
    const limit = parseInt(url.searchParams.get("limit") || "20", 10);
    const skip = (pageNum - 1) * limit;
    const data = skip >= TOTAL ? [] : Array.from({ length: Math.min(limit, TOTAL - skip) }, (_, i) => makeRace(skip + i));
    console.log(`[mock] request #${requestCount}: page=${pageNum} limit=${limit} skip=${skip} -> ${data.length} races`);
    await route.fulfill({
      json: {
        success: true,
        data,
        count: data.length,
        total: TOTAL,
        page: pageNum,
        limit,
        totalPages: Math.ceil(TOTAL / limit),
        totalRunners: TOTAL,
        pnlStats: { staked: 0, returns: 0, pnl: 0, count: 0 },
      },
    });
  });

  await page.goto("/isp/races?minDate=2024-01-01&maxDate=2025-01-01&fromRow=4925&toRow=9848");
  await page.waitForSelector('[data-testid="industry-sp-year-toggle-2025"]', { timeout: 20000 });

  const countBefore = await page.locator('[data-testid="industry-sp-year-count-2025"]').textContent();
  console.log(`2025 count before tap: "${countBefore}"`);

  await page.click('[data-testid="industry-sp-year-toggle-2025"]');

  // Poll for up to 90s, logging progress every few seconds instead of a
  // single blocking wait, so the actual failure mode (stuck vs. error vs.
  // slow-but-resolves) is visible in the output either way.
  let resolved = false;
  let lastText = "";
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(3000);
    lastText = (await page.locator('[data-testid="industry-sp-year-count-2025"]').textContent()) || "";
    const errorVisible = await page.locator('text=Failed to load races').isVisible().catch(() => false);
    console.log(`[t+${(i + 1) * 3}s] 2025 count: "${lastText}", requests so far: ${requestCount}, error banner visible: ${errorVisible}, console errors: ${consoleErrors.length}, page errors: ${pageErrors.length}`);
    if (errorVisible) {
      console.log("ERROR BANNER APPEARED — dumping console/page errors:");
      consoleErrors.forEach(e => console.log("  console.error:", e));
      pageErrors.forEach(e => console.log("  pageerror:", e));
      break;
    }
    if (!lastText.includes("Tap to load") && !lastText.includes("Loading")) {
      resolved = true;
      break;
    }
  }

  console.log(`\nFinal: resolved=${resolved}, lastText="${lastText}", total requests=${requestCount}`);
  console.log(`Console errors (${consoleErrors.length}):`, consoleErrors);
  console.log(`Page errors (${pageErrors.length}):`, pageErrors);

  expect(pageErrors, "no uncaught JS errors").toEqual([]);
  const errorVisible = await page.locator('text=Failed to load races').isVisible().catch(() => false);
  expect(errorVisible, "no 'Failed to load races' banner").toBe(false);
  expect(resolved, `2025 should resolve to a real count, got "${lastText}"`).toBe(true);
});
