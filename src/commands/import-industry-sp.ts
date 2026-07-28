#!/usr/bin/env ts-node

// After running this import (or any reseed), re-run
// `yarn precompute:trainer-form` — this script's replaceOne-per-race upsert
// replaces each race document wholesale, which wipes any trainerForm*
// fields a prior precompute run had written onto `runners`.

import { createReadStream } from "fs";
import { parse } from "csv-parse";
import { DatabaseConnection } from "../config/database";
import { parseIsp } from "../lib/dao/parse-isp";
import { deriveCountryCode } from "../lib/dao/course-country";
import {
  RaceDoc,
  RunnerDoc,
  deriveStatus,
  synthRunnerId,
  toNullableInt,
  toNullableFloat,
  toNullableRating,
  parseWeightPounds,
  formatMeetingName,
} from "../lib/dao/industry-sp-row-mapping";

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
        age: toNullableInt(row.age),
        sex: row.sex || undefined,
        wgt: parseWeightPounds(row.wgt),
        hg: row.hg || undefined,
        officialRating: toNullableRating(row.or),
        pattern: row.pattern || undefined,
        rpr: toNullableRating(row.rpr),
        ts: toNullableRating(row.ts),
        beatenDistance: toNullableFloat(row.ovr_btn),
        comment: (row.comment || "").trim() || null,
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
