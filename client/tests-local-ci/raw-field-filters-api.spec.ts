import { test, expect } from "@playwright/test";

// The raw-model-field filters against the REAL stack — throwaway mongod, real
// backend, real aggregation, seeded from the one-day CSV slice (2026-06-03)
// that scripts/local-ci-e2e.sh imports.
//
// What this covers that nothing else does: the MSW specs mock the API, and the
// DAO integration tests insert documents directly. Only this path goes
// import-industry-sp.ts -> precompute-distance-furlongs.ts -> router -> DAO,
// which is the one place the *seeding* can be wrong. `distanceFurlongs` in
// particular is derived, not imported, so if that precompute step were ever
// dropped from local-ci-e2e.sh the distance filter would silently match
// nothing here and every other suite would still pass.
const API_URL = process.env.LOCAL_CI_API_URL ?? "http://localhost:3050";

async function token(request: import("@playwright/test").APIRequestContext): Promise<string> {
  const res = await request.post(`${API_URL}/api/auth/login`, {
    data: { email: "matthew@backbet.co.uk", password: "beyer" },
  });
  return (await res.json()).token as string;
}

async function isp(
  request: import("@playwright/test").APIRequestContext,
  t: string,
  query: string
) {
  const res = await request.get(`${API_URL}/api/industry-sp?limit=1&${query}`, {
    headers: { Authorization: `Bearer ${t}` },
  });
  return { status: res.status(), body: await res.json() };
}

test.describe("Raw model field filters (real stack)", () => {
  test("serves the field catalogue", async ({ request }) => {
    const res = await request.get(`${API_URL}/api/industry-sp/filter-fields`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.count).toBe(body.data.length);
    // The columns ml/train_and_predict.py trains on, minus the six that
    // already have their own filter on the screen.
    const names = body.data.map((f: { name: string }) => f.name);
    expect(names).toContain("officialRating");
    expect(names).toContain("distanceFurlongs");
    expect(names).toContain("hg");
  });

  test("the seed has a numeric distanceFurlongs on every race", async ({ request }) => {
    // Proves precompute-distance-furlongs.ts ran. Without it this filter would
    // return zero races and look like "no races are sprints" rather than
    // "the field does not exist".
    const t = await token(request);
    const all = await isp(request, t, "");
    const sprints = await isp(request, t, "maxDistanceFurlongs=7");
    const staying = await isp(request, t, "minDistanceFurlongs=12");

    expect(all.body.total).toBeGreaterThan(0);
    expect(sprints.body.total).toBeGreaterThan(0);
    expect(staying.body.total).toBeGreaterThan(0);
    // Two disjoint bands, both non-empty, summing to no more than the whole.
    expect(sprints.body.total + staying.body.total).toBeLessThanOrEqual(all.body.total);
  });

  test("a runner-scoped bound narrows the result", async ({ request }) => {
    const t = await token(request);
    const all = await isp(request, t, "");
    const rated = await isp(request, t, "minOfficialRating=1");
    // Official rating is ~78% populated in production and sparser still in a
    // one-day slice, so this asserts the direction rather than a fixed count.
    expect(rated.body.total).toBeLessThanOrEqual(all.body.total);
    expect(rated.body.totalRunners).toBeLessThan(all.body.totalRunners);
  });

  test("an age band narrows and stays self-consistent", async ({ request }) => {
    const t = await token(request);
    const all = await isp(request, t, "");
    const threeYos = await isp(request, t, "minAge=3&maxAge=3");
    expect(threeYos.body.totalRunners).toBeLessThan(all.body.totalRunners);
    // The P&L must describe the same runners the count does — the invariant
    // that broke once already when a filter was added to the qualifying-count
    // expression but not to pnlStats' own duplicate of it.
    expect(threeYos.body.pnlStats.count).toBe(threeYos.body.totalRunners);
  });

  test("400s on a misspelled field instead of returning everything", async ({ request }) => {
    const t = await token(request);
    const res = await isp(request, t, "minOffcialRating=90");
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("unknown filter field");
  });

  test("400s on a filter over a field with no data", async ({ request }) => {
    const t = await token(request);
    const res = await isp(request, t, "minHorseAvgExcuseScore=1");
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("not filterable");
  });

  test("splits accepts the same filters", async ({ request }) => {
    const t = await token(request);
    const res = await request.get(
      `${API_URL}/api/industry-sp/splits?minAge=3&maxAge=6`,
      { headers: { Authorization: `Bearer ${t}` } }
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    // The splits payload is spread at the top level, not nested under `data`.
    // Split A + Split B must partition the FILTERED set, not the unfiltered one.
    expect(body.splitA.total + body.splitB.total).toBeLessThanOrEqual(body.totalRaces);
  });
});
