import { test, expect } from "@playwright/test";

// Real backend + throwaway Mongo (no mocking), API tier — request fixture
// hitting localhost:3050 directly. Cross-checks a saved snapshot's Split
// A/Split B pnlStats/graphPoints against live GET
// /api/industry-sp/race-convergence calls scoped to each split's own
// resolved range, rather than hardcoding magic numbers: both routes parse
// minRunners/maxRunners/minIsp/maxIsp/etc with identical clamping (see
// computeSnapshotParamsFromFilters in src/server/router.ts) and resolve the
// default half/half split via the same getSplitStats, so for filters that
// don't touch trainer-form/model fields, the two must agree exactly if the
// snapshot was computed correctly.
const API_URL = "http://localhost:3050";
const SEED_FILTERS = { courses: "Nottingham", minDate: "2026-06-03", maxDate: "2026-06-03" };

async function token(request: import("@playwright/test").APIRequestContext): Promise<string> {
  const res = await request.post(`${API_URL}/api/auth/login`, {
    data: { email: "matthew@backbet.co.uk", password: "beyer" },
  });
  return (await res.json()).token as string;
}

type ConvergencePoint = {
  raceRowNumber: number;
  cumulativeStaked: number;
  cumulativeReturns: number;
  cumulativePnl: number;
  roiPercent: number;
};

async function referenceConvergence(
  request: import("@playwright/test").APIRequestContext,
  t: string,
  fromRow: number,
  toRow: number
): Promise<ConvergencePoint[]> {
  const res = await request.get(
    `${API_URL}/api/industry-sp/race-convergence?courses=Nottingham&minDate=2026-06-03&maxDate=2026-06-03&fromRow=${fromRow}&toRow=${toRow}`,
    { headers: { Authorization: `Bearer ${t}` } }
  );
  expect(res.status()).toBe(200);
  return (await res.json()).data as ConvergencePoint[];
}

test.describe("/api/saved-filter-sets — real backend + seeded Mongo", () => {
  test("401 without auth on all 4 endpoints", async ({ request }) => {
    await expect((await request.post(`${API_URL}/api/saved-filter-sets`, { data: { filters: SEED_FILTERS } })).status()).toBe(401);
    await expect((await request.get(`${API_URL}/api/saved-filter-sets`)).status()).toBe(401);
    await expect((await request.get(`${API_URL}/api/saved-filter-sets/000000000000000000000000`)).status()).toBe(401);
    await expect((await request.delete(`${API_URL}/api/saved-filter-sets/000000000000000000000000`)).status()).toBe(401);
  });

  test("POST computes Split A/Split B snapshots each matching a live race-convergence call for their own resolved range", async ({
    request,
  }) => {
    const t = await token(request);
    // The full matched set, to learn the total and derive the same default
    // half/half divide getSplitStats computes when no explicit
    // fromRowA/toRowA/fromRowB/toRowB is sent (see SEED_FILTERS above).
    const full = await referenceConvergence(request, t, 1, 1000);
    expect(full.length).toBeGreaterThan(0);
    const total = full.length;
    const half = Math.floor(total / 2);

    const res = await request.post(`${API_URL}/api/saved-filter-sets`, {
      headers: { Authorization: `Bearer ${t}` },
      data: { name: "Nottingham API test", filters: SEED_FILTERS },
    });
    expect(res.status()).toBe(201);
    const { data } = await res.json();

    expect(data.name).toBe("Nottingham API test");
    expect(data.filters).toEqual(SEED_FILTERS);

    expect(data.splitA.fromRow).toBe(1);
    expect(data.splitA.toRow).toBe(half);
    const referenceA = await referenceConvergence(request, t, 1, half);
    const lastRefA = referenceA[referenceA.length - 1];
    // pnlStats.count is horses backed (qualifying runners), not races — the
    // same field the live Split A/B card's "Horses backed" row shows (see
    // SplitDetailPanel). Races is graphPoints.length, checked separately.
    expect(data.splitA.pnlStats.count).toBeGreaterThan(0);
    expect(data.splitA.pnlStats.staked).toBeCloseTo(lastRefA.cumulativeStaked, 5);
    expect(data.splitA.pnlStats.returns).toBeCloseTo(lastRefA.cumulativeReturns, 5);
    expect(data.splitA.pnlStats.pnl).toBeCloseTo(lastRefA.cumulativePnl, 5);
    expect(data.splitA.graphPoints).toHaveLength(referenceA.length);
    expect(data.splitA.graphPoints[data.splitA.graphPoints.length - 1].cumulativePnl).toBeCloseTo(lastRefA.cumulativePnl, 5);

    expect(data.splitB.fromRow).toBe(half + 1);
    const referenceB = await referenceConvergence(request, t, half + 1, 1000);
    const lastRefB = referenceB[referenceB.length - 1];
    expect(data.splitB.pnlStats.count).toBeGreaterThan(0);
    expect(data.splitB.pnlStats.staked).toBeCloseTo(lastRefB.cumulativeStaked, 5);
    expect(data.splitB.pnlStats.returns).toBeCloseTo(lastRefB.cumulativeReturns, 5);
    expect(data.splitB.pnlStats.pnl).toBeCloseTo(lastRefB.cumulativePnl, 5);
    expect(data.splitB.graphPoints).toHaveLength(referenceB.length);
    expect(data.splitB.graphPoints[data.splitB.graphPoints.length - 1].cumulativePnl).toBeCloseTo(lastRefB.cumulativePnl, 5);
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
