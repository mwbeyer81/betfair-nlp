import { test, expect } from "@playwright/test";

// Traditional e2e tier — assumes a dev backend and frontend already
// running by hand against the shared dev Mongo (see /dev-workflow). Ports
// here are THIS worktree's own claimed ports (scripts/claim-worktree-
// ports.sh daily-races-bet-button), not the shared defaults (3000/8081) —
// see AGENTS.md's "Working in a worktree" / worktree-ports skill for why.
const APP_URL = "http://localhost:8104/";
const API_URL = "http://localhost:3023";

// The seeded "matthew@backbet.co.uk" account other e2e specs assume
// doesn't actually exist in this VM's real dev Mongo (`users` collection
// is empty — confirmed directly, not assumed) — sign up (or log into, if
// a prior run already created it) a dedicated account for this file
// instead of depending on shared seed data that may or may not be present.
const TEST_EMAIL = "bet-orders-e2e@backbet.co.uk";
const TEST_PASSWORD = "betOrdersE2E123";

async function getBearerToken(request: import("@playwright/test").APIRequestContext): Promise<string> {
  const loginRes = await request.post(`${API_URL}/api/auth/login`, {
    data: { email: TEST_EMAIL, password: TEST_PASSWORD },
  });
  if (loginRes.ok()) return (await loginRes.json()).token as string;

  const signupRes = await request.post(`${API_URL}/api/auth/signup`, {
    data: { email: TEST_EMAIL, password: TEST_PASSWORD },
  });
  expect(signupRes.ok()).toBe(true);
  return (await signupRes.json()).token as string;
}

const VALID_BODY = {
  runnerId: "hrs_e2e_test",
  horse: "E2E Test Runner",
  course: "Test Course",
  offTime: "2:05",
  offDt: "2026-07-29T14:05:00.000Z",
  raceId: "rac_e2e_test",
  eventId: "test-course-2026-07-29",
  targetProfit: 20,
  maxStake: 10,
};

// Creating a bet order is pure Mongo CRUD in the real backend — it never
// calls Betfair (only the scheduled evaluator, which isn't provisioned,
// does — see bet-order-service.ts/AGENTS.md). Safe and fully deterministic
// against real dev Mongo regardless of what racecards happen to be loaded
// for today, unlike the UI section below.
test.describe("POST/GET/DELETE /api/bet-orders (live server, real dev Mongo)", () => {
  test("POST rejects without auth", async ({ request }) => {
    const res = await request.post(`${API_URL}/api/bet-orders`, { data: VALID_BODY });
    expect(res.status()).toBe(401);
  });

  test("GET list rejects without auth", async ({ request }) => {
    const res = await request.get(`${API_URL}/api/bet-orders`);
    expect(res.status()).toBe(401);
  });

  test("POST with a non-positive targetProfit returns 400", async ({ request }) => {
    const token = await getBearerToken(request);
    const res = await request.post(`${API_URL}/api/bet-orders`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { ...VALID_BODY, targetProfit: 0 },
    });
    expect(res.status()).toBe(400);
  });

  test("full loop: create, list (count matches), cancel, re-fetch shows cancelled, second cancel 404s", async ({ request }) => {
    const token = await getBearerToken(request);
    const headers = { Authorization: `Bearer ${token}` };

    const createRes = await request.post(`${API_URL}/api/bet-orders`, { headers, data: VALID_BODY });
    expect(createRes.status()).toBe(201);
    const created = (await createRes.json()).data;
    expect(created.status).toBe("pending");
    // 1 + 20/10 = 3
    expect(created.minQualifyingPrice).toBe(3);

    const listRes = await request.get(`${API_URL}/api/bet-orders`, { headers });
    expect(listRes.status()).toBe(200);
    const listBody = await listRes.json();
    expect(listBody.success).toBe(true);
    expect(listBody.count).toBe(listBody.data.length);
    expect(listBody.data.some((o: { id: string }) => o.id === created.id)).toBe(true);

    const cancelRes = await request.delete(`${API_URL}/api/bet-orders/${created.id}`, { headers });
    expect(cancelRes.status()).toBe(200);

    const refetchRes = await request.get(`${API_URL}/api/bet-orders`, { headers });
    const refetched = (await refetchRes.json()).data.find((o: { id: string }) => o.id === created.id);
    expect(refetched.status).toBe("cancelled");

    const secondCancelRes = await request.delete(`${API_URL}/api/bet-orders/${created.id}`, { headers });
    expect(secondCancelRes.status()).toBe(404);
  });
});

