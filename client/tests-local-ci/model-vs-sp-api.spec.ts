import { test, expect } from "@playwright/test";

// Real backend + throwaway Mongo (no mocking), API tier — hits localhost:3050
// directly. This is the only place the $abs difference filter, the summary
// aggregation and the paging pipeline run together against a real database:
// the MSW suite mocks the endpoint entirely, and the DAO integration test
// bypasses HTTP.
//
// The CI slice is a single seeded day (2026-06-03, see SEED_FROM_DATE in
// scripts/local-ci-e2e.sh), and Step 3f of that script writes synthetic
// modelWinProbability values onto it — without that step every assertion here
// could only ever confirm the empty state.
const API_URL = "http://localhost:3050";
const WINDOW = "minDate=2026-06-01&maxDate=2026-06-30";

async function login(request: import("@playwright/test").APIRequestContext): Promise<string> {
  const res = await request.post(`${API_URL}/api/auth/login`, {
    data: { email: "matthew@backbet.co.uk", password: "beyer" },
  });
  expect(res.status()).toBe(200);
  return (await res.json()).token;
}

test.describe("GET /api/model-vs-sp (real backend)", () => {
  let token: string;

  test.beforeAll(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    token = await login(request);
    await request.dispose();
  });

  function auth() {
    return { Authorization: `Bearer ${token}` };
  }

  test("401s without a token", async ({ request }) => {
    const res = await request.get(`${API_URL}/api/model-vs-sp`);
    expect(res.status()).toBe(401);
  });

  test("returns runner-level rows with model, implied SP and the signed gap", async ({ request }) => {
    const res = await request.get(`${API_URL}/api/model-vs-sp?${WINDOW}`, { headers: auth() });
    expect(res.status()).toBe(200);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);

    for (const row of body.data) {
      expect(typeof row.runnerId).toBe("number");
      expect(typeof row.modelWinProbability).toBe("number");
      expect(row.isp).toBeGreaterThan(1);
      // The two derived figures must agree with their definitions on real data,
      // not just on hand-built fixtures.
      expect(row.impliedSpProbability).toBeCloseTo(100 / row.isp, 6);
      expect(row.edge).toBeCloseTo(row.modelWinProbability - row.impliedSpProbability, 6);
    }
  });

  test("the summary's bands tile the whole population exactly", async ({ request }) => {
    const res = await request.get(`${API_URL}/api/model-vs-sp?${WINDOW}`, { headers: auth() });
    const { summary, total } = await res.json();

    expect(summary).toBeTruthy();
    const banded = summary.bands.reduce((sum: number, b: { count: number }) => sum + b.count, 0);
    // Every runner lands in exactly one band — no gaps at the boundaries, no
    // double-counting.
    expect(banded).toBe(summary.allRunners);
    // With no difference filter applied, everything matches.
    expect(summary.matchedRunners).toBe(summary.allRunners);
    expect(summary.matchedRunners).toBe(total);
  });

  test("cumulative shares increase monotonically and end at the tail", async ({ request }) => {
    const res = await request.get(`${API_URL}/api/model-vs-sp?${WINDOW}`, { headers: auth() });
    const { summary } = await res.json();

    const cumulative = summary.bands
      .map((b: { cumulativePercent: number | null }) => b.cumulativePercent)
      .filter((c: number | null): c is number => c != null);
    for (let i = 1; i < cumulative.length; i++) {
      expect(cumulative[i]).toBeGreaterThanOrEqual(cumulative[i - 1]);
    }
    // The last cumulative share plus the open-ended tail's own share accounts
    // for everyone.
    const tail = summary.bands[summary.bands.length - 1];
    expect(tail.cumulativePercent).toBeNull();
    expect(cumulative[cumulative.length - 1] + tail.percent).toBeCloseTo(100, 0);
  });

  test("the difference filter is unsigned — a band keeps rows on both sides of zero", async ({ request }) => {
    const res = await request.get(`${API_URL}/api/model-vs-sp?${WINDOW}&minAbsEdge=1&maxAbsEdge=100&limit=200`, {
      headers: auth(),
    });
    const { data } = await res.json();
    expect(data.length).toBeGreaterThan(0);
    for (const row of data) {
      expect(Math.abs(row.edge)).toBeGreaterThanOrEqual(1);
    }
    // The seeded slice has disagreements in both directions, so an unsigned
    // filter must return both — a signed one could only ever return one side.
    const signs = new Set(data.map((r: { edge: number }) => Math.sign(r.edge)));
    expect(signs.size).toBeGreaterThan(1);
  });

  test("the summary's denominator ignores the difference filter", async ({ request }) => {
    const wide = await request.get(`${API_URL}/api/model-vs-sp?${WINDOW}`, { headers: auth() });
    const narrow = await request.get(`${API_URL}/api/model-vs-sp?${WINDOW}&minAbsEdge=10`, { headers: auth() });

    const wideBody = await wide.json();
    const narrowBody = await narrow.json();

    expect(narrowBody.summary.allRunners).toBe(wideBody.summary.allRunners);
    expect(narrowBody.summary.matchedRunners).toBeLessThanOrEqual(wideBody.summary.matchedRunners);
    expect(narrowBody.summary.matchedRunners).toBe(narrowBody.total);
  });

  test("walking every page yields exactly total rows with no duplicates", async ({ request }) => {
    const first = await request.get(`${API_URL}/api/model-vs-sp?${WINDOW}&limit=5&sort=edge_desc`, {
      headers: auth(),
    });
    const { total, totalPages } = await first.json();
    expect(total).toBeGreaterThan(5);

    const seen = new Set<string>();
    let walked = 0;
    let previousEdge = Number.POSITIVE_INFINITY;
    for (let page = 1; page <= totalPages; page++) {
      const res = await request.get(
        `${API_URL}/api/model-vs-sp?${WINDOW}&limit=5&sort=edge_desc&page=${page}&includeTotal=false`,
        { headers: auth() }
      );
      const { data } = await res.json();
      for (const row of data) {
        seen.add(`${row.raceId}-${row.runnerId}`);
        walked++;
        // Monotonic across page boundaries — this is what the
        // (edge, raceTime, runnerId) tiebreak exists to guarantee.
        expect(row.edge).toBeLessThanOrEqual(previousEdge + 1e-9);
        previousEdge = row.edge;
      }
    }
    expect(walked).toBe(total);
    expect(seen.size).toBe(total);
  });

  test("omits the total and summary when the count is skipped", async ({ request }) => {
    const res = await request.get(`${API_URL}/api/model-vs-sp?${WINDOW}&includeTotal=false`, { headers: auth() });
    const body = await res.json();
    expect(body.total).toBeNull();
    expect(body.totalPages).toBeNull();
    expect(body.summary).toBeNull();
    expect(body.data.length).toBeGreaterThan(0);
  });

  test("clamps an over-wide date span and echoes the window actually queried", async ({ request }) => {
    const res = await request.get(`${API_URL}/api/model-vs-sp?minDate=2020-01-01&maxDate=2026-12-31`, {
      headers: auth(),
    });
    const body = await res.json();
    expect(body.minDate).toBe("2020-01-01");
    // 366 days on from the start, not the six years asked for.
    expect(body.maxDate).toBe("2021-01-01");
  });
});
