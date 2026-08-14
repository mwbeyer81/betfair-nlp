#!/usr/bin/env ts-node

// Writes a numeric `distanceFurlongs` onto every race document in
// industry_starting_prices.
//
// Must be re-run after every import-industry-sp.ts (re)seed, for the same
// reason precompute-trainer-form.ts / -jockey-form.ts / -horse-form.ts must:
// that script's replaceOne-per-race upsert replaces each race document
// wholesale, so any derived field written here is silently wiped by it.
//
// WHY THIS EXISTS
// ---------------
// `distance` is stored as the source CSV's display string — "5f", "1m",
// "1m2½f", "2m4½f" — and there is no numeric form of it anywhere in the
// collection. ml/train_and_predict.py's parse_distance_furlongs() converts it
// in Python at training time, which is fine there and useless to a query.
//
// The Filters screen's distance filter needs to compare numbers, and doing that
// per query would mean a $regexFind plus arithmetic over the whole collection on
// every request. That half-furlong glyph in particular is fiddly enough
// (a full-width "½", not "1/2") that parsing it once, here, is both faster and
// far less likely to drift from the Python than a second implementation written
// in aggregation operators would be.
//
// Cost: one double per race document — 110,226 races, on the order of 2 MB.
//
// Verified against production on 2026-08-14: `distance` is 100% populated and
// EVERY distinct value in the collection matches the grammar below, so the
// unparseable branch is genuinely unreachable today. It is still handled (and
// counted, and reported) rather than assumed away, because the next reseed can
// introduce a format this has never seen and a silent null would then look
// exactly like a race that simply has no distance.

import { AnyBulkWriteOperation } from "mongodb";
import { DatabaseConnection } from "../config/database";

const COLLECTION_NAME = "industry_starting_prices";

// Only the two fields this script reads or writes. `_id` is a synthetic NUMBER
// (industry-sp-row-mapping.ts's synthRaceId), not an ObjectId, so the collection
// has to be typed explicitly — the driver's default Document assumes ObjectId
// and would reject the bulkWrite filter below.
interface RaceDistanceDoc {
  _id: number;
  distance?: string | null;
  distanceFurlongs?: number | null;
}
const BATCH_SIZE = 1000;

// Mirrors ml/train_and_predict.py's _DISTANCE_RE. Both parts are optional
// because "1m" (no furlongs) and "5f" (no miles) are both common, and the
// half-furlong can appear with or without a preceding digit — "1m½f" is a real
// value in the collection, meaning eight and a half furlongs.
const DISTANCE_RE = /^(?:(\d+)m)?(?:(\d*)(½)?f)?$/;

/**
 * "5f" -> 5, "1m3f" -> 11, "2m4½f" -> 20.5, "1m" -> 8, "1m½f" -> 8.5.
 * Returns null for anything unparseable or empty.
 *
 * Kept exported so the unit tests can exercise the table of real formats
 * directly rather than through a database round trip.
 */
export function parseDistanceFurlongs(distance: string | null | undefined): number | null {
  if (!distance) return null;
  const m = DISTANCE_RE.exec(distance.trim());
  if (!m) return null;
  const [, miles, furlongs, half] = m;
  // All three groups absent means the regex matched the empty string, which it
  // will, since every part is optional. That is not a zero-furlong race.
  if (!miles && !furlongs && !half) return null;
  return (miles ? parseInt(miles, 10) * 8 : 0)
    + (furlongs ? parseInt(furlongs, 10) : 0)
    + (half ? 0.5 : 0);
}

async function run(): Promise<void> {
  const dbConnection = DatabaseConnection.getInstance();
  await dbConnection.connect();
  const db = dbConnection.getDb();
  const collection = db.collection<RaceDistanceDoc>(COLLECTION_NAME);

  const total = await collection.estimatedDocumentCount();
  console.log(`Computing distanceFurlongs for ~${total} races in ${COLLECTION_NAME}`);

  const cursor = collection.find({}, { projection: { _id: 1, distance: 1 } });
  let batch: AnyBulkWriteOperation<RaceDistanceDoc>[] = [];
  let processed = 0;
  let parsed = 0;
  const unparseable = new Map<string, number>();

  const flush = async (): Promise<void> => {
    if (batch.length === 0) return;
    await collection.bulkWrite(batch, { ordered: false });
    batch = [];
  };

  for await (const race of cursor) {
    const raw = race.distance ?? null;
    const furlongs = parseDistanceFurlongs(raw);
    if (furlongs != null) parsed++;
    else if (raw) unparseable.set(raw, (unparseable.get(raw) ?? 0) + 1);

    batch.push({
      updateOne: {
        filter: { _id: race._id },
        // Written even when null, so "this race's distance could not be parsed"
        // is a recorded fact rather than an absent field indistinguishable from
        // "this precompute has not run yet".
        update: { $set: { distanceFurlongs: furlongs } },
      },
    });
    processed++;
    if (batch.length >= BATCH_SIZE) {
      await flush();
      console.log(`  ${processed}/${total}`);
    }
  }
  await flush();

  console.log(`Done. ${processed} races, ${parsed} parsed (${((100 * parsed) / (processed || 1)).toFixed(2)}%).`);
  if (unparseable.size > 0) {
    console.warn(`${unparseable.size} distinct unparseable distance format(s) — these races have distanceFurlongs: null and will not match any distance filter:`);
    for (const [value, count] of [...unparseable.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
      console.warn(`  ${JSON.stringify(value)} x${count}`);
    }
  }
  await dbConnection.disconnect();
}

if (require.main === module) {
  run().catch(error => {
    console.error("distanceFurlongs precompute failed:", error);
    process.exit(1);
  });
}
