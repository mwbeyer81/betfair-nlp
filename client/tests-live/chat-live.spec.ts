import { test, expect } from "@playwright/test";
import jwt from "jsonwebtoken";

// Persistent regression guard for the codebase-search chat feature against
// the real deployed Lambda + real OpenAI API. Added after a real production
// bug: the Lambda's OPENAI_API_KEY had never actually been configured (only
// ever the config/default.json placeholder), so every chat message silently
// 401'd from OpenAI — invisible to every other test in this repo since they
// all mock the chat service. This test would have caught that immediately.
//
// Needs a real JWT_SECRET (the same one configured on the `hello-api`
// Lambda) at run time — never hardcoded here. Mints its own token rather
// than logging in with real user credentials, since this suite shouldn't
// depend on knowing (or guessing at) anyone's real account password.
//
//   JWT_SECRET=<the real secret> npx playwright test --config playwright.live.config.ts tests-live/chat-live.spec.ts

const API = "https://fd0xrhcmj0.execute-api.eu-north-1.amazonaws.com";

function getToken(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      "JWT_SECRET env var is required to run chat-live.spec.ts (the same secret configured on the hello-api Lambda) — not hardcoded here since it's a real credential."
    );
  }
  return jwt.sign({ sub: "chat-live-smoke-test" }, secret, { expiresIn: "10m" });
}

test.describe("Chat (live Lambda + live OpenAI)", () => {
  test("answers a general question about the app with a real, grounded reply", async ({ request }) => {
    const res = await request.post(`${API}/api/query`, {
      headers: { Authorization: `Bearer ${getToken()}` },
      data: { query: "What does this app do?" },
    });

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(typeof body.reply).toBe("string");
    expect(body.reply.length).toBeGreaterThan(20);
    // The exact failure mode this test exists to catch: a misconfigured
    // OpenAI key surfaces as this literal error text inside a 200 response
    // (the chat service catches the OpenAI error and it flows through as
    // the "reply"), not as an HTTP-level failure.
    expect(body.reply.toLowerCase()).not.toContain("incorrect api key");
    expect(body.reply.toLowerCase()).not.toContain("401");
  });

  test("answers a follow-up using conversation history", async ({ request }) => {
    const res = await request.post(`${API}/api/query`, {
      headers: { Authorization: `Bearer ${getToken()}` },
      data: {
        query: "How does it work?",
        history: [
          { role: "user", text: "What does this app do?" },
          {
            role: "assistant",
            text: "This app tracks horse races and analyzes data using MongoDB.",
          },
        ],
      },
    });

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.reply.length).toBeGreaterThan(20);
    expect(body.reply.toLowerCase()).not.toContain("incorrect api key");
  });

  test("rejects an unauthenticated request", async ({ request }) => {
    const res = await request.post(`${API}/api/query`, {
      data: { query: "What does this app do?" },
    });
    expect(res.status()).toBe(401);
  });
});
