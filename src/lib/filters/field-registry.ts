// The catalogue of raw model fields the Filters screen can filter on.
//
// WHY THIS EXISTS
// ---------------
// Every filter on /isp before this file was hand-threaded through six places:
// client/src/utils/ispUrlParams.ts, IndustrySpScreen.tsx, three routes in
// src/server/router.ts, industry-sp-dao.ts, saved-filter-set-service.ts, and
// ispFormat.ts's runnerQualifies. That is fine for the ~15 filters that grew up
// one at a time; it does not survive 21 more added at once.
//
// So the fields live here once, and everything else reads them. Adding a field
// is a single entry below plus nothing else — the query params, the aggregation
// conditions, the picker UI and the saved-filter round-trip all derive from it.
//
// THE FIELD SET
// -------------
// These are exactly the columns ml/train_and_predict.py trains on (CAT_COLS +
// NUM_COLS), minus the six that already have their own filter on the screen
// (course/going/raceClass/raceType chip rows, trainer/jockey text filters).
// Keeping the list tied to what the model actually sees is the point: it lets
// you ask "where does the model do well" in the model's own vocabulary.
//
// COVERAGE IS PART OF THE CONTRACT
// --------------------------------
// Every `coverage` below is MEASURED against production (974,048 runners,
// 110,226 races, 2026-08-14), not estimated. It is displayed in the picker
// because several of these fields are sparse for STRUCTURAL reasons, and a
// filter on one silently drops a whole category of race:
//
//   draw            64.8%  Flat 99.9% / jumps 0.0% — jumps races have no stalls
//   officialRating  78.1%  handicaps 99.9% / maidens+novices 16.3%
//   hg              37.2%  null means NO HEADGEAR, not missing — 611,968 runners
//
// A user who filters `minDraw=1` and wonders why every Chase vanished is being
// failed by the UI, not by the data. Hence `note`.
//
// Re-measure with scripts/measure-field-coverage.ts after any reseed.

export type FilterFieldType = "number" | "enum";
export type FilterFieldFamily = "race" | "runner" | "horse" | "trainer" | "jockey";

// Whether the value hangs off the race document or off a runner subdocument.
// This is not cosmetic: a race-scoped filter is a plain $expr on the document,
// while a runner-scoped one has to go inside the $filter over `runners` that
// defines the qualifying set — see buildDynamicRunnerConds in industry-sp-dao.ts.
export type FilterFieldScope = "race" | "runner";

/**
 * How an enum field's selected values are matched.
 *
 * "equals" is the obvious one and is what `sex` needs. `hg` needs "contains",
 * because headgear is a SET rendered as a string: a horse in blinkers and a
 * tongue tie is stored as "tb", not as two values. Matching "b" by equality
 * would find 45,693 runners and miss the 13,382 wearing blinkers alongside
 * something else — a punter asking for "blinkers" means all 59,075 of them.
 */
export type FilterFieldMatchMode = "equals" | "contains";

export interface FilterEnumValue {
  value: string;
  label: string;
  /** Runners matching this value, measured — lets the picker order and explain. */
  count: number;
}

export interface FilterField {
  /** Query-param stem: `min<Name>` / `max<Name>`, or `<Name>s` for enums. */
  name: string;
  label: string;
  family: FilterFieldFamily;
  type: FilterFieldType;
  scope: FilterFieldScope;
  /** Stored field name, relative to its scope root. Mutually exclusive with `expr`. */
  path?: string;
  /**
   * Aggregation expression for a value that is NOT stored, written in the
   * variable binding of its scope (`$$r.x` for runner, `$x` for race).
   * Mutually exclusive with `path`.
   */
  expr?: Record<string, unknown>;
  /** False disables the field in the picker — listed, but not selectable. */
  enabled: boolean;
  /** Measured percentage of runners (or races) with a non-null value. */
  coverage: number;
  /** Shown under the field in the picker. Explains sparse or surprising coverage. */
  note?: string;
  /** Names an existing filter that covers the same ground, for the picker to flag. */
  overlaps?: string;
  /** enum only: the selectable values, measured and ordered by frequency. */
  enumValues?: FilterEnumValue[];
  /** enum only: defaults to "equals". */
  matchMode?: FilterFieldMatchMode;
  /**
   * enum only: the query param carrying the comma-joined selection. Explicit
   * rather than `name + "s"` because that produces "sexs".
   */
  enumParam?: string;
}

/**
 * ROI as ml/train_and_predict.py's load_dataframe computes it: returns over
 * staked, from the two stored accumulators, and undefined when nothing was
 * staked.
 *
 * `null` rather than 0 on a zero denominator is deliberate and matches
 * ml/features.py's _safe_ratio: an inf or a 0 sorts as a real value and would
 * make "this trainer has never had a qualifying runner" indistinguishable from
 * "this trainer breaks even". `$divide` by 0 raises in MongoDB, so the guard is
 * load-bearing, not defensive.
 */
