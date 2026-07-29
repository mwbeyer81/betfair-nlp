import { test, expect } from "@playwright/test";

// One-off prod repro/verification — see .claude/commands/prod-repro-scripts.md.
// Per the user's explicit request ("create prod ./scripts playwright test
// to actually make an instant 1 pound bet") after reporting the live
// "Bet now" flow "wasn't working". Drives the REAL "Bet now" flow through
// the REAL UI on the REAL deployed app (app.backbet.co.uk), as the real
// allow-listed account (see AGENTS.md's live-betting-safety /
// config-boolean-fix entries) — this is not mocked at any layer.
//
// COST NOTE, unlike every other prod-repro/live-verify script in this
// repo: this one is NOT free to re-run for no reason. Every run attempts
// one real (currently-rejected, but genuinely attempted) order against the
// real Betfair account, capped at £1 by MAX_LIVE_STAKE_GBP
// (bet-order-service.ts). Re-run deliberately, not as part of any loop.
//
// CURRENT KNOWN STATE (2026-07-29, fully diagnosed — see AGENTS.md): the
// account's only Betfair application key is the free "Delay" tier, which
// Betfair does not authorize for real order placement. Every real attempt
// currently comes back status:"error", note starting with "Betfair
// rejected this order at the account level" (see bet-order-service.ts's
// humanizeBetfairError ERROR_IN_ORDER mapping). This is NOT a bug in this
// codebase — the full pipeline (login -> real market resolution -> real
// price check -> real placeOrders call reaching Betfair) is confirmed
// working; only Betfair's own account-level authorization is missing.
//
// TO RE-VERIFY AFTER OBTAINING A LIVE APPLICATION KEY: once
// config/local.json's betfair.appKey is updated to a paid Live key (not
// delayAppKey) and the Lambda secrets are redeployed, change the
// expectation below from the ERROR_IN_ORDER case to the real success case
// (status "Triggered", condition text starting with "Backed now at").
//
// Credentials via env vars only — never hardcoded, this file is committed:
//   PROD_REPRO_EMAIL=matthewbeyer@hotmail.com PROD_REPRO_PASSWORD=... \
//     npx playwright test --config playwright.prod-repro.config.ts scripts/prod-repro/instant-bet-real-placement-2026-07-29.spec.ts

const EMAIL = process.env.PROD_REPRO_EMAIL;
const PASSWORD = process.env.PROD_REPRO_PASSWORD;

