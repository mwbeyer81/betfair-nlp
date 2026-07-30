import { test, expect } from "@playwright/test";

// Verifies the one-day CSV slice (2026-06-03) that scripts/local-ci-e2e.sh
// seeds into the throwaway DB landed exactly as expected. Unlike the
// shared-dev-DB specs in client/tests/, which must sample a large,
// slow-changing dataset, this DB is fully known and rebuilt from scratch
// every run, so assertions here can be exact rather than best-effort.
const API_URL = "http://localhost:3050";

async function token(request: import("@playwright/test").APIRequestContext): Promise<string> {
  const res = await request.post(`${API_URL}/api/auth/login`, {
    data: { email: "matthew@backbet.co.uk", password: "beyer" },
  });
  return (await res.json()).token as string;
}

test.describe("Seeded CSV slice (2026-06-03, GB only)", () => {
  test("courses endpoint returns exactly the 4 seeded GB meetings", async ({ request }) => {
    const t = await token(request);
    const res = await request.get(`${API_URL}/api/industry-sp/courses`, {
      headers: { Authorization: `Bearer ${t}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(new Set(body.data)).toEqual(new Set(["Newton Abbot", "Nottingham", "Ripon", "Warwick"]));
  });

  test("race 919979 (Nottingham) is exactly the imported CSV race", async ({ request }) => {
    const t = await token(request);
    const res = await request.get(`${API_URL}/api/industry-sp/race/919979`, {
      headers: { Authorization: `Bearer ${t}` },
    });
    expect(res.status()).toBe(200);
    const { data } = await res.json();
    expect(data.course).toBe("Nottingham");
    expect(data.ran).toBe(12);
    expect(data.runners).toHaveLength(12);

    const winner = data.runners.find((r: { status: string }) => r.status === "WINNER");
    expect(winner).toBeTruthy();
    expect(winner.name).toBe("The Ginger Kid (IRE)");
    expect(winner.jockey).toBe("Kieran Shoemark");
    expect(winner.trainer).toBe("Ed Walker");
    expect(winner.ispFraction).toBe("20/1");
  });
});
