/* eslint-disable no-console */
// One-off cleanup: DailyRaceService.ingestFromRacingApi now filters non-GB
// racecards at ingest time (Daily Races is a UK-only feature — see the
// 2026-07-29 AGENTS.md entry), but bulkUpsertRaces never deletes, so the
// 55 non-GB races ingested before that fix (22 IRE/Galway, 33 FR across
// Clairefontaine/Mont-De-Marsan/Compiegne/Vittel) are still sitting in
// prod daily_racecards. Removes them once. User-confirmed before running.
//
// Run: NODE_CONFIG_DIR=./config npx ts-node scripts/cleanup-daily-races-non-gb-2026-07-29.ts
import { MongoClient } from "mongodb";
import config from "config";

async function main() {
  const uri = config.get<string>("mongodb.uri");
  const dbName = config.get<string>("mongodb.dbName");
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);
  const col = db.collection("daily_racecards");

  const before = await col.countDocuments({ region: { $ne: "GB" } });
  console.log(`Deleting ${before} non-GB daily_racecards docs...`);
  const result = await col.deleteMany({ region: { $ne: "GB" } });
  console.log(`Deleted ${result.deletedCount}.`);

  const remaining = await col.countDocuments({ region: { $ne: "GB" } });
  const remainingGb = await col.countDocuments({ region: "GB" });
  console.log(`Remaining non-GB: ${remaining}, remaining GB: ${remainingGb}`);

  await client.close();
}
main().catch(e => {
  console.error(e);
  process.exit(1);
});
