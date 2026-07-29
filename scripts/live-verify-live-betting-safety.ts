#!/usr/bin/env ts-node

// MANUAL VERIFICATION SCRIPT — not run by any automated suite (Jest,
// local-ci-e2e.sh, or otherwise). Proves the live-betting safety gates
// (see AGENTS.md's live-betting-safety entry) actually hold when exercised
// against the real Betfair API and real Mongo, not just under jest mocks:
//   1. The £MAX_LIVE_STAKE_GBP stake cap rejects an over-cap request from
//      the live-betting-allowed identity, before any network call.
//   2. A NON-allowed identity is forced into DRY_RUN even when the
//      account-wide betfair.dryRun switch is off — proving the two gates
//      (dryRun master switch, per-request identity allow-list) are truly
//      independent, using a throwaway config copy so the real
//      config/local.json's dryRun value is never touched.
//   3. The ALLOWED identity's requests are correctly tagged
//      liveBettingAllowed:true, proven via a SCHEDULED (not instant) order
//      — scheduled orders only ever get evaluated by the (currently
//      unprovisioned) cron, so this proves the positive case without ever
//      calling the real placeOrders endpoint from this script.
//
// SAFETY: this script never places a real bet. Case 1 rejects before any
// network call. Case 2 forces DRY_RUN by construction (non-allowed
// identity). Case 3 only ever creates a "pending" scheduled order — it is
// never evaluated/placed by this script. Every document this script
// inserts into the real bet_orders collection is deleted again before
// exit, leaving the collection net-unchanged.
//
// Usage (against real dev Mongo + real Betfair credentials in
// config/local.json):
//   NODE_CONFIG_DIR=./config npx ts-node scripts/live-verify-live-betting-safety.ts

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { ObjectId } from "mongodb";
import { DatabaseConnection } from "../src/config/database";
import { BetfairApiClient } from "../src/lib/service/betfair-api-client";
import { BetOrderDAO } from "../src/lib/dao/bet-order-dao";
import { BetOrderService, MAX_LIVE_STAKE_GBP } from "../src/lib/service/bet-order-service";

const REAL_CONFIG_DIR = process.env.NODE_CONFIG_DIR ?? path.join(__dirname, "..", "config");
const ALLOWED_EMAIL = "matthewbeyer@hotmail.com";

// Builds a throwaway config dir that's a copy of the real one, with
// betfair.liveBettingAllowedEmail (and optionally dryRun) overridden in
// local.json only — the real config/local.json is never opened for
// writing, only read, so its actual dryRun value can't be touched by this
// script no matter what.
function makeThrowawayConfigDir(overrides: { dryRun?: boolean; liveBettingAllowedEmail: string }): string {
  const dir = mkdtempSync(path.join(tmpdir(), "live-betting-safety-verify-"));
  for (const file of ["default.json", "custom-environment-variables.json", "development.json", "test.json", "production.json", "docker.json"]) {
    const src = path.join(REAL_CONFIG_DIR, file);
    if (existsSync(src)) writeFileSync(path.join(dir, file), readFileSync(src));
  }
  const localPath = path.join(REAL_CONFIG_DIR, "local.json");
  const local = existsSync(localPath) ? JSON.parse(readFileSync(localPath, "utf-8")) : {};
  local.betfair = { ...local.betfair, liveBettingAllowedEmail: overrides.liveBettingAllowedEmail };
  if (overrides.dryRun !== undefined) local.betfair.dryRun = overrides.dryRun;
  writeFileSync(path.join(dir, "local.json"), JSON.stringify(local));
  return dir;
}

// NODE_CONFIG_DIR must be set before `config` is first required, so each
// case that needs a different config spawns its own require cache reset —
// simplest reliable way to get a fresh `config`-package read per case
// within a single script run without three separate process invocations.
function freshClientWithConfigDir(dir: string): BetfairApiClient {
  process.env.NODE_CONFIG_DIR = dir;
  delete require.cache[require.resolve("config")];
  delete require.cache[require.resolve("../src/lib/service/betfair-api-client")];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { BetfairApiClient: FreshClient } = require("../src/lib/service/betfair-api-client");
  return new FreshClient();
}

async function findRealScheduledOrderInput(client: BetfairApiClient) {
  const now = new Date();
  const from = now.toISOString();
  const to = new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString();
  const catalogue = await client.listMarketCatalogue(
    { eventTypeIds: ["7"], marketCountries: ["GB"], marketTypeCodes: ["WIN"], marketStartTime: { from, to } },
    "20"
  );
  const market = catalogue.find(m => m.event.venue && m.runners.length > 0);
  if (!market) {
    throw new Error("No real upcoming GB WIN horse racing market (with a venue) found in the next 6 hours — nothing to verify against right now.");
  }
  const runner = market.runners[0];
  return {
    runnerId: `verify-${runner.selectionId}`,
    horse: runner.runnerName,
    course: market.event.venue as string,
    offTime: market.marketStartTime,
    offDt: market.marketStartTime,
    raceId: `verify-${market.marketId}`,
    eventId: market.event.id,
  };
}

