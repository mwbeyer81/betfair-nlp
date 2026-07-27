import { test, expect } from "@playwright/test";

// Real backend + throwaway Mongo (no mocking), API tier — request fixture
// hitting localhost:3050 directly. Seeded via
// src/commands/seed-daily-races-fixture.ts (see local-ci-e2e.sh Step 3b):
// 5 races across 3 courses on 2026-06-03 — Newton Abbot (rac_test_0001,
// rac_test_0002), Ascot (rac_test_0003, rac_test_0004), Chepstow
// (rac_test_0005).
const API_URL = "http://localhost:3050";

async function token(request: import("@playwright/test").APIRequestContext): Promise<string> {
  const res = await request.post(`${API_URL}/api/auth/login`, {
    data: { email: "matthew@backbet.co.uk", password: "beyer" },
  });
  return (await res.json()).token as string;
}

test.describe("/api/daily-races — real backend + seeded Mongo", () => {
  test("401 without auth on all 3 endpoints", async ({ request }) => {
    expect((await request.get(`${API_URL}/api/daily-races?date=2026-06-03`)).status()).toBe(401);
    expect((await request.get(`${API_URL}/api/daily-races/event/newton-abbot-2026-06-03`)).status()).toBe(401);
    expect((await request.get(`${API_URL}/api/daily-races/race/rac_test_0001`)).status()).toBe(401);
  });

  test("GET /api/daily-races?date=2026-06-03 returns all 5 seeded races", async ({ request }) => {
    const t = await token(request);
    const res = await request.get(`${API_URL}/api/daily-races?date=2026-06-03`, {
      headers: { Authorization: `Bearer ${t}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.count).toBe(body.data.length);
    expect(body.data.length).toBe(5);
    const courses = new Set(body.data.map((r: { course: string }) => r.course));
    expect(courses).toEqual(new Set(["Newton Abbot", "Ascot", "Chepstow"]));
  });

  test("GET /api/daily-races/event/newton-abbot-2026-06-03 returns only that course's 2 races", async ({ request }) => {
    const t = await token(request);
    const res = await request.get(`${API_URL}/api/daily-races/event/newton-abbot-2026-06-03`, {
      headers: { Authorization: `Bearer ${t}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.length).toBe(2);
    for (const race of body.data) {
      expect(race.eventId).toBe("newton-abbot-2026-06-03");
      expect(race.course).toBe("Newton Abbot");
    }
  });

  test("GET /api/daily-races/race/rac_test_0001 returns the full race with its runners", async ({ request }) => {
    const t = await token(request);
    const res = await request.get(`${API_URL}/api/daily-races/race/rac_test_0001`, {
      headers: { Authorization: `Bearer ${t}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.raceId).toBe("rac_test_0001");
    expect(body.data.runners.length).toBe(2);
    expect(body.data.runners.map((r: { horse: string }) => r.horse)).toContain("Fixture Star");
  });

  test("GET /api/daily-races/race/:raceId returns 404 for an unknown id", async ({ request }) => {
    const t = await token(request);
    const res = await request.get(`${API_URL}/api/daily-races/race/rac_does_not_exist`, {
      headers: { Authorization: `Bearer ${t}` },
    });
    expect(res.status()).toBe(404);
  });
});
