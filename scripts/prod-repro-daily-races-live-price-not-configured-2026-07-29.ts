#!/usr/bin/env ts-node

// One-off diagnostic: user reported (2026-07-29) that
// https://app.backbet.co.uk/daily-races?minModelWinProbability=20 shows no
// live Betfair price next to "Bet" for any pick, and expected there to be
// one. Checks the REAL deployed production API directly (not localhost,
// not a mock) with a real login and today's real qualifying picks, to tell
// apart "a real bug in the live-price feature" from "the live Lambda
// simply has no Betfair credentials configured" (the documented,
// expected-for-now state — see AGENTS.md's daily-races-live-price entry:
// every deploy this feature has gone through logged "Skipping secrets
// update (config/local.json not found)").
//
// READ-ONLY: only calls GET /api/daily-races and POST /api/daily-races/
// live-prices, both of which are pure reads on the production side too
// (live-price-service.ts never calls placeOrders) — running this cannot
// place a bet or change any state.
//
// Run: npx ts-node scripts/prod-repro-daily-races-live-price-not-configured-2026-07-29.ts

const API_URL = "https://fd0xrhcmj0.execute-api.eu-north-1.amazonaws.com";
const MIN_MODEL_WIN_PROBABILITY = 20; // matches the reported URL's own ?minModelWinProbability=20

interface DailyRaceRunner {
  runnerId: string;
  horse: string;
  modelWinProbability: number | null;
}
interface DailyRace {
  course: string;
  offDt: string;
  runners: DailyRaceRunner[];
}
interface LivePriceResult {
  price: number | null;
  note?: string;
}

async function login(): Promise<string> {
  const res = await fetch(`${API_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "matthew@backbet.co.uk", password: "beyer" }),
  });
  const body = (await res.json()) as { token?: string; error?: string };
  if (!body.token) throw new Error(`Login failed: ${body.error ?? res.status}`);
  return body.token;
}

async function main(): Promise<void> {
  console.log(`Logging into the real deployed API (${API_URL}) as matthew@backbet.co.uk...`);
  const token = await login();
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  console.log("Fetching today's real Daily Races from production...");
  const racesRes = await fetch(`${API_URL}/api/daily-races`, { headers });
  const racesBody = (await racesRes.json()) as { success: boolean; data: DailyRace[] };
  if (!racesBody.success) throw new Error("GET /api/daily-races failed");

  const picks: { runnerId: string; horse: string; course: string; offDt: string }[] = [];
  for (const race of racesBody.data) {
    for (const runner of race.runners) {
      if (runner.modelWinProbability != null && runner.modelWinProbability >= MIN_MODEL_WIN_PROBABILITY) {
        picks.push({ runnerId: runner.runnerId, horse: runner.horse, course: race.course, offDt: race.offDt });
      }
    }
  }
  console.log(`Reproducing the exact reported URL's filter (minModelWinProbability=${MIN_MODEL_WIN_PROBABILITY}): ${picks.length} qualifying picks found.`);
  if (picks.length === 0) {
    console.log("No qualifying picks right now — nothing to check live prices for. Try again once today's picks are non-empty.");
    return;
  }

  console.log("\nCalling the real deployed POST /api/daily-races/live-prices with these real picks...");
  const pricesRes = await fetch(`${API_URL}/api/daily-races/live-prices`, {
    method: "POST",
    headers,
    body: JSON.stringify({ picks }),
  });
  const pricesBody = (await pricesRes.json()) as { success: boolean; data: Record<string, LivePriceResult> };
  if (!pricesBody.success) throw new Error("POST /api/daily-races/live-prices failed");

  let withPrice = 0;
  let notConfigured = 0;
  let otherReason = 0;
  for (const pick of picks) {
    const result = pricesBody.data[pick.runnerId];
    if (result?.price != null) {
      withPrice++;
      console.log(`  ✓ ${pick.horse}: ${result.price.toFixed(2)}`);
    } else if (result?.note === "Live prices aren't configured yet.") {
      notConfigured++;
    } else {
      otherReason++;
      console.log(`  · ${pick.horse}: ${result?.note ?? "no result"}`);
    }
  }

  console.log(`\n${picks.length} picks checked: ${withPrice} with a real live price, ${notConfigured} "not configured", ${otherReason} other reason.`);

  if (withPrice === 0 && notConfigured === picks.length) {
    console.log(
      "\nROOT CAUSE CONFIRMED: this is NOT a bug in the live-price feature — every single pick came back\n" +
        "with the exact 'not configured' note, which live-price-service.ts only ever returns when\n" +
        "BetfairApiClient.hasCredentials() is false. The deployed Lambda genuinely has no\n" +
        "betfair.appKey/sessionId (or username+password) configured at all right now — this is the\n" +
        "documented, expected state every deploy of this feature has logged\n" +
        "('Skipping secrets update (config/local.json not found)', see AGENTS.md).\n\n" +
        "To actually fix this (show real prices), real Betfair credentials need to be added to\n" +
        "config/local.json in the deploy worktree (~/betfair-nlp-deploy-develop) before the next\n" +
        "apps/lambda/build.sh run, or set directly as Lambda environment variables\n" +
        "(BETFAIR_APP_KEY/BETFAIR_SESSION_ID or BETFAIR_USERNAME/BETFAIR_PASSWORD) — this is a\n" +
        "deliberate credentials decision, not something to do silently."
    );
  } else if (withPrice > 0) {
    console.log("\nCredentials ARE configured and at least one real price came back — if the UI still shows none, the bug is likely in the frontend, not this API.");
  } else {
    console.log("\nCredentials appear to be configured (not the 'not configured' note) but no prices resolved for another reason — see the per-pick notes above.");
  }
}

main().catch(error => {
  console.error("prod-repro-daily-races-live-price-not-configured failed:", error);
  process.exit(1);
});