test("REPRO/VERIFY (2026-07-29): a real instant £1 bet, placed through the real UI on the real deployed app", async ({ page }) => {
  // Trying several real picks in turn (see the retry loop below) can
  // legitimately take a while against real, live-changing racing data —
  // the default 60s is too tight for that, not a sign of something hung.
  test.setTimeout(180000);
  test.skip(!EMAIL || !PASSWORD, "Set PROD_REPRO_EMAIL/PROD_REPRO_PASSWORD (the real allow-listed account) to run this — never hardcoded here.");

  // Same URL-param auto-login technique as client/tests/bet-orders-e2e.spec.ts,
  // pointed at the real deployed app instead of a local dev server.
  await page.goto(`/daily-races?email=${encodeURIComponent(EMAIL!)}&password=${encodeURIComponent(PASSWORD!)}`);
  await expect(page.getByTestId("daily-races-screen")).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("daily-races-loading")).not.toBeVisible({ timeout: 30000 });

  // 0% threshold — as permissive as this filter gets, to maximize the
  // chance today's real data has at least one qualifying pick to bet on.
  await page.getByTestId("daily-races-min-model-win-probability").fill("0");
  await page.getByTestId("daily-races-filter-apply").click();

  const noPicksToday = await page.getByTestId("daily-races-picks-empty").isVisible().catch(() => false);
  test.skip(noPicksToday, "No Daily Races picks qualify today on the real deployed app — nothing to bet on right now.");

  const betBadges = page.locator('[data-testid^="daily-races-pick-bet-"]');
  await expect(betBadges.first()).toBeVisible({ timeout: 10000 });
  // Today's real data can have hundreds of runners with a Bet badge —
  // capped so this test has a predictable upper bound on wall-clock time
  // and real attempts, not because more picks wouldn't also be valid.
  const attemptCount = Math.min(await betBadges.count(), 15);

  // Real racing data changes underneath us between page load and the
  // moment this test actually submits — a pick that was upcoming when the
  // list loaded can go off-time (or in-play) by the time we get to it,
  // which is a genuine pre-flight INSTANT_BET_REJECTED, not the
  // account-level issue this test exists to verify. Try picks in order
  // until one gets far enough to reach Betfair for real (dialog closes),
  // rather than failing on the first unlucky timing collision.
  let dialogClosed = false;
  let lastInlineError: string | null = null;
  for (let i = 0; i < attemptCount; i++) {
    await betBadges.nth(i).click();
    await expect(page.getByTestId("place-bet-dialog")).toBeVisible();

    // Toggle to "Bet now" (instant) — the whole point of this test, as
    // opposed to the existing scheduled-flow e2e coverage.
    await page.getByTestId("place-bet-dialog-order-type-instant").click();
    // £0.20 target profit / £1 max stake -> minQualifyingPrice £1.20, low
    // enough to qualify against almost any real market price, while
    // staying at MAX_LIVE_STAKE_GBP's exact cap.
    await page.getByTestId("place-bet-dialog-target-profit-input").fill("0.20");
    await page.getByTestId("place-bet-dialog-max-stake-input").fill("1");
    await expect(page.getByTestId("place-bet-dialog-confirm")).toHaveText("Place Bet Now");
    await page.getByTestId("place-bet-dialog-confirm").click();

    // Instant placement resolves synchronously — either the dialog closes
    // (persisted, success or a real-attempt error, see My Bets below) or
    // an inline pre-flight rejection (INSTANT_BET_REJECTED — price/market
    // couldn't even be checked) shows in the dialog itself, never both.
    // Racing against both outcomes rather than waiting on one then
    // checking the other, since either can legitimately take a moment.
    dialogClosed = await Promise.race([
      page.getByTestId("place-bet-dialog").waitFor({ state: "hidden", timeout: 20000 }).then(() => true),
      page.getByTestId("place-bet-dialog-error").waitFor({ state: "visible", timeout: 20000 }).then(() => false),
    ]).catch(() => false);
    if (dialogClosed) break;

    lastInlineError = await page.getByTestId("place-bet-dialog-error").textContent().catch(() => null);
    console.log(`Pick ${i + 1}/${attemptCount} pre-flight rejected (${lastInlineError}) — trying the next one.`);
    await page.getByTestId("place-bet-dialog-cancel").click();
    await expect(page.getByTestId("place-bet-dialog")).not.toBeVisible();
  }
  if (!dialogClosed) {
    throw new Error(`All ${attemptCount} picks tried were pre-flight rejected before reaching Betfair at all — last error: ${lastInlineError}`);
  }

  await page.getByTestId("daily-races-menu-bets-link").click();
  await expect(page.getByTestId("scheduled-bets-screen")).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("scheduled-bets-loading")).not.toBeVisible({ timeout: 15000 });

  // Newest-first list — the instant bet just placed is the first item.
  const firstItem = page.locator('[data-testid^="scheduled-bet-item-"]').first();
  await expect(firstItem).toBeVisible({ timeout: 10000 });
  const status = await firstItem.locator('[data-testid^="scheduled-bet-status-"]').textContent();

  console.log(`Real instant bet result — status: "${status}"`);

  // CURRENT expected state (see header comment) — a genuine account-level
  // rejection, proving the pipeline reaches Betfair for real. If Betfair
  // ever actually places the bet (status "Triggered"), that means a Live
  // application key is now configured — update this expectation to match,
  // don't just widen it to accept both silently.
  await expect(firstItem.locator('[data-testid^="scheduled-bet-note-"]')).toContainText("Betfair rejected this order at the account level");
  expect(status).toBe("Error");
});
