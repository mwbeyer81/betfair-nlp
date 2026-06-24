import { test, expect } from "@playwright/test";

const API = "https://fd0xrhcmj0.execute-api.eu-north-1.amazonaws.com";

async function getToken(request: any): Promise<string> {
  const res = await request.post(`${API}/api/auth/login`, {
    data: { username: "matthew", password: "beyer" },
  });
  const body = await res.json();
  return body.token as string;
}

test.describe("API middleware (live Lambda)", () => {
  test("GET /api/stats with JWT auth returns 200 and success:true", async ({ request }) => {
    const token = await getToken(request);
    const res = await request.get(`${API}/api/stats`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  test("GET /api/stats without auth returns 401", async ({ request }) => {
    const res = await request.get(`${API}/api/stats`);
    expect(res.status()).toBe(401);
  });

  test("OPTIONS /api/stats passes through (CORS preflight)", async ({ request }) => {
    const res = await request.fetch(`${API}/api/stats`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://app.backbet.co.uk",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "Authorization",
      },
    });
    // cors() responds with 204 for preflights
    expect(res.status()).toBe(204);
  });

  test("response includes Access-Control-Allow-Origin header", async ({ request }) => {
    const token = await getToken(request);
    const res = await request.get(`${API}/api/stats`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: "https://app.backbet.co.uk",
      },
    });
    expect(res.headers()["access-control-allow-origin"]).toBeTruthy();
  });

  test("GET /health returns 200 with status OK", async ({ request }) => {
    const token = await getToken(request);
    const res = await request.get(`${API}/health`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("OK");
  });
});
