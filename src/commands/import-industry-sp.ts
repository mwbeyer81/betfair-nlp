#!/usr/bin/env ts-node

import { createReadStream } from "fs";
import { parse } from "csv-parse";
import { createHash } from "crypto";
import { DatabaseConnection } from "../config/database";
import { parseIsp } from "../lib/dao/parse-isp";
import { deriveCountryCode } from "../lib/dao/course-country";

const SOURCE_CSV =
  process.env.SOURCE_CSV ||
  "data/kaggle-horse-racing-uk-ireland/extracted/form_2015-present/form_2015-present/raceform.csv";
const FROM_DATE = process.env.FROM_DATE || "2015-01-01";
const TO_DATE = process.env.TO_DATE || "2026-05-27";
const DROP_FIRST = process.env.DROP_FIRST === "true";
const COLLECTION_NAME = "industry_starting_prices";
const BATCH_SIZE = 1000;

interface RawRow {
  [key: string]: string;
}

type RunnerStatus = "WINNER" | "PLACED" | "LOSER" | "NON_FINISHER";

interface RunnerDoc {
  id: number;
  name: string;
  num: number | null;
  draw: number | null;
  pos: string;
  status: RunnerStatus;
  sortPriority: number;
  isp: number | null;
  ispFraction: string | null;
  isFavourite: boolean;
  jockey?: string;
  trainer?: string;
}

interface RaceDoc {
  _id: number;
  raceId: number;
  course: string;
  countryCode: string;
  raceDate: string;
  raceTime: string;
  raceName: string;
  raceType: string;
  raceClass: string | null;
  going: string | null;
  distance: string | null;
  ran: number;
  meetingId: string;
  meetingName: string;
  runners: RunnerDoc[];
  // Precomputed count of runners with a valid, parseable ISP (isp > 1) —
  // this definition never depends on request-time filter params, so it's
  // stored once here instead of recomputed via $filter/$size on every
  // /api/industry-sp query. See industry-sp-dao.ts getAllRacesByRace.
  runnersWithIspCount: number;
  // Precomputed per-race staked/returns (same $1-stake-per-runner P&L model
  // as getPnlStats), over the same static isp>1 runner set as
  // runnersWithIspCount above. Lets the home page's pnlStats facet sum two
  // plain fields instead of re-fetching every matched race's full runners
  // array via $lookup + $unwind on every request — that $lookup was the
  // single largest cost in the whole /api/industry-sp query.
  raceStaked: number;
  raceReturns: number;
}

function deriveStatus(pos: string): RunnerStatus {
  const trimmed = (pos || "").trim();
  if (trimmed === "1") return "WINNER";
  if (trimmed === "2" || trimmed === "3") return "PLACED";
  if (/^\d+$/.test(trimmed)) return "LOSER";
  return "NON_FINISHER";
}

function synthRunnerId(raceId: string, horse: string): number {
  const hash = createHash("sha1").update(`${raceId}:${horse}`).digest();
  return hash.readUIntBE(0, 6);
}

function toNullableInt(raw: string | undefined): number | null {
  const trimmed = (raw || "").trim();
  if (!trimmed) return null;
  const n = parseInt(trimmed, 10);
  return Number.isNaN(n) ? null : n;
}

function formatMeetingName(course: string, raceDate: string): string {
  const d = new Date(`${raceDate}T00:00:00Z`);
  const day = d.getUTCDate();
  const month = d.toLocaleString("en-GB", { month: "long", timeZone: "UTC" });
  const year = d.getUTCFullYear();
  return `${course} — ${day} ${month} ${year}`;
}