function roiExpr(staked: string, returns: string): Record<string, unknown> {
  return {
    $cond: [
      { $gt: [`$$r.${staked}`, 0] },
      { $divide: [{ $ifNull: [`$$r.${returns}`, 0] }, `$$r.${staked}`] },
      null,
    ],
  };
}

const DEAD_COMMENT_NOTE =
  "Always empty. Derived from runners[].comment, which is 0.3% populated — the " +
  "CSV the collection was seeded from never carried it, and only the RacingAPI " +
  "capture (from July 2026) writes it.";

const DEBUTANT_NOTE = "Absent on debutants — 89,337 runners have no prior form to average.";

export const FILTER_FIELDS: FilterField[] = [
  // --- Race ---------------------------------------------------------------
  {
    name: "distanceFurlongs",
    label: "Distance (furlongs)",
    family: "race",
    type: "number",
    scope: "race",
    // Written by src/commands/precompute-distance-furlongs.ts. The stored
    // `distance` is a string ("5f", "1m2½f"), and that half-furlong glyph is
    // fiddly enough to be worth parsing once rather than per query.
    path: "distanceFurlongs",
    enabled: true,
    coverage: 100,
  },
  {
    name: "ran",
    label: "Field size",
    family: "race",
    type: "number",
    scope: "race",
    path: "ran",
    enabled: true,
    coverage: 100,
    overlaps: "Runners",
    note: "Same field as the Runners filter above; both apply together if you set both.",
  },

  // --- Runner -------------------------------------------------------------
  {
    name: "num",
    label: "Saddlecloth number",
    family: "runner",
    type: "number",
    scope: "runner",
    path: "num",
    enabled: true,
    coverage: 100,
  },
  {
    name: "draw",
    label: "Draw (stall)",
    family: "runner",
    type: "number",
    scope: "runner",
    path: "draw",
    enabled: true,
    coverage: 64.8,
    note: "Flat races only (99.9%). Jumps races have no stalls, so this filter excludes every Hurdle, Chase and NH Flat.",
  },
  {
    name: "wgt",
    label: "Weight carried (lbs)",
    family: "runner",
    type: "number",
    scope: "runner",
    path: "wgt",
    enabled: true,
    coverage: 100,
  },
  {
    name: "age",
    label: "Age",
    family: "runner",
    type: "number",
    scope: "runner",
    path: "age",
    enabled: true,
    coverage: 100,
  },
  {
    name: "officialRating",
    label: "Official rating",
    family: "runner",
    type: "number",
    scope: "runner",
    path: "officialRating",
    enabled: true,
    coverage: 78.1,
    note: "Handicaps 99.9%, maidens and novices 16.3% — unrated horses have no mark published, so this filter skews heavily towards handicaps.",
  },
  {
    name: "sex",
    label: "Sex",
    family: "runner",
    type: "enum",
    scope: "runner",
    path: "sex",
    enabled: true,
    coverage: 100,
    enumParam: "sexes",
    matchMode: "equals",
    enumValues: [
      { value: "G", label: "Gelding", count: 616786 },
      { value: "F", label: "Filly", count: 181249 },
      { value: "M", label: "Mare", count: 90931 },
      { value: "C", label: "Colt", count: 81419 },
      { value: "H", label: "Horse", count: 3541 },
      { value: "R", label: "Rig", count: 122 },
    ],
  },
  {
    name: "hg",
    label: "Headgear",
    family: "runner",
    type: "enum",
    scope: "runner",
    path: "hg",
    enabled: true,
    coverage: 37.2,
    enumParam: "headgear",
    // See FilterFieldMatchMode — "tb" is one runner in two pieces of headgear,
    // so equality matching would undercount every option here.
    matchMode: "contains",
    enumValues: [
      { value: "p", label: "Cheekpieces", count: 144212 },
      { value: "t", label: "Tongue tie", count: 129282 },
      { value: "b", label: "Blinkers", count: 59075 },
      { value: "h", label: "Hood", count: 49097 },
      { value: "v", label: "Visor", count: 35761 },
      { value: "e", label: "Eye shield", count: 2714 },
    ],
    note: "Null means NO headgear, not missing data — 611,968 runners (62.8%) run bare-headed. Selecting an option matches it alone or in combination, so Blinkers finds b, tb, bp and the rest.",
  },

  // --- Horse form ---------------------------------------------------------
  {
    name: "daysSinceLastRun",
    label: "Days since last run",
    family: "horse",
    type: "number",
    scope: "runner",
    path: "daysSinceLastRun",
    enabled: true,
    coverage: 90.5,
    note: DEBUTANT_NOTE,
  },
  {
    name: "horseCareerRuns",
    label: "Career runs",
    family: "horse",
    type: "number",
    scope: "runner",
    path: "horseCareerRuns",
    enabled: true,
    coverage: 99.6,
  },
  {
    name: "horseCareerWinRate",
    label: "Career win rate (%)",
    family: "horse",
    type: "number",
    scope: "runner",
    path: "horseCareerWinRate",
    enabled: true,
    coverage: 90.5,
    note: DEBUTANT_NOTE,
  },
  {
    name: "horseAvgRPR",
    label: "Avg RPR (last 3)",
    family: "horse",
    type: "number",
    scope: "runner",
    path: "horseAvgRPR",
    enabled: true,
    coverage: 89.6,
    note: `Trailing mean of the horse's prior runs, never this race's own figure. ${DEBUTANT_NOTE}`,
  },
  {
    name: "horseAvgTS",
    label: "Avg Topspeed (last 3)",
    family: "horse",
    type: "number",
    scope: "runner",
    path: "horseAvgTS",
    enabled: true,
    coverage: 86.8,
    note: `Trailing mean of the horse's prior runs, never this race's own figure. ${DEBUTANT_NOTE}`,
  },
  {
    name: "horseAvgBeatenDistance",
    label: "Avg beaten distance (last 3)",
    family: "horse",
    type: "number",
    scope: "runner",
    path: "horseAvgBeatenDistance",
    enabled: true,
    coverage: 89.9,
    note: `Trailing mean of the horse's prior runs, never this race's own figure. ${DEBUTANT_NOTE}`,
  },
  {
    name: "horseAvgExcuseScore",
    label: "Avg excuse score",
    family: "horse",
    type: "number",
    scope: "runner",
    path: "horseAvgExcuseScore",
    enabled: false,
    coverage: 0,
    note: DEAD_COMMENT_NOTE,
  },
  {
    name: "horseTroubleInRunningRate",
    label: "Trouble-in-running rate",
    family: "horse",
    type: "number",
    scope: "runner",
    path: "horseTroubleInRunningRate",
    enabled: false,
    coverage: 0,
    note: DEAD_COMMENT_NOTE,
  },
  {
    name: "horseTravelledWellRate",
    label: "Travelled-well rate",
    family: "horse",
    type: "number",
    scope: "runner",
    path: "horseTravelledWellRate",
    enabled: false,
    coverage: 0,
    note: DEAD_COMMENT_NOTE,
  },

  // --- Trainer / jockey 14-day form ---------------------------------------
  {
    name: "trainerFormRuns",
    label: "Trainer 14d runs",
    family: "trainer",
    type: "number",
    scope: "runner",
    path: "trainerFormRuns",
    enabled: true,
    coverage: 99.6,
  },
  {
    name: "trainerFormWinRate",
    label: "Trainer 14d win rate (%)",
    family: "trainer",
    type: "number",
    scope: "runner",
    path: "trainerFormWinRate",
    enabled: true,
    coverage: 92.9,
    overlaps: "Trainer form",
    note: "The existing Trainer form filter counts how many runners in a race clear a threshold; this one bounds the individual runner's own rate. Both apply together if you set both.",
  },
  {
    name: "trainerFormROI",
    label: "Trainer 14d ROI",
    family: "trainer",
    type: "number",
    scope: "runner",
    expr: roiExpr("trainerFormStaked", "trainerFormReturns"),
    enabled: true,
    coverage: 92.9,
    note: "Returns divided by staked over the trailing 14 days. Undefined (and so excluded) when the trainer had no qualifying runners. 1.0 is break-even.",
  },
  {
    name: "jockeyFormRuns",
    label: "Jockey 14d rides",
    family: "jockey",
    type: "number",
    scope: "runner",
    path: "jockeyFormRuns",
    enabled: true,
    coverage: 99.6,
  },
  {
    name: "jockeyFormWinRate",
    label: "Jockey 14d win rate (%)",
    family: "jockey",
    type: "number",
    scope: "runner",
    path: "jockeyFormWinRate",
    enabled: true,
    coverage: 95.7,
  },
  {
    name: "jockeyFormROI",
    label: "Jockey 14d ROI",
    family: "jockey",
    type: "number",
    scope: "runner",
    expr: roiExpr("jockeyFormStaked", "jockeyFormReturns"),
    enabled: true,
    coverage: 95.7,
    note: "Returns divided by staked over the trailing 14 days. Undefined (and so excluded) when the jockey had no qualifying rides. 1.0 is break-even.",
  },
];

const BY_NAME = new Map(FILTER_FIELDS.map(f => [f.name, f]));

export function getFilterField(name: string): FilterField | undefined {
  return BY_NAME.get(name);
}

/**
 * The value expression for a field, in the variable binding of its scope.
 * Runner fields are `$$r`-bound because every caller uses them inside a
 * $filter/$map over `runners`; race fields are plain `$`-bound document paths.
 */
export function fieldValueExpr(field: FilterField): unknown {
  if (field.expr) return field.expr;
  return field.scope === "runner" ? `$$r.${field.path}` : `$${field.path}`;
}
