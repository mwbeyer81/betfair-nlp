import { test, expect } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";

// Full, fully-automated round trip against the real production API and a
// real (if disposable) inbox — no human needs to check anything. Confirms
// the entire pipeline in one shot: signup -> Resend actually delivers a
// real email -> the verify link in that email actually works -> the
// account's server-side state actually flips to verified.
//
// Uses a @mailinator.com address specifically because it's a public,
// no-signup-required test inbox with its own read API (mailinator.com/
// api/v2/domains/public/...) — unlike the seeded test account or a
// throwaway @example.com-style address, this lets the test read the
// *actual delivered email content* (not just "the API accepted it")
// without needing any credentials of its own. Safe to run repeatedly:
// each run uses a fresh timestamped address, so there's no collision
// risk with real users and no cleanup burden beyond a disposable inbox.
const API_URL = "https://fd0xrhcmj0.execute-api.eu-north-1.amazonaws.com";
const MAILINATOR_API = "https://www.mailinator.com/api/v2/domains/public";

async function waitForMailinatorMessage(
  request: APIRequestContext,
  inboxName: string,
  timeoutMs = 45000
): Promise<{ id: string; subject: string; origfrom?: string; fromfull?: string }> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await request.get(`${MAILINATOR_API}/inboxes/${inboxName}`);
      const body = await res.json();
      if (body.msgs && body.msgs.length > 0) {
        return body.msgs[0];
      }
    } catch {
      // Mailinator's public API occasionally returns an empty/non-JSON
      // body (rate limiting, transient hiccup) — just retry rather than
      // fail the whole poll on one bad response.
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`No message arrived in Mailinator inbox "${inboxName}" within ${timeoutMs}ms`);
}

test.describe("Email verification — live end-to-end (real Resend delivery)", () => {
  test("signup sends a real, deliverable verification email with a working verify link", async ({ request }) => {
    const inboxName = `backbet-e2e-${Date.now()}`;
    const email = `${inboxName}@mailinator.com`;

    const signupRes = await request.post(`${API_URL}/api/auth/signup`, {
      data: { email, password: "test-password-123" },
    });
    expect(signupRes.status()).toBe(201);
    const { token, emailVerified } = await signupRes.json();
    expect(emailVerified).toBe(false);

    const message = await waitForMailinatorMessage(request, inboxName);
    expect(message.subject).toBe("Verify your BackBet email");
    expect(message.origfrom ?? message.fromfull ?? "").toContain("backbet.co.uk");

    const detailRes = await request.get(`${MAILINATOR_API}/messages/${message.id}`);
    const detailText = await detailRes.text();
    const tokenMatch = detailText.match(/token=([a-f0-9]{20,})/);
    expect(tokenMatch).not.toBeNull();
    const verifyToken = tokenMatch![1];

    const verifyRes = await request.get(`${API_URL}/api/auth/verify?token=${verifyToken}`);
    expect(verifyRes.status()).toBe(200);
    const verifyHtml = await verifyRes.text();
    expect(verifyHtml).toContain("Email verified");
    expect(verifyHtml).toContain(email);

    const meRes = await request.get(`${API_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(meRes.status()).toBe(200);
    const me = await meRes.json();
    expect(me.emailVerified).toBe(true);
  });
});
