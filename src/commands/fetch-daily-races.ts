#!/usr/bin/env ts-node

// Pulls today's racecards from RacingAPI's /v1/racecards/free (the only
// endpoint this account's Free plan can reach — see
// src/lib/service/racing-api-client.ts) and upserts them into the
// daily_racecards collection. Manual/on-demand entry point; the same
// DailyRaceService.ingestFromRacingApi() logic also runs on a schedule via
// apps/lambda/src/handler.ts's EventBridge branch — see
// .claude/commands/daily-races-cron.md.
//
// Usage:
//   MONGODB_URI=... MONGODB_DB_NAME=... npx ts-node src/commands/fetch-daily-races.ts

import { DatabaseConnection } from "../config/database";
import { DailyRaceService } from "../lib/service/daily-race-service";

async function run(): Promise<void> {
  const dbConnection = DatabaseConnection.getInstance();
  await dbConnection.connect();

  const result = await new DailyRaceService().ingestFromRacingApi();
  console.log(`Upserted ${result.racesUpserted} daily racecards, skipped ${result.nonGbSkipped} non-GB races.`);

  await dbConnection.disconnect();
}

run().catch(error => {
  console.error("fetch-daily-races failed:", error);
  process.exit(1);
});
