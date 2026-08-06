import { test, expect } from "@playwright/test";

// Verifies the hardcoded test user (seeded directly into the throwaway CI
// DB by scripts/seed-local-ci-user.ts) actually works end-to-end against a
// freshly started backend — not just that the seed script ran without
// throwing.
// Same reasoning as LOCAL_CI_APP_URL above: overridable so concurrent
// worktrees can claim their own backend port (LOCAL_CI_BACKEND_PORT).
const API_URL = process.env.LOCAL_CI_API_URL ?? "http://localhost:3050";
const EMAIL = "matthew@backbet.co.uk";
const PASSWORD = "beyer";

test.describe("Hardcoded test user (throwaway CI DB)", () => {
  test("POST /api/auth/login succeeds with the seeded email/password", async ({ request }) => {
    const res = await request.post(`${API_URL}/api/auth/login`, {
      data: { email: EMAIL, password: PASSWORD },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(typeof body.token).toBe("string");
    expect(body.emailVerified).toBe(true);
  });

  test("wrong password is rejected", async ({ request }) => {
    const res = await request.post(`${API_URL}/api/auth/login`, {
      data: { email: EMAIL, password: "wrong-password" },
    });
    expect(res.status()).toBe(401);
  });

  test("GET /api/auth/me reports the seeded, already-verified account", async ({ request }) => {
    const loginRes = await request.post(`${API_URL}/api/auth/login`, {
      data: { email: EMAIL, password: PASSWORD },
    });
    const { token } = await loginRes.json();
    const res = await request.get(`${API_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.email).toBe(EMAIL);
    expect(body.emailVerified).toBe(true);
  });
});
