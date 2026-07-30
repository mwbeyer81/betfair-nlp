#!/usr/bin/env ts-node

// Pulls today's finished race results from RacingAPI's /v1/results/today
// (the only results endpoint this account's Basic plan can reach — see
// src/lib/service/industry-sp-results-capture-service.ts) and upserts them
// into industry_starting_prices. Manual/on-demand entry point; the same
// IndustrySpResultsCaptureService.captureTodayResults() logic also runs on
// a schedule via apps/lambda/src/handler.ts's "capture-results" EventBridge
// branch — see .claude/commands/industry-sp-results-cron.md.
//
// Usage:
//   MONGODB_URI=... MONGODB_DB_NAME=... npx ts-node src/commands/capture-industry-sp-results.ts

import { DatabaseConnection } from "../config/database";
import { IndustrySpResultsCaptureService } from "../lib/service/industry-sp-results-capture-service";

async function run(): Promise<void> {
  const dbConnection = DatabaseConnection.getInstance();
  await dbConnection.connect();

  const result = await new IndustrySpResultsCaptureService().captureTodayResults();
  console.log(
    `Captured ${result.racesUpserted} GB races (${result.runnersUpserted} runners), ` +
      `skipped ${result.nonGbSkipped} non-GB races.`
  );

  await dbConnection.disconnect();
}

run().catch(error => {
  console.error("capture-industry-sp-results failed:", error);
  process.exit(1);
});
