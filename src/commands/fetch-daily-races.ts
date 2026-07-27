#!/usr/bin/env ts-node

// Pulls today's racecards from RacingAPI's /v1/racecards/free (the only
// endpoint this account's Free plan can reach — see
// src/lib/service/racing-api-client.ts) and upserts them into the
// daily_racecards collection. Manual/on-demand, same as every other
// src/commands/ script — no cron/scheduling infra exists in this repo.
//
// Usage:
//   MONGODB_URI=... MONGODB_DB_NAME=... npx ts-node src/commands/fetch-daily-races.ts

import { DatabaseConnection } from "../config/database";
import { RacingApiClient } from "../lib/service/racing-api-client";
import { mapRacecardToDoc, DailyRaceDoc } from "../lib/dao/daily-race-dao";

const COLLECTION_NAME = "daily_racecards";

async function run(): Promise<void> {
  const client = new RacingApiClient();
  if (!client.hasCredentials()) {
    console.error("RacingAPI credentials not configured — set racingApi.username/password (config/local.json).");
    process.exit(1);
  }

  const res = await client.get<{ racecards: Record<string, unknown>[] }>("/racecards/free");
  if (!res.ok) {
    console.error(`RacingAPI returned ${res.status}:`, res.body);
    process.exit(1);
  }

  const docs = (res.body.racecards || []).map(mapRacecardToDoc);
  console.log(`Fetched ${docs.length} racecards from RacingAPI.`);

  const dbConnection = DatabaseConnection.getInstance();
  await dbConnection.connect();
  const db = dbConnection.getDb();
  const collection = db.collection<DailyRaceDoc>(COLLECTION_NAME);

  if (docs.length > 0) {
    const ops = docs.map(doc => ({
      replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true },
    }));
    await collection.bulkWrite(ops, { ordered: false });
  }
  console.log(`Upserted ${docs.length} daily racecards into ${COLLECTION_NAME}.`);

  await dbConnection.disconnect();
}

run().catch(error => {
  console.error("fetch-daily-races failed:", error);
  process.exit(1);
});
