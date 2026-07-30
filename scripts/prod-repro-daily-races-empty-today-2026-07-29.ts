/* eslint-disable no-console */
// One-off diagnostic: user reported (screenshot, 2026-07-29) the BackBet
// "Daily Races" page showing "0 events, 0 races" / "No races found for
// today" against the real deployed app. Checks the REAL production
// daily_racecards collection directly (config/local.json), bypassing
// HTTP/auth, for exactly what's stored on today's UTC date vs the
// following day, to tell apart "cron actually failed" from "the app is
// just looking at a date with no data yet" (e.g. a bad Prev/Next Day
// default or the user having navigated forward).
//
// Run: NODE_CONFIG_DIR=./config npx ts-node scripts/prod-repro-daily-races-empty-today-2026-07-29.ts
import { MongoClient } from "mongodb";
import config from "config";
import { DailyRaceDAO } from "../src/lib/dao/daily-race-dao";

function todayUtcDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

function shiftDateString(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const uri = config.get<string>("mongodb.uri");
  const dbName = config.get<string>("mongodb.dbName");
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);
  const dao = new DailyRaceDAO(db);

  const today = todayUtcDateString();
  const yesterday = shiftDateString(today, -1);
  const tomorrow = shiftDateString(today, 1);

  for (const date of [yesterday, today, tomorrow]) {
    const races = await dao.getRacesByDate(date);
    console.log(`date=${date} -> ${races.length} races`);
    if (races.length > 0) {
      console.log(`  sample eventId=${races[0].eventId} course=${races[0].course} offDt=${races[0].offDt}`);
    }
  }

  await client.close();
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
