#!/usr/bin/env ts-node

// Inserts one saved_filter_set_live_results doc tied to a real saved filter
// set, pointing at the seeded CSV slice's own anchor race (raceId 919979,
// Nottingham, 2026-06-03 — same race isp-seed-smoke.spec.ts/saved-results-ui.spec.ts
// already rely on) — used by tests-local-ci/live-performance-return-nav.spec.ts
// to exercise the real Live Performance → meeting → back flow against real
// backend/DB, without needing the daily results-capture cron to have run.
//
// Only needs a savedFilterSetId (created moments earlier via the real Save
// button in the test itself) — everything else here is a fixed, known-good
// fixture value. Idempotent (upsert), safe to re-run.
//
// Usage:
//   MONGODB_URI=... MONGODB_DB_NAME=... npx ts-node src/commands/seed-live-filter-result-fixture.ts <savedFilterSetId>

import { ObjectId } from "mongodb";
import { DatabaseConnection } from "../config/database";
import { LiveFilterResultDAO } from "../lib/dao/live-filter-result-dao";

async function run(): Promise<void> {
  const savedFilterSetId = process.argv[2];
  if (!savedFilterSetId || !ObjectId.isValid(savedFilterSetId)) {
    throw new Error("Usage: seed-live-filter-result-fixture.ts <savedFilterSetId> (must be a valid ObjectId hex string)");
  }

  const dbConnection = DatabaseConnection.getInstance();
  await dbConnection.connect();
  const db = dbConnection.getDb();
  const dao = new LiveFilterResultDAO(db);
  await dao.createIndexes();

  await dao.upsertMany([
    {
      savedFilterSetId: new ObjectId(savedFilterSetId),
      filters: { courses: "Nottingham" },
      modelVersionId: "local-ci-fixture-model",
      raceDate: "2026-06-03",
      raceId: 919979,
      raceTime: "2026-06-03T14:00:00",
      raceName: "Local CI Fixture Race",
      meetingId: "Nottingham|2026-06-03",
      meetingName: "Nottingham — 3 June 2026",
      pnlStats: { staked: 1, returns: 2, pnl: 1, count: 1 },
      capturedAt: new Date().toISOString(),
    },
  ]);

  console.log(`Seeded 1 live-filter-result fixture row for savedFilterSetId=${savedFilterSetId}.`);
  await dbConnection.disconnect();
}

run().catch(error => {
  console.error("seed-live-filter-result-fixture failed:", error);
  process.exit(1);
});
