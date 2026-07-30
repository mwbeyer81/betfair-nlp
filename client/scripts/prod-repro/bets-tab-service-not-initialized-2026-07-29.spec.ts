import { test, expect } from "@playwright/test";

// One-off prod repro — see .claude/commands/prod-repro-scripts.md. User
// report: "Go to bets tab. See failed to load error." Confirmed against
// the real deployed app.
//
// ROOT CAUSE FOUND (see AGENTS.md's bets-tab-load-fix entry): NOT specific
// to the Bets tab or GET /api/bet-orders — `initializeServices()` in
// router.ts used to swallow any error from the DB-connect/service-
// construction block in a bare `catch { console.error(...) }` with no
// rethrow. A single TRANSIENT failure (e.g. a Mongo connection blip on
// Lambda cold start) left every service (betOrderService, authService,
// etc.) permanently `null` for that Lambda execution environment's entire
// remaining lifetime — apps/lambda/src/handler.ts only ever called
// initializeServices() once, at module load, and cached the (silently
// "succeeded") promise. Every subsequent request routed to that same warm
// container then got a real `{"success":false,"error":"Service not
// initialized"}` 503 from every route's own defensive null-check, until
// AWS eventually recycled the container (unpredictable — could be minutes
// or hours). This would affect ANY route on an affected container, not
// just bet-orders; Bets happened to be the one the user hit it on.
//
// FIXED: router.ts now rethrows instead of swallowing, and tracks a
// `servicesReady` flag; apps/lambda/src/handler.ts's new
// ensureServicesReady() retries initializeServices() for the current
// request if a prior attempt didn't leave services ready, instead of
// trusting a stale failed attempt forever.
//
// This spec can't reliably force a fresh cold start against the real
// deployed app on demand — it directly reproduced the exact bug live this
// session by capturing the real 503 body (`{"success":false,"error":
// "Service not initialized"}`) via a diagnostic run when a request
// happened to land on an affected container; see AGENTS.md for that raw
// evidence. What this spec verifies instead, deterministically: the Bets
// tab loads real data end to end against the real deployed app right now
// (proving the ordinary path still works), and documents the exact 503
// shape to watch for if this class of bug ever recurs. The actual
// regression-proof for the fix itself is the mocked jest test in
// src/server/__tests__/app.test.ts ("initializeServices — transient
// failure recovery"), which can force the transient-failure/retry
// scenario deterministically — something this real, live spec fundamentally can't.

test("Bets tab loads real bet-order data end to end on the real deployed app", async ({ page }) => {
  test.skip(!process.env.PROD_REPRO_PASSWORD, "Set PROD_REPRO_PASSWORD (matthewbeyer@hotmail.com's real password) to run this — never hardcoded here.");

  const failedResponses: string[] = [];
  page.on("response", res => {
    if (res.status() >= 500) failedResponses.push(`${res.status()} ${res.url()}`);
  });

  await page.goto(`/bets?email=${encodeURIComponent("matthewbeyer@hotmail.com")}&password=${encodeURIComponent(process.env.PROD_REPRO_PASSWORD!)}`);

  await expect(page.getByTestId("scheduled-bets-screen")).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("scheduled-bets-loading")).not.toBeVisible({ timeout: 15000 });

  const errorVisible = await page.getByTestId("scheduled-bets-error").isVisible().catch(() => false);
  if (errorVisible) {
    const errorText = await page.getByTestId("scheduled-bets-error").textContent();
    console.log(`Bets tab shows an error: "${errorText}". 5xx responses seen: ${failedResponses.join(", ") || "none"}.`);
    console.log("If this is 'Failed to fetch scheduled bets' with a real 503 body of "
      + '{"success":false,"error":"Service not initialized"} this is the bug this file documents — '
      + "see AGENTS.md's bets-tab-load-fix entry. It should self-resolve on retry (a fresh request), "
      + "since the fix makes the Lambda retry initialization instead of staying stuck.");
  }

  // The real, expected state once initializeServices() has actually
  // succeeded for this container: the list renders, no error shown.
  await expect(page.getByTestId("scheduled-bets-error")).not.toBeVisible();
  await expect(page.getByTestId("scheduled-bets-list")).toBeVisible();
});
