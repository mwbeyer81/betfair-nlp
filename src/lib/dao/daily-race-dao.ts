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
  // Basic-plan-only fields (null on Free-tier ingests). Display-only —
  // rpr/ts are the horse's CURRENT published rating for this race, not a
  // trailing average of prior runs, so they must never be fed into the
  // model as horseAvgRPR/horseAvgTS (that's what
  // daily-race-feature-service.ts computes from real prior-race history).
  rpr: string | null;
  ts: string | null;
  spotlight: string | null;
  comment: string | null;
  trainer14Days: { runs: string; wins: string; percent: string } | null;
  trainerRtf: string | null;
  // Computed by daily-race-feature-service.ts, read-only against the real
  // historical industry_starting_prices collection — mirrors the exact
  // field names/semantics precompute-trainer-form.ts/precompute-jockey-form.ts/
  // precompute-horse-form.ts write onto historical runners, so
  // ml/predict_daily_races.py's feature dataframe is a direct pass-through.
  // Null until computed (e.g. right after ingestion, before the feature
  // step has run).
  trainerFormRuns: number | null;
  trainerFormWins: number | null;
  trainerFormWinRate: number | null;
  trainerFormStaked: number | null;
  trainerFormReturns: number | null;
  jockeyFormRuns: number | null;
  jockeyFormWins: number | null;
  jockeyFormWinRate: number | null;
  jockeyFormStaked: number | null;
  jockeyFormReturns: number | null;
  daysSinceLastRun: number | null;
  horseCareerRuns: number | null;
  horseCareerWinRate: number | null;
  horseAvgRPR: number | null;
  horseAvgTS: number | null;
  horseAvgBeatenDistance: number | null;
  horseAvgExcuseScore: number | null;
  horseTroubleInRunningRate: number | null;
  horseTravelledWellRate: number | null;
  featuresComputedAt: string | null;
  // Written by ml/predict_daily_races.py.
  modelWinProbability: number | null;
  modelVersionId: string | null;
  // Top 3 plain-language "why this %" factors, from apps/ml-api/handler.py's
  // topFactors (XGBoost's native SHAP contributions restricted to numeric
  // features) — see ml/train_and_predict.py's FEATURE_EXPLANATIONS.
  modelTopFactors: { label: string; direction: "positive" | "negative" }[] | null;
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

// RacingAPI's trainer_14_days defaults to {} (not null/absent) when there's
// no data — treated the same as null here rather than an object of empty
// strings, so callers can use a single `!= null` check.
function trainer14Days(value: unknown): { runs: string; wins: string; percent: string } | null {
  if (typeof value !== "object" || value === null) return null;
  const obj = value as Record<string, unknown>;
  const runs = str(obj.runs);
  const wins = str(obj.wins);
  const percent = str(obj.percent);
  if (runs === null && wins === null && percent === null) return null;
  return { runs: runs ?? "", wins: wins ?? "", percent: percent ?? "" };
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
    rpr: str(r.rpr),
    ts: str(r.ts),
    spotlight: str(r.spotlight),
    comment: str(r.comment),
    trainer14Days: trainer14Days(r.trainer_14_days),
    trainerRtf: str(r.trainer_rtf),
    // Computed by a later step (daily-race-feature-service.ts /
    // ml/predict_daily_races.py), never known at ingest time. Re-ingesting
    // an already-enriched race (bulkUpsertRaces replaces the whole doc)
    // wipes these back to null, same gotcha as import-industry-sp.ts
    // wiping precomputed fields on reseed — re-run the feature/predict
    // steps after any re-ingest.
    trainerFormRuns: null,
    trainerFormWins: null,
    trainerFormWinRate: null,
    trainerFormStaked: null,
    trainerFormReturns: null,
    jockeyFormRuns: null,
    jockeyFormWins: null,
    jockeyFormWinRate: null,
    jockeyFormStaked: null,
    jockeyFormReturns: null,
    daysSinceLastRun: null,
    horseCareerRuns: null,
    horseCareerWinRate: null,
    horseAvgRPR: null,
    horseAvgTS: null,
    horseAvgBeatenDistance: null,
    horseAvgExcuseScore: null,
    horseTroubleInRunningRate: null,
    horseTravelledWellRate: null,
    featuresComputedAt: null,
    modelWinProbability: null,
    modelVersionId: null,
    modelTopFactors: null,
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
