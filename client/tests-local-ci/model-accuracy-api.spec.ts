import { test, expect } from "@playwright/test";

// Real backend + throwaway Mongo (no mocking), API tier — hits localhost:3050
// directly. The ISP slice is scored with synthetic-but-normalized model
// probabilities by scripts/local-ci-e2e.sh's Step 3f, so the aggregation has
// real documents to bucket rather than only the empty path.
//
// Every assertion here is an invariant of the aggregation itself, not a magic
// number: the seeded probabilities are deterministic but their exact
// distribution is an implementation detail of the seed command.
// Same reasoning as LOCAL_CI_APP_URL above: overridable so concurrent
// worktrees can claim their own backend port (LOCAL_CI_BACKEND_PORT).
const API_URL = process.env.LOCAL_CI_API_URL ?? "http://localhost:3050";

const BAND_LABELS = ["under 2.0", "2.0 – 3.0", "3.0 – 5.0", "5.0 – 10.0", "10.0 – 20.0", "20.0+"];

type Band = {
  bandKey: string;
  label: string;
  runners: number;
  wins: number;
  modelMeanProb: number;
  actualWinRate: number;
  marketMeanProbFair: number;
  marketMeanProbRaw: number;
  staked: number;
  returns: number;
  pnl: number;
  roiPercent: number;
  modelErrorPp: number;
  marketErrorPp: number;
  modelBrier: number;
  marketBrier: number;
};

async function token(request: import("@playwright/test").APIRequestContext): Promise<string> {
  const res = await request.post(`${API_URL}/api/auth/login`, {
    data: { email: "matthew@backbet.co.uk", password: "beyer" },
  });
  return (await res.json()).token as string;
}

async function fetchAccuracy(
  request: import("@playwright/test").APIRequestContext,
  t: string,
  query: Record<string, string> = {}
): Promise<{ data: Band[]; overall: Band; count: number }> {
  const qs = new URLSearchParams(query).toString();
  const res = await request.get(`${API_URL}/api/model-accuracy${qs ? `?${qs}` : ""}`, {
    headers: { Authorization: `Bearer ${t}` },
  });
  expect(res.status()).toBe(200);
  return res.json();
}

test.describe("GET /api/model-accuracy (real backend)", () => {
  test("requires auth", async ({ request }) => {
    const res = await request.get(`${API_URL}/api/model-accuracy`);
    expect(res.status()).toBe(401);
  });

  test("returns every band, shortest price first, with count matching", async ({ request }) => {
    const t = await token(request);
    const body = await fetchAccuracy(request, t);
    expect(body.data.map(b => b.label)).toEqual(BAND_LABELS);
    expect(body.count).toBe(body.data.length);
  });

  test("the seeded slice actually produces scored runners", async ({ request }) => {
    const t = await token(request);
    const body = await fetchAccuracy(request, t);
    // If this ever fails, Step 3f didn't run — every other assertion below
    // would then pass vacuously against all-zero bands.
    expect(body.overall.runners).toBeGreaterThan(0);
  });

  test("band runner counts and wins sum to the overall row", async ({ request }) => {
    const t = await token(request);
    const body = await fetchAccuracy(request, t);
    expect(body.data.reduce((s, b) => s + b.runners, 0)).toBe(body.overall.runners);
    expect(body.data.reduce((s, b) => s + b.wins, 0)).toBe(body.overall.wins);
  });

  test("wins never exceed runners and strike rates stay within 0-100", async ({ request }) => {
    const t = await token(request);
    const body = await fetchAccuracy(request, t);
    for (const band of [...body.data, body.overall]) {
      expect(band.wins).toBeLessThanOrEqual(band.runners);
      expect(band.actualWinRate).toBeGreaterThanOrEqual(0);
      expect(band.actualWinRate).toBeLessThanOrEqual(100);
    }
  });

  test("pnl equals returns minus staked in every band", async ({ request }) => {
    const t = await token(request);
    const body = await fetchAccuracy(request, t);
    for (const band of [...body.data, body.overall]) {
      expect(band.pnl).toBeCloseTo(band.returns - band.staked, 2);
    }
  });

  test("the raw market probability always exceeds the de-overrounded one", async ({ request }) => {
    const t = await token(request);
    const body = await fetchAccuracy(request, t);
    const populated = body.data.filter(b => b.runners > 0);
    expect(populated.length).toBeGreaterThan(0);
    for (const band of populated) {
      // This is the bookmaker's margin. If these two are ever equal, the
      // de-overrounding has silently stopped happening.
      expect(band.marketMeanProbRaw).toBeGreaterThan(band.marketMeanProbFair);
    }
  });

  test("error columns are the signed gap between each view and reality", async ({ request }) => {
    const t = await token(request);
    const body = await fetchAccuracy(request, t);
    for (const band of body.data.filter(b => b.runners > 0)) {
      expect(band.modelErrorPp).toBeCloseTo(band.modelMeanProb - band.actualWinRate, 1);
      expect(band.marketErrorPp).toBeCloseTo(band.marketMeanProbFair - band.actualWinRate, 1);
    }
  });

  test("Brier scores are real probabilities-squared, never negative", async ({ request }) => {
    const t = await token(request);
    const body = await fetchAccuracy(request, t);
    expect(body.overall.modelBrier).toBeGreaterThan(0);
    expect(body.overall.marketBrier).toBeGreaterThan(0);
    expect(body.overall.modelBrier).toBeLessThanOrEqual(1);
    expect(body.overall.marketBrier).toBeLessThanOrEqual(1);
  });

  test("a date filter narrows the runner pool", async ({ request }) => {
    const t = await token(request);
    const all = await fetchAccuracy(request, t);
    const narrowed = await fetchAccuracy(request, t, {
      minDate: "1990-01-01",
      maxDate: "1990-01-02",
    });
    expect(narrowed.overall.runners).toBe(0);
    expect(all.overall.runners).toBeGreaterThan(narrowed.overall.runners);
  });

  // Was "an unknown model version yields zero runners". Since a7efb1e there is
  // no modelVersionId filter on this endpoint at all: the screen reads
  // modelWinProbabilityOos, where each year's rows come from a different model
  // by construction, so "show me version X" has no answer (router.ts:724).
  // A stale ?modelVersionId= left in a bookmarked URL must therefore be
  // IGNORED, not silently narrow the result set to nothing — which is exactly
  // what the old assertion would have locked in. Comparing against an
  // unfiltered call is what makes "ignored" testable rather than assumed.
  test("a stale model-version param is ignored, not silently applied", async ({ request }) => {
    const t = await token(request);
    const unfiltered = await fetchAccuracy(request, t, {});
    const withStaleParam = await fetchAccuracy(request, t, {
      modelVersionId: "xgb-does-not-exist",
    });

    expect(unfiltered.overall.runners).toBeGreaterThan(0);
    expect(withStaleParam.overall.runners).toBe(unfiltered.overall.runners);
    expect(withStaleParam.data.map(b => b.label)).toEqual(BAND_LABELS);
  });

  test("rejects an inverted runner range", async ({ request }) => {
    const t = await token(request);
    const res = await request.get(`${API_URL}/api/model-accuracy?minRunners=20&maxRunners=4`, {
      headers: { Authorization: `Bearer ${t}` },
    });
    expect(res.status()).toBe(400);
  });
});