// Real-data UI tier — like saved-results-e2e.spec.ts, this doesn't control
// what's actually in today's real daily_racecards, so assertions are
// sampling-style (whatever the first qualifying pick happens to be) rather
// than pinned to a specific fixture horse.
test.describe("Bet button — full UI loop (live server, real dev Mongo)", () => {
  test("badge -> dialog -> real API create -> Scheduled Bets -> cancel", async ({ page, request }) => {
    // Ensure the account exists before the URL-param login flow tries to
    // log into it — see getBearerToken's doc comment above.
    await getBearerToken(request);
    await page.goto(`${APP_URL}daily-races?email=${encodeURIComponent(TEST_EMAIL)}&password=${encodeURIComponent(TEST_PASSWORD)}`);
    await expect(page.getByTestId("daily-races-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("daily-races-loading")).not.toBeVisible({ timeout: 30000 });

    // 0% threshold — as permissive as this filter gets, to maximize the
    // chance today's real data has at least one qualifying pick.
    await page.getByTestId("daily-races-min-model-win-probability").fill("0");
    await page.getByTestId("daily-races-filter-apply").click();

    const noPicksToday = await page.getByTestId("daily-races-picks-empty").isVisible().catch(() => false);
    test.skip(noPicksToday, "No Daily Races picks qualify today in real dev data — nothing to exercise.");

    const betBadges = page.locator('[data-testid^="daily-races-pick-bet-"]');
    await expect(betBadges.first()).toBeVisible({ timeout: 10000 });
    const runnerId = (await betBadges.first().getAttribute("data-testid"))!.replace("daily-races-pick-bet-", "");

    await betBadges.first().click();
    await expect(page.getByTestId("place-bet-dialog")).toBeVisible();
    // Proves the badge's own stopPropagation worked — still on Daily
    // Races, not navigated into the race screen.
    await expect(page.getByTestId("daily-races-screen")).toBeVisible();

    await page.getByTestId("place-bet-dialog-target-profit-input").fill("20");
    await page.getByTestId("place-bet-dialog-max-stake-input").fill("10");
    await expect(page.getByTestId("place-bet-dialog-min-price-preview")).toContainText("2/1 (3.00)");
    await page.getByTestId("place-bet-dialog-confirm").click();
    await expect(page.getByTestId("place-bet-dialog")).not.toBeVisible({ timeout: 10000 });

    await page.getByTestId("daily-races-menu-bets-link").click();
    await expect(page.getByTestId("scheduled-bets-screen")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("scheduled-bets-loading")).not.toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("scheduled-bets-list")).toBeVisible();

    // Newest-first list (BetOrderDAO.listByUser sorts by createdAt desc),
    // and this is the only agent/session creating bet_orders docs right
    // now (brand new collection, feature not merged/deployed anywhere
    // else yet) — the first item is reliably the one just created above,
    // whichever runner's badge was clicked.
    const item = page.locator('[data-testid^="scheduled-bet-item-"]').first();
    await expect(item).toBeVisible();
    const itemTestId = (await item.getAttribute("data-testid"))!;
    const betId = itemTestId.replace("scheduled-bet-item-", "");
    await expect(page.getByTestId(`scheduled-bet-status-${betId}`)).toHaveText("Pending");
    await expect(page.getByTestId(`scheduled-bet-condition-${betId}`)).toContainText("2/1 (3.00)+ to win £20.00 (stake up to £10.00)");

    await page.getByTestId(`scheduled-bet-cancel-${betId}`).click();
    await expect(page.getByTestId(`scheduled-bet-status-${betId}`)).toHaveText("Cancelled", { timeout: 10000 });
    await expect(page.getByTestId(`scheduled-bet-cancel-${betId}`)).not.toBeVisible();

    // Cleanup note: real dev Mongo now has one extra cancelled bet_orders
    // doc for runnerId ${runnerId} — harmless (cancelled orders are inert,
    // never picked up by any evaluator since none is provisioned), left in
    // place rather than deleted, same convention as other e2e specs in
    // this repo that write real dev data (e.g. saved-results-e2e.spec.ts
    // deletes what it creates via the UI itself, which this test also does
    // via the cancel action above — no raw DB cleanup needed).
    void runnerId;
  });

  test("Scheduled Bets is reachable directly and its back button returns to Daily Races", async ({ page, request }) => {
    await getBearerToken(request);
    await page.goto(`${APP_URL}bets?email=${encodeURIComponent(TEST_EMAIL)}&password=${encodeURIComponent(TEST_PASSWORD)}`);
    await expect(page.getByTestId("scheduled-bets-screen")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("scheduled-bets-back-button").click();
    await expect(page.getByTestId("daily-races-screen")).toBeVisible({ timeout: 10000 });
  });
});
