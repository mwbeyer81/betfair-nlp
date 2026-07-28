import config from "config";
import { Db } from "mongodb";
import { DatabaseConnection } from "../../config/database";
import { RacingApiClient } from "./racing-api-client";
import { parseIsp } from "../dao/parse-isp";
import {
  RaceDoc,
  RunnerDoc,
  deriveStatus,
  synthNumericId,
  synthRaceId,
  toNullableInt,
  toNullableFloat,
  toNullableRating,
  formatMeetingName,
} from "../dao/industry-sp-row-mapping";

const COLLECTION_NAME = "industry_starting_prices";
const BATCH_SIZE = 1000;

function readConfigString(key: string): string {
  try {
    const value = config.get<string>(key);
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

// Raw shapes as returned by RacingAPI's /results/today (Basic plan,
// live-verified field-for-field during this feature's planning session —
// NOT a guess). Only the fields this mapper actually uses are declared;
// the real response has more (owner/sire/dam/silk_url/etc.) that aren't
// needed here.
interface RawResultsResponse {
  results?: RawRace[];
}

interface RawRace {
  race_id?: string;
  date?: string;
  region?: string;
  course?: string;
  off?: string;
  race_name?: string;
  type?: string;
  class?: string;
  going?: string;
  dist?: string;
  runners?: RawRunner[];
}

interface RawRunner {
  horse_id?: string;
  horse?: string;
  sp?: string;
  number?: string;
  position?: string;
  draw?: string;
  ovr_btn?: string;
  age?: string;
  sex?: string;
  weight_lbs?: string;
  headgear?: string;
  or?: string;
  rpr?: string;
  // Note: RacingAPI names this "tsr", not "ts" (the CSV column name) —
  // maps onto RunnerDoc.ts below.
  tsr?: string;
  comment?: string;
  jockey?: string;
  trainer?: string;
}

function mapRunner(raw: RawRunner, raceId: string, idx: number): RunnerDoc {
  const { odds, isFavourite, fraction } = parseIsp(raw.sp);
  const num = toNullableInt(raw.number);
  return {
    id: synthNumericId(`${raceId}:${raw.horse_id || raw.horse || idx}`),
    name: raw.horse || "",
    num,
    draw: toNullableInt(raw.draw),
    pos: (raw.position || "").trim(),
    status: deriveStatus(raw.position || ""),
    sortPriority: num ?? idx,
    isp: odds,
    ispFraction: fraction,
    isFavourite,
    jockey: raw.jockey || undefined,
    trainer: raw.trainer || undefined,
    age: toNullableInt(raw.age),
    sex: raw.sex || undefined,
    // RacingAPI gives pounds directly — more precise than the CSV path's
    // "11-12" stone-lb string parsing, and there's no equivalent string to
    // parse here anyway.
    wgt: toNullableInt(raw.weight_lbs),
    hg: raw.headgear || undefined,
    officialRating: toNullableRating(raw.or),
    pattern: undefined,
    rpr: toNullableRating(raw.rpr),
    ts: toNullableRating(raw.tsr),
    beatenDistance: toNullableFloat(raw.ovr_btn),
    comment: (raw.comment || "").trim() || null,
  };
}

function mapRace(raw: RawRace): RaceDoc | null {
  if (!raw.race_id || !raw.course || !raw.date) return null;
  const raceId = synthRaceId(raw.race_id);
  const course = raw.course;
  const raceDate = raw.date;
  const raceTime = `${raceDate}T${(raw.off || "00:00").padStart(5, "0")}:00`;

  const rawRunners = raw.runners || [];
  const runners: RunnerDoc[] = rawRunners.map((r, idx) => mapRunner(r, raw.race_id as string, idx));

  const validIspRunners = runners.filter(r => r.isp !== null && r.isp > 1);
  const raceStaked = validIspRunners.reduce((sum, r) => sum + 1 / (r.isp! - 1), 0);
  const raceReturns = validIspRunners.reduce(
    (sum, r) => sum + (r.status === "WINNER" ? 1 / (r.isp! - 1) + 1 : 0),
    0
  );

  return {
    _id: raceId,
    raceId,
    course,
    countryCode: "GB",
    raceDate,
    raceTime,
    raceName: raw.race_name || "",
    raceType: raw.type || "",
    raceClass: raw.class || null,
    going: raw.going || null,
    distance: raw.dist || null,
    // No explicit runner-count field on this response — the runners array
    // itself is the field count, same fallback import-industry-sp.ts uses
    // when its own `ran` column is missing/unparseable.
    ran: rawRunners.length,
    meetingId: `${course}|${raceDate}`,
    meetingName: formatMeetingName(course, raceDate),
    runners,
    runnersWithIspCount: validIspRunners.length,
    raceStaked,
    raceReturns,
  };
}

export interface CaptureTodayResultsResult {
  racesUpserted: number;
  runnersUpserted: number;
  nonGbSkipped: number;
}

export class IndustrySpResultsCaptureService {
  private db: Db;

  constructor(db?: Db) {
    this.db = db || DatabaseConnection.getInstance().getDb();
  }

  /** Pulls today's finished race results from RacingAPI and upserts them
   * into `industry_starting_prices` — real, resolved outcomes only (a
   * "results" feed never returns an unresolved race), so this never risks
   * the read-only-for-today's-races invariant
   * daily-race-feature-service.ts depends on; it's the intentional
   * complement to it. Shared by src/commands/capture-industry-sp-results.ts
   * (manual CLI run) and the scheduled Lambda capture (apps/lambda/src/
   * handler.ts's "capture-results" branch), same as ingestFromRacingApi's
   * racecards counterpart in daily-race-service.ts.
   *
   * `path` defaults to config `racingApi.resultsPath` (empty ->
   * "/results/today", the only results path confirmed reachable on the
   * account's current Basic plan — historical/dated results need a
   * Standard-tier upgrade, out of scope for this method). */
  public async captureTodayResults(
    client: RacingApiClient = new RacingApiClient(),
    path: string = readConfigString("racingApi.resultsPath") || "/results/today"
  ): Promise<CaptureTodayResultsResult> {
    if (!client.hasCredentials()) {
      throw new Error("RacingAPI credentials not configured (racingApi.username/password)");
    }
    const res = await client.get<RawResultsResponse>(path);
    if (!res.ok) {
      throw new Error(`RacingAPI returned ${res.status}: ${JSON.stringify(res.body)}`);
    }

    const rawRaces = res.body.results || [];
    let nonGbSkipped = 0;
    const docs: RaceDoc[] = [];
    for (const rawRace of rawRaces) {
      if (rawRace.region !== "GB") {
        nonGbSkipped++;
        continue;
      }
      const doc = mapRace(rawRace);
      if (doc) docs.push(doc);
    }

    const collection = this.db.collection<RaceDoc>(COLLECTION_NAME);
    let runnersUpserted = 0;
    for (let i = 0; i < docs.length; i += BATCH_SIZE) {
      const batch = docs.slice(i, i + BATCH_SIZE);
      await collection.bulkWrite(
        batch.map(doc => ({
          replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true },
        })),
        { ordered: false }
      );
      runnersUpserted += batch.reduce((sum, d) => sum + d.runners.length, 0);
    }

    return { racesUpserted: docs.length, runnersUpserted, nonGbSkipped };
  }
}
