import { createHash } from "crypto";

// Shared `industry_starting_prices` document shape + row-normalization
// helpers, used by every writer of this collection: the CSV importer
// (src/commands/import-industry-sp.ts) and the RacingAPI daily-results
// capture (src/lib/service/industry-sp-results-capture-service.ts). Kept in
// one place so the two sources can never silently drift on what counts as
// e.g. a "WINNER" or a null rating — see precompute-trainer-form.ts's own
// separate RunnerDoc/FormCategory copy for what that drift risk looks like
// when it isn't centralized.

export type RunnerStatus = "WINNER" | "PLACED" | "LOSER" | "NON_FINISHER";

export interface RunnerDoc {
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
  // Pre-race-known fields (safe as direct model inputs — they describe the
  // entry, not the outcome).
  age: number | null;
  sex?: string;
  wgt: number | null;
  hg?: string;
  officialRating: number | null;
  pattern?: string;
  // Post-race result fields — NEVER feed the current race's own rpr/ts/
  // beatenDistance/comment into the model as a feature (that's the outcome
  // leaking into the input). Only safe to use as raw material for a horse's
  // *trailing* average/rate from its prior runs (see precompute-horse-form.ts,
  // which also turns `comment`'s free text into structured trailing signals
  // via src/lib/dao/comment-lexicon.ts).
  rpr: number | null;
  ts: number | null;
  beatenDistance: number | null;
  comment: string | null;
  // Pre-race XGBoost win-probability + the training run that produced it —
  // absent on every CSV-imported historical runner (that pipeline never
  // scores runners itself). Only the RacingAPI results-capture path sets
  // these, joined in from the same day's `daily_racecards` prediction (see
  // industry-sp-results-capture-service.ts) — copied across, never
  // recomputed here, so a live-captured runner's modelWinProbability always
  // matches exactly what the pre-race Daily Races screen showed for it.
  modelWinProbability?: number | null;
  modelVersionId?: string | null;
}

export interface RaceDoc {
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
  // runnersWithIspCount above.
  raceStaked: number;
  raceReturns: number;
}

export function deriveStatus(pos: string): RunnerStatus {
  const trimmed = (pos || "").trim();
  if (trimmed === "1") return "WINNER";
  if (trimmed === "2" || trimmed === "3") return "PLACED";
  if (/^\d+$/.test(trimmed)) return "LOSER";
  return "NON_FINISHER";
}

// sha1-truncate-to-48-bit-uint — used wherever a source has no numeric id of
// its own (the CSV has no runner id; RacingAPI's race/horse ids are
// strings). Collision risk against other numeric _ids in the collection is
// accepted silently today (48-bit space vs. a few million existing ids) —
// documented here rather than solved, same acceptance this function already
// implied before being named/shared.
export function synthNumericId(seed: string): number {
  const hash = createHash("sha1").update(seed).digest();
  return hash.readUIntBE(0, 6);
}

export function synthRunnerId(raceId: string, horse: string): number {
  return synthNumericId(`${raceId}:${horse}`);
}

export function synthRaceId(raceId: string): number {
  return synthNumericId(raceId);
}

export function toNullableInt(raw: string | undefined): number | null {
  const trimmed = (raw || "").trim();
  if (!trimmed) return null;
  const n = parseInt(trimmed, 10);
  return Number.isNaN(n) ? null : n;
}

export function toNullableFloat(raw: string | undefined): number | null {
  const trimmed = (raw || "").trim();
  if (!trimmed) return null;
  const n = parseFloat(trimmed);
  return Number.isNaN(n) ? null : n;
}

// "or"/"rpr"/"ts" use "–" (en dash) rather than an empty string for "not
// applicable" (e.g. no official rating yet) — toNullableInt already returns
// null for it via the failed parseInt, but this makes that intent explicit.
export function toNullableRating(raw: string | undefined): number | null {
  const trimmed = (raw || "").trim();
  if (!trimmed || trimmed === "–" || trimmed === "-") return null;
  return toNullableInt(trimmed);
}

// "11-12" (11 stone 12 lb) -> 166 total pounds. Returns null on any other
// shape. CSV-only need — RacingAPI's results already give pounds directly
// (`weight_lbs`), so its importer doesn't call this.
export function parseWeightPounds(raw: string | undefined): number | null {
  const m = (raw || "").trim().match(/^(\d+)-(\d+)$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 14 + parseInt(m[2], 10);
}

export function formatMeetingName(course: string, raceDate: string): string {
  const d = new Date(`${raceDate}T00:00:00Z`);
  const day = d.getUTCDate();
  const month = d.toLocaleString("en-GB", { month: "long", timeZone: "UTC" });
  const year = d.getUTCFullYear();
  return `${course} — ${day} ${month} ${year}`;
}