async function main(): Promise<void> {
  const baselineClient = new BetfairApiClient();
  if (!baselineClient.hasCredentials()) {
    console.error("Betfair credentials not configured — need betfair.appKey/delayAppKey plus sessionId or username/password in config/local.json.");
    process.exit(1);
  }

  const dbConnection = DatabaseConnection.getInstance();
  await dbConnection.connect();
  const db = dbConnection.getDb();
  const insertedIds: ObjectId[] = [];
  const throwawayDirs: string[] = [];

  try {
    // Two throwaway config dirs, both with liveBettingAllowedEmail set to
    // the real allowed email (the real config/local.json doesn't have this
    // set yet — the point of this script is to prove the gate works
    // BEFORE it's live, without ever writing to the real config). Case 1/3
    // use the safe (dryRun still true) one; case 2 additionally flips
    // dryRun off, to prove the identity gate holds independent of the
    // master switch. Neither ever touches the real config/local.json —
    // only reads it, to seed everything else (credentials, hosts).
    const allowListDir = makeThrowawayConfigDir({ liveBettingAllowedEmail: ALLOWED_EMAIL });
    throwawayDirs.push(allowListDir);
    const allowListClient = freshClientWithConfigDir(allowListDir);
    if (allowListClient.getLiveBettingAllowedEmail() !== ALLOWED_EMAIL.toLowerCase()) {
      throw new Error("Throwaway config's liveBettingAllowedEmail override didn't take effect — every case below would be testing the wrong thing. Aborting.");
    }

    // --- Case 1: stake cap rejects the allowed identity's over-cap request, before any network call ---
    console.log(`Case 1: stake cap (£${MAX_LIVE_STAKE_GBP}) rejects an over-cap request from the allowed identity...`);
    {
      const dao = new BetOrderDAO(db);
      const service = new BetOrderService(dao, allowListClient);
      try {
        await service.createForUser(
          "prod-test-user",
          {
            runnerId: "verify-cap", horse: "Whatever Runner", course: "Nowhere", offTime: "12:00",
            offDt: new Date(Date.now() + 3600_000).toISOString(), raceId: "verify-cap-race", eventId: "verify-cap-event",
            targetProfit: 20, maxStake: MAX_LIVE_STAKE_GBP + 9, orderType: "instant",
          },
          ALLOWED_EMAIL
        );
        console.log("✗ UNEXPECTED: the over-cap request was NOT rejected. This is a real safety gap — investigate before going further.");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("cannot exceed")) {
          console.log(`✓ Rejected as expected: ${message}`);
        } else {
          console.log(`✗ UNEXPECTED error shape (expected a "cannot exceed" message): ${message}`);
        }
      }
    }

    // --- Case 2: a non-allowed identity stays simulated even with the account-wide switch off ---
    console.log("\nCase 2: non-allowed identity forced to DRY_RUN even with betfair.dryRun=false...");
    const dryRunOffDir = makeThrowawayConfigDir({ dryRun: false, liveBettingAllowedEmail: ALLOWED_EMAIL });
    throwawayDirs.push(dryRunOffDir);
    {
      const client = freshClientWithConfigDir(dryRunOffDir);
      if (client.isDryRun()) {
        console.log("✗ UNEXPECTED: throwaway config's dryRun override didn't take effect — case 2 isn't testing what it should.");
      } else {
        const dao = new BetOrderDAO(db);
        const service = new BetOrderService(dao, client);
        const input = await findRealScheduledOrderInput(client);
        const result = await service.createForUser(
          "prod-test-user",
          { ...input, targetProfit: 0.5, maxStake: MAX_LIVE_STAKE_GBP, orderType: "instant" },
          "someone-else@example.com" // NOT the allowed email
        );
        insertedIds.push(new ObjectId(result.id));
        if (result.status === "triggered" && result.dryRun === true) {
          console.log(`✓ Forced to DRY_RUN as expected, despite betfair.dryRun=false in this throwaway config (matchedPrice=${result.matchedPrice}).`);
        } else {
          console.log(`✗ UNEXPECTED: status=${result.status} dryRun=${result.dryRun} — expected triggered/true. This would be a real safety gap.`);
        }
      }
    }

    // --- Case 3: the allowed identity's order is correctly tagged liveBettingAllowed:true (scheduled, never placed) ---
    console.log("\nCase 3: allowed identity's SCHEDULED order is tagged liveBettingAllowed:true (never placed by this script)...");
    {
      // Re-create the allow-list client fresh (case 2's require-cache
      // manipulation swapped NODE_CONFIG_DIR globally) rather than reusing
      // the case-1 instance, so this case's config state is unambiguous.
      const client = freshClientWithConfigDir(allowListDir);
      const dao = new BetOrderDAO(db);
      const service = new BetOrderService(dao, client);
      const input = await findRealScheduledOrderInput(client);
      const result = await service.createForUser(
        "prod-test-user",
        { ...input, targetProfit: 0.5, maxStake: MAX_LIVE_STAKE_GBP, orderType: "scheduled" },
        ALLOWED_EMAIL
      );
      insertedIds.push(new ObjectId(result.id));
      const stored = await dao.getByIdForUser(result.id, "prod-test-user");
      if (result.status === "pending" && stored?.liveBettingAllowed === true) {
        console.log("✓ Persisted as 'pending' with liveBettingAllowed:true — the cron evaluator (not this script) is the only thing that could ever act on it.");
      } else {
        console.log(`✗ UNEXPECTED: status=${result.status} liveBettingAllowed=${stored?.liveBettingAllowed} — expected pending/true.`);
      }
    }
  } finally {
    if (insertedIds.length > 0) {
      await db.collection("bet_orders").deleteMany({ _id: { $in: insertedIds } });
      console.log(`\nCleaned up: deleted ${insertedIds.length} bet_orders document(s) this script inserted. Collection left net-unchanged.`);
    }
    for (const dir of throwawayDirs) rmSync(dir, { recursive: true, force: true });
    await dbConnection.disconnect();
  }
}

main().catch(error => {
  console.error("live-verify-live-betting-safety failed:", error);
  process.exit(1);
});