async function run() {
  console.log(`Importing Industry SP from ${SOURCE_CSV}`);
  console.log(`Date window: ${FROM_DATE} to ${TO_DATE}`);

  const dbConnection = DatabaseConnection.getInstance();
  await dbConnection.connect();
  const db = dbConnection.getDb();
  const collection = db.collection<RaceDoc>(COLLECTION_NAME);

  if (DROP_FIRST) {
    console.log(`DROP_FIRST=true — dropping ${COLLECTION_NAME}`);
    await collection.drop().catch(() => {});
  }

  // Non-UK races are filtered out immediately (never buffered) rather than after a full
  // pass, since the full CSV history is ~1.85M rows and ~42% of races are outside the
  // BHA allowlist — buffering all of them first would nearly double peak memory for no
  // reason.
  const races = new Map<string, RawRow[]>();
  const nonUkRaceIds = new Set<string>();
  let rowsSeen = 0;
  let rowsInWindow = 0;
  let nonUkSkipped = 0;
  const nonUkCoursesSeen = new Set<string>();

  const parser = createReadStream(SOURCE_CSV).pipe(
    parse({ columns: true, skip_empty_lines: true, relax_column_count: true })
  );

  for await (const row of parser as AsyncIterable<RawRow>) {
    rowsSeen++;
    const date = row.date;
    if (!date || date < FROM_DATE || date > TO_DATE) continue;
    rowsInWindow++;
    const raceId = row.race_id;
    if (nonUkRaceIds.has(raceId)) continue;
    if (!races.has(raceId)) {
      const { course, countryCode } = deriveCountryCode(row.course);
      if (countryCode === null) {
        nonUkRaceIds.add(raceId);
        nonUkSkipped++;
        nonUkCoursesSeen.add(course);
        continue;
      }
      races.set(raceId, []);
    }
    races.get(raceId)!.push(row);
    if (rowsSeen % 200000 === 0) console.log(`  scanned ${rowsSeen} rows...`);
  }

  console.log(`Scanned ${rowsSeen} total rows, ${rowsInWindow} in window, ${races.size} distinct UK races`);
  console.log(
    `Skipped ${nonUkSkipped} non-UK races across ${nonUkCoursesSeen.size} courses` +
      (nonUkCoursesSeen.size > 0 ? `: ${[...nonUkCoursesSeen].sort().join(", ")}` : "")
  );

  const docs: RaceDoc[] = [];
  let nullIspCount = 0;
  let runnerCount = 0;

  for (const [raceIdStr, rows] of races) {
    const first = rows[0];
    const { course } = deriveCountryCode(first.course);
    const countryCode = "GB";
    const raceDate = first.date;
    const raceTime = `${first.date}T${(first.off || "00:00").padStart(5, "0")}:00`;
    const raceId = Number(raceIdStr);

    const runners: RunnerDoc[] = rows.map((row, idx) => {
      const { odds, isFavourite, fraction } = parseIsp(row.sp);
      if (odds === null) nullIspCount++;
      runnerCount++;
      const num = toNullableInt(row.num);
      return {
        id: synthRunnerId(raceIdStr, row.horse),
        name: row.horse,
        num,
        draw: toNullableInt(row.draw),
        pos: (row.pos || "").trim(),
        status: deriveStatus(row.pos),
        sortPriority: num ?? idx,
        isp: odds,
        ispFraction: fraction,
        isFavourite,
        jockey: row.jockey || undefined,
        trainer: row.trainer || undefined,
      };
    });

    // Same $1-stake-per-runner P&L model as getPnlStats / the DAO's on-the-fly
    // pnlStats fallback: stake = 1/(isp-1) per valid-isp runner, return = stake+1 on a win.
    const validIspRunners = runners.filter(r => r.isp !== null && r.isp > 1);
    const raceStaked = validIspRunners.reduce((sum, r) => sum + 1 / (r.isp! - 1), 0);
    const raceReturns = validIspRunners.reduce(
      (sum, r) => sum + (r.status === "WINNER" ? 1 / (r.isp! - 1) + 1 : 0),
      0
    );

    docs.push({
      _id: raceId,
      raceId,
      course,
      countryCode,
      raceDate,
      raceTime,
      raceName: first.race_name,
      raceType: first.type,
      raceClass: first.class || null,
      going: first.going || null,
      distance: first.dist || null,
      ran: toNullableInt(first.ran) ?? rows.length,
      meetingId: `${course}|${raceDate}`,
      meetingName: formatMeetingName(course, raceDate),
      runners,
      runnersWithIspCount: validIspRunners.length,
      raceStaked,
      raceReturns,
    });
  }

  console.log(`Built ${docs.length} race docs, ${runnerCount} runners, ${nullIspCount} with null ISP`);

  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = docs.slice(i, i + BATCH_SIZE);
    await collection.bulkWrite(
      batch.map(doc => ({
        replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true },
      })),
      { ordered: false }
    );
    console.log(`  upserted ${Math.min(i + BATCH_SIZE, docs.length)}/${docs.length}`);
  }

  await collection.createIndex({ raceTime: 1 });
  await collection.createIndex({ countryCode: 1 });
  await collection.createIndex({ runnersWithIspCount: 1 });

  if (docs.length > 0) {
    const minDate = docs.reduce((min, d) => (d.raceDate < min ? d.raceDate : min), docs[0].raceDate);
    const maxDate = docs.reduce((max, d) => (d.raceDate > max ? d.raceDate : max), docs[0].raceDate);
    console.log(`Done. Actual date range imported: ${minDate} to ${maxDate}`);
  } else {
    console.log("Done. No races found in the given window.");
  }

  await dbConnection.disconnect();
}

run().catch(error => {
  console.error("Import failed:", error);
  process.exit(1);
});
