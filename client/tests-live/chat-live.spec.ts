import { test, expect, APIResponse } from "@playwright/test";
import jwt from "jsonwebtoken";

// Persistent regression guard for the codebase-search chat feature against
// the real deployed Lambda + real OpenAI API. Two real production bugs have
// hit this feature so far, both invisible to every other test in this repo
// because they all mock the chat service (CodebaseSearchService) entirely:
//
// 1. The Lambda's OPENAI_API_KEY had never actually been configured (only
//    ever the config/default.json placeholder) — every message failed with
//    a 500 whose error text ("Incorrect API key provided...") the frontend
//    prefixes with "Error: " and renders as an ordinary chat bubble, so it
//    LOOKS like a normal (if unhelpful) reply rather than an obvious crash.
// 2. codebase-search-service.ts's forced final answer (once the 8-round
//    tool-call cap is hit) called the OpenAI API with `tool_choice: "none"`
//    but no `tools` — OpenAI rejects that combination with a 400
//    ("'tool_choice' is only allowed when 'tools' are specified"), which
//    again surfaces as an "Error: ..." chat bubble, not an obvious failure.
//
// Both bugs share a shape: a backend/API error masquerading as a normal-
// looking chat reply. `expectHealthyReply` below is the general defense —
// every test in this file should route its response through it.
//
// Needs a real JWT_SECRET (the same one configured on the `hello-api`
// Lambda) at run time — never hardcoded here. Mints its own token rather
// than logging in with real user credentials, since this suite shouldn't
// depend on knowing (or guessing at) anyone's real account password.
//
//   JWT_SECRET=<the real secret> npx playwright test --config playwright.live.config.ts tests-live/chat-live.spec.ts

const API = "https://fd0xrhcmj0.execute-api.eu-north-1.amazonaws.com";

// Substrings that should never appear in a genuine chat reply — each one is
// a known signature of a backend/OpenAI-API error leaking through as if it
// were conversational text (see the two bugs documented above).
const ERROR_SIGNATURES = [
  "incorrect api key",
  "tool_choice",
  "invalid value for",
  "internal server error",
  "failed to process",
  " 401",
  " 400",
  " 429",
  " 500",
];

async function expectHealthyReply(res: APIResponse, minLength = 20) {
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.success).toBe(true);
  expect(typeof body.reply).toBe("string");
  expect(body.reply.length).toBeGreaterThan(minLength);
  const lower = body.reply.toLowerCase();
  for (const signature of ERROR_SIGNATURES) {
    expect(lower).not.toContain(signature);
  }
  return body;
}

function getToken(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      "JWT_SECRET env var is required to run chat-live.spec.ts (the same secret configured on the hello-api Lambda) — not hardcoded here since it's a real credential."
    );
  }
  return jwt.sign({ sub: "chat-live-smoke-test" }, secret, { expiresIn: "10m" });
}

function query(body: { query: string; history?: Array<{ role: "user" | "assistant"; text: string }> }, request: any) {
  return request.post(`${API}/api/query`, {
    headers: { Authorization: `Bearer ${getToken()}` },
    data: body,
    timeout: 60000,
  });
}

test.describe("Chat (live Lambda + live OpenAI)", () => {
  test("answers a general question about the app with a real, grounded reply", async ({ request }) => {
    const res = await query({ query: "What does this app do?" }, request);
    await expectHealthyReply(res);
  });

  test("answers a follow-up using conversation history", async ({ request }) => {
    const res = await query(
      {
        query: "How does it work?",
        history: [
          { role: "user", text: "What does this app do?" },
          { role: "assistant", text: "This app tracks horse races and analyzes data using MongoDB." },
        ],
      },
      request
    );
    await expectHealthyReply(res);
  });

  test("answers a direct question about the database structure", async ({ request }) => {
    const res = await query({ query: "What's the structure of the database?" }, request);
    await expectHealthyReply(res);
  });

  test("answers a direct question about feature engineering", async ({ request }) => {
    const res = await query({ query: "How were the features engineered?" }, request);
    await expectHealthyReply(res);
  });

  test("replicates the reported repro: model-training discussion, then 'Give example feature' follow-up", async ({
    request,
  }) => {
    // The exact conversation shape from the live bug report screenshot —
    // a multi-turn discussion about the model/features ending in a short,
    // open-ended follow-up. This is the scenario that actually hit the
    // 8-round tool-call cap in production and tripped bug #2 above.
    const res = await query(
      {
        query: "Give example feature",
        history: [
          { role: "user", text: "How is the win-probability model trained?" },
          {
            role: "assistant",
            text: "The model is trained using gradient-boosted trees on historical race data, then the model can be used to predict outcomes for new races based on the latest data. If you want to know more about any specific part of this process, like how features are engineered or how the model is trained, just let me know!",
          },
        ],
      },
      request
    );
    await expectHealthyReply(res);
  });

  test("handles a broad, multi-part question likely to need several tool calls in a row", async ({ request }) => {
    // Not a deterministic reproduction of the 8-round iteration cap (that's
    // an internal implementation constant, and real model tool-calling
    // behavior isn't fully predictable) — but a genuinely broad question
    // spanning several files is the closest practical way to exercise a
    // long tool-calling chain against the real API. The unit test in
    // codebase-search-service.test.ts is the deterministic guard for the
    // exact tool_choice/tools contract; this is the live-world companion.
    const res = await query(
      {
        query:
          "Walk me through, in plain English, everything that happens to a horse's data from being stored in the database, through trainer form being calculated, all the way to how it factors into the win-probability model's training.",
      },
      request
    );
    await expectHealthyReply(res, 40);
  });

  test("gently redirects an off-topic question instead of erroring", async ({ request }) => {
    const res = await query({ query: "What's the capital of France?" }, request);
    await expectHealthyReply(res);
  });

  test("rejects an unauthenticated request", async ({ request }) => {
    const res = await request.post(`${API}/api/query`, {
      data: { query: "What does this app do?" },
    });
    expect(res.status()).toBe(401);
  });
});
