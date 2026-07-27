import { Collection, Db } from "mongodb";

export interface DailyRaceRunnerDoc {
  runnerId: string;
  horse: string;
  age: string | null;
  sex: string | null;
  sexCode: string | null;
  colour: string | null;
  region: string | null;
  dam: string | null;
  damId: string | null;
  sire: string | null;
  sireId: string | null;
  damsire: string | null;
  damsireId: string | null;
  trainer: string | null;
  trainerId: string | null;
  owner: string | null;
  ownerId: string | null;
  number: string | null;
  draw: string | null;
  headgear: string | null;
  lbs: string | null;
  officialRating: string | null;
  jockey: string | null;
  jockeyId: string | null;
  lastRun: string | null;
  form: string | null;
}

export interface DailyRaceDoc {
  _id: string;
  raceId: string;
  eventId: string;
  course: string;
  date: string;
  offTime: string;
  offDt: string;
  raceName: string;
  distanceF: string | null;
  region: string | null;
  raceClass: string | null;
  type: string | null;
  ageBand: string | null;
  prize: string | null;
  fieldSize: string | null;
  going: string | null;
  surface: string | null;
  runners: DailyRaceRunnerDoc[];
  ingestedAt: string;
}

// RacingAPI's /v1/racecards/free has no explicit meeting/event object — each
// racecard is flat, tagged only with course + date. Mirrors the
// meetingId concept IndustrySpDAO already uses (course+date grouping).
export function deriveDailyRaceEventId(course: string, date: string): string {
  const slug = course
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug}-${date}`;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

// Shared by both the live ingestion command (src/commands/fetch-daily-races.ts)
// and the test fixture seeder (src/commands/seed-daily-races-fixture.ts) so
// the RacingAPI snake_case -> our camelCase mapping can't drift between the
// two paths.
export function mapRacecardToDoc(racecard: Record<string, unknown>): DailyRaceDoc {
  const course = String(racecard.course ?? "");
  const date = String(racecard.date ?? "");
  const rawRunners = Array.isArray(racecard.runners) ? (racecard.runners as Record<string, unknown>[]) : [];

  const runners: DailyRaceRunnerDoc[] = rawRunners.map(r => ({
    runnerId: String(r.horse_id ?? ""),
    horse: String(r.horse ?? ""),
    age: str(r.age),
    sex: str(r.sex),
    sexCode: str(r.sex_code),
    colour: str(r.colour),
    region: str(r.region),
    dam: str(r.dam),
    damId: str(r.dam_id),
    sire: str(r.sire),
    sireId: str(r.sire_id),
    damsire: str(r.damsire),
    damsireId: str(r.damsire_id),
    trainer: str(r.trainer),
    trainerId: str(r.trainer_id),
    owner: str(r.owner),
    ownerId: str(r.owner_id),
    number: str(r.number),
    draw: str(r.draw),
    headgear: str(r.headgear),
    lbs: str(r.lbs),
    officialRating: str(r.ofr),
    jockey: str(r.jockey),
    jockeyId: str(r.jockey_id),
    lastRun: str(r.last_run),
    form: str(r.form),
  }));

  const raceId = String(racecard.race_id ?? "");
  return {
    _id: raceId,
    raceId,
    eventId: deriveDailyRaceEventId(course, date),
    course,
    date,
    offTime: String(racecard.off_time ?? ""),
    offDt: String(racecard.off_dt ?? ""),
    raceName: String(racecard.race_name ?? ""),
    distanceF: str(racecard.distance_f),
    region: str(racecard.region),
    raceClass: str(racecard.race_class),
    type: str(racecard.type),
    ageBand: str(racecard.age_band),
    prize: str(racecard.prize),
    fieldSize: str(racecard.field_size),
    going: str(racecard.going),
    surface: str(racecard.surface),
    runners,
    ingestedAt: new Date().toISOString(),
  };
}

export class DailyRaceDAO {
  private collection: Collection<DailyRaceDoc>;

  constructor(db: Db, collectionName = "daily_racecards") {
    this.collection = db.collection<DailyRaceDoc>(collectionName);
  }

  public async createIndexes(): Promise<void> {
    const specs: [Record<string, unknown>, Record<string, unknown>?][] = [
      [{ date: 1 }],
      [{ eventId: 1 }],
      [{ course: 1 }],
      [{ offDt: 1 }],
    ];
    for (const [keys, opts] of specs) {
      try {
        await this.collection.createIndex(keys as any, opts as any);
      } catch (err) {
        console.warn(`createIndex failed for ${JSON.stringify(keys)} (non-fatal):`, err);
      }
    }
    console.log("Daily race indexes ensured");
  }

  /** All races on a given date ("YYYY-MM-DD"), sorted by off time. */
  public async getRacesByDate(date: string): Promise<DailyRaceDoc[]> {
    return this.collection.find({ date }).sort({ offDt: 1 }).toArray();
  }

  /** All races sharing one eventId (one course's card on one date). */
  public async getRacesByEventId(eventId: string): Promise<DailyRaceDoc[]> {
    return this.collection.find({ eventId }).sort({ offDt: 1 }).toArray();
  }

  /** A single race by its RacingAPI race_id (string — not numeric). */
  public async getRaceById(raceId: string): Promise<DailyRaceDoc | null> {
    return this.collection.findOne({ _id: raceId });
  }

  /** Upserts a batch of racecards by _id — shared by the CLI ingestion
   * command and the scheduled Lambda ingest so both paths write identically. */
  public async bulkUpsertRaces(docs: DailyRaceDoc[]): Promise<void> {
    if (docs.length === 0) return;
    const ops = docs.map(doc => ({
      replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true },
    }));
    await this.collection.bulkWrite(ops, { ordered: false });
  }
}
