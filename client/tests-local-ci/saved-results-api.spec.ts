import { test, expect } from "@playwright/test";

// Real backend + throwaway Mongo (no mocking), API tier — request fixture
// hitting localhost:3050 directly. Cross-checks a saved snapshot's
// pnlStats/graphPoints against a live GET /api/industry-sp/race-convergence
// call with the same filters, rather than hardcoding magic numbers: both
// routes parse minRunners/maxRunners/minIsp/maxIsp/etc with identical
// clamping (see computeSnapshotParamsFromFilters in src/server/router.ts),
// so for filters that don't touch trainer-form/model fields, the two must
// agree exactly if the snapshot was computed correctly.
const API_URL = "http://localhost:3050";
const SEED_FILTERS = { courses: "Nottingham", minDate: "2026-06-03", maxDate: "2026-06-03" };

async function token(request: import("@playwright/test").APIRequestContext): Promise<string> {
  const res = await request.post(`${API_URL}/api/auth/login`, {
    data: { email: "matthew@backbet.co.uk", password: "beyer" },
  });
  return (await res.json()).token as string;
}

async function referenceConvergence(request: import("@playwright/test").APIRequestContext, t: string) {
  const res = await request.get(
    `${API_URL}/api/industry-sp/race-convergence?courses=Nottingham&minDate=2026-06-03&maxDate=2026-06-03&fromRow=1&toRow=1000`,
    { headers: { Authorization: `Bearer ${t}` } }
  );
  expect(res.status()).toBe(200);
  return (await res.json()).data as {
    raceRowNumber: number;
    cumulativeStaked: number;
    cumulativeReturns: number;
    cumulativePnl: number;
    roiPercent: number;
  }[];
}

test.describe("/api/saved-filter-sets — real backend + seeded Mongo", () => {
  test("401 without auth on all 4 endpoints", async ({ request }) => {
    await expect((await request.post(`${API_URL}/api/saved-filter-sets`, { data: { filters: SEED_FILTERS } })).status()).toBe(401);
    await expect((await request.get(`${API_URL}/api/saved-filter-sets`)).status()).toBe(401);
    await expect((await request.get(`${API_URL}/api/saved-filter-sets/000000000000000000000000`)).status()).toBe(401);
    await expect((await request.delete(`${API_URL}/api/saved-filter-sets/000000000000000000000000`)).status()).toBe(401);
  });

  test("POST computes a snapshot matching a live race-convergence call for the same filters", async ({ request }) => {
    const t = await token(request);
    const reference = await referenceConvergence(request, t);
    expect(reference.length).toBeGreaterThan(0);
    const lastRef = reference[reference.length - 1];

    const res = await request.post(`${API_URL}/api/saved-filter-sets`, {
      headers: { Authorization: `Bearer ${t}` },
      data: { name: "Nottingham API test", filters: SEED_FILTERS },
    });
    expect(res.status()).toBe(201);
    const { data } = await res.json();

    expect(data.name).toBe("Nottingham API test");
    expect(data.filters).toEqual(SEED_FILTERS);
    expect(data.pnlStats.count).toBe(reference.length);
    expect(data.pnlStats.staked).toBeCloseTo(lastRef.cumulativeStaked, 5);
    expect(data.pnlStats.returns).toBeCloseTo(lastRef.cumulativeReturns, 5);
    expect(data.pnlStats.pnl).toBeCloseTo(lastRef.cumulativePnl, 5);
    expect(data.graphPoints).toHaveLength(reference.length);
    expect(data.graphPoints[data.graphPoints.length - 1].cumulativePnl).toBeCloseTo(lastRef.cumulativePnl, 5);
  });

  test("POST with a blank name falls back to an auto-generated name containing the course", async ({ request }) => {
    const t = await token(request);
    const res = await request.post(`${API_URL}/api/saved-filter-sets`, {
      headers: { Authorization: `Bearer ${t}` },
      data: { filters: SEED_FILTERS },
    });
    expect(res.status()).toBe(201);
    const { data } = await res.json();
    expect(data.name).toContain("Nottingham");
    expect(data.name).toContain("2026-06-03");
  });

  test("full lifecycle: list contains it, get by id matches, delete removes it, 404 after", async ({ request }) => {
    const t = await token(request);
    const created = await request.post(`${API_URL}/api/saved-filter-sets`, {
      headers: { Authorization: `Bearer ${t}` },
      data: { name: "Lifecycle test", filters: SEED_FILTERS },
    });
    const { data: createdData } = await created.json();

    const list = await request.get(`${API_URL}/api/saved-filter-sets`, { headers: { Authorization: `Bearer ${t}` } });
    const listBody = await list.json();
    expect(listBody.count).toBe(listBody.data.length);
    expect(listBody.data.some((r: { id: string }) => r.id === createdData.id)).toBe(true);

    const got = await request.get(`${API_URL}/api/saved-filter-sets/${createdData.id}`, { headers: { Authorization: `Bearer ${t}` } });
    expect(got.status()).toBe(200);
    expect((await got.json()).data.name).toBe("Lifecycle test");

    const del = await request.delete(`${API_URL}/api/saved-filter-sets/${createdData.id}`, { headers: { Authorization: `Bearer ${t}` } });
    expect(del.status()).toBe(200);

    const afterDelete = await request.get(`${API_URL}/api/saved-filter-sets/${createdData.id}`, { headers: { Authorization: `Bearer ${t}` } });
    expect(afterDelete.status()).toBe(404);
  });

  test("GET by unknown id returns 404", async ({ request }) => {
    const t = await token(request);
    const res = await request.get(`${API_URL}/api/saved-filter-sets/000000000000000000000000`, {
      headers: { Authorization: `Bearer ${t}` },
    });
    expect(res.status()).toBe(404);
  });
});
