// The Kaggle CSV ↔ RacingAPI field comparison, as structured data for the
// admin-only /admin/data-sources screen.
//
// This is the same analysis as README-kaggle-vs-racingapi-fields.md, which
// carries the full prose, the reproduction commands and the caveats. Kept
// here as data rather than as a rendered copy of that markdown so the screen
// can group, colour-code and count it; the two are expected to be edited
// together.
//
// Every number below was measured, not estimated — sources are in the
// markdown's "How this was produced" table:
//   CSV        mini-update.csv, 3,653 rows / 385 races, 2026-05-28..06-03
//   racecards  daily_racecards, 573 races (/racecards/free), 2026-07..08-16
//   results    industry_starting_prices raceDate >= 2026-07-01, 529 races /
//              4,221 runners (/results/today)
//   CSV history industry_starting_prices raceDate < 2026-05-28

/** ✅ values agree · ⚠️ same concept, different encoding · ❌ genuinely different */
export type ComparisonVerdict = "same" | "caution" | "different";

export interface FieldComparisonRow {
  /** Column name in the Kaggle CSV. */
  csv: string;
  /** Field on `/results/today`, or null where the endpoint has no counterpart. */
  results: string | null;
  /** Field on `/racecards/*`, or null where the endpoint has no counterpart. */
  racecards: string | null;
  verdict: ComparisonVerdict;
  /** Race-level columns are constant within a race; the rest are per runner. */
  level: "race" | "runner";
  note: string;
}

export interface LabelledStat {
  label: string;
  csv: string;
  api: string;
}

export interface DataSourceComparison {
  /** ISO date the underlying analysis was run — the figures are a snapshot. */
  generatedAt: string;
  headline: string[];
  samples: { name: string; what: string; scale: string; window: string }[];
  caveats: string[];
  fields: FieldComparisonRow[];
  commentMeanings: { where: string; meaning: string }[];
  commentStyle: LabelledStat[];
  lexiconRates: LabelledStat[];
  populationEras: { field: string; csvEra: string; apiEra: string; why: string }[];
  apiOnly: { group: string; fields: string }[];
  normalisation: string[];
}

const FIELDS: FieldComparisonRow[] = [
  // --- race level ---
  { csv: "date", results: "date", racecards: "date", verdict: "same", level: "race",
    note: "YYYY-MM-DD, local track date, both." },
  { csv: "course", results: "course", racecards: "course", verdict: "caution", level: "race",
    note: "Both suffix the name in brackets, but the CSV's suffix is surface only (Wolverhampton (AW)); the API's is surface and country (Ballinrobe (IRE)). 19 course names overlap exactly." },
  { csv: "race_id", results: "race_id", racecards: "race_id", verdict: "different", level: "race",
    note: "Numeric 921775 vs string rac_32294141867. No shared key — the mapper hashes its own numeric _id." },
  { csv: "off", results: "off", racecards: "off_time", verdict: "different", level: "race",
    note: "CSV is a 24-hour clock (00:32 to 22:59). The API is 12-hour with no meridiem (3:45 means 15:45). Use off_dt for arithmetic." },
  { csv: "race_name", results: "race_name", racecards: "race_name", verdict: "caution", level: "race",
    note: "CSV strips apostrophes: 0/3,653 CSV race names contain one, 109/513 API ones do (Novices' Hurdle)." },
  { csv: "type", results: "type", racecards: "type", verdict: "same", level: "race",
    note: "Flat / Hurdle / Chase / NH Flat — the same four tokens in both." },
  { csv: "class", results: "class", racecards: "race_class", verdict: "same", level: "race",
    note: "Class 1..Class 6, blank where unclassed. 100% filled on GB rows, 1% on Irish rows — which matches the API's own note about Irish racing." },
  { csv: "pattern", results: "pattern", racecards: "pattern", verdict: "same", level: "race",
    note: "Group 1-3, Grade 1-3, Listed; blank otherwise (13% filled)." },
  { csv: "rating_band", results: "rating_band", racecards: "rating_band", verdict: "same", level: "race",
    note: "Always 0-prefixed: 0-50 through 0-130." },
  { csv: "age_band", results: "age_band", racecards: "age_band", verdict: "same", level: "race",
    note: "2yo, 3yo+, 4-5yo, 6yo+ — same grammar in both." },
  { csv: "sex_rest", results: "sex_rest", racecards: "sex_restriction", verdict: "caution", level: "race",
    note: "CSV spaces the ampersand (C & G, F & M); the spec's example is unspaced (F&M). Neither mapper stores it, so this one is from the spec, not from live values." },
  { csv: "dist", results: "dist", racecards: "distance / distance_f / distance_round", verdict: "same", level: "race",
    note: "Identical convention against /results, including the ½ character: 3m2½f, 1m½f, 7½f. Racecards instead give 7.0 / 0m7f6y / 7f — none of them the CSV form." },
  { csv: "going", results: "going", racecards: "going", verdict: "caution", level: "race",
    note: "Same core vocabulary, but the CSV adds Irish/French/US goings (Yielding, Very Soft, Fast) and flattens split all-weather going to plain Standard, where results say Standard / Slow and racecards say Standard To Slow — one going, three strings." },
  { csv: "ran", results: null, racecards: "field_size", verdict: "different", level: "race",
    note: "The only CSV column with no results counterpart. ran equals the row count in all 385 races (starters). field_size is declared runners, so it counts non-runners too." },
  // --- runner level ---
  { csv: "num", results: "number", racecards: "number", verdict: "same", level: "runner",
    note: "Saddlecloth number. Racecards additionally use NR here to mark a non-runner, a value the CSV can never contain." },
  { csv: "pos", results: "position", racecards: null, verdict: "same", level: "runner",
    note: "Same Racing Post code set for non-completions — CSV PU/F/UR/DSQ/CO/BD/RR/SU, API PU/UR/RR/F/RO." },
  { csv: "draw", results: "draw", racecards: "draw", verdict: "same", level: "runner",
    note: "Stall number, blank for jumps. 74% filled in the CSV (48% on Irish rows), 98% on the GB-only API sample." },
  { csv: "ovr_btn", results: "ovr_btn", racecards: null, verdict: "caution", level: "runner",
    note: "Cumulative lengths behind the winner, 0 for the winner, in both. CSV writes - when unavailable; the API writes an empty string." },
  { csv: "btn", results: "btn", racecards: null, verdict: "caution", level: "runner",
    note: "Lengths behind the horse in front. The CSV mixes .5 and 0.05 formatting in the same column. Not stored by either mapper — spec-only on the API side." },
  { csv: "horse", results: "horse", racecards: "horse", verdict: "different", level: "runner",
    note: "The two API feeds disagree with each other. CSV and /results both suffix the country on every name (Beorma (IRE)); /racecards never does (Beorma) and puts the country in a separate region field." },
  { csv: "age", results: "age", racecards: "age", verdict: "same", level: "runner",
    note: "Integer as a string, 2-13 in the CSV." },
  { csv: "sex", results: "sex", racecards: "sex / sex_code", verdict: "different", level: "runner",
    note: "CSV and /results use the single letter (G/F/C/M/H, plus R for a rig in the CSV). /racecards uses the whole word — gelding, filly, colt, mare — with the letter in sex_code." },
  { csv: "wgt", results: "weight (+weight_lbs)", racecards: "lbs", verdict: "caution", level: "runner",
    note: "CSV is stone-pounds (9-2); racecards give pounds only (133). Scales agree: 9-2 = 128 lb, the modal API value. parseWeightPounds() converts the CSV form." },
  { csv: "hg", results: "headgear", racecards: "headgear (+headgear_run)", verdict: "caution", level: "runner",
    note: "Same letter codes, but the CSV appends 1 for first-time headgear (p1, t1, tp1 — 242 rows, 15% of filled values) and the API never does. The API's equivalent, headgear_run, only exists on /racecards/basic and above, so it is absent from the feed we ingest." },
  { csv: "time", results: "time", racecards: null, verdict: "same", level: "runner",
    note: "Per-horse finishing time, 3:54.14. CSV writes - when missing. Spec-only on the API side." },
  { csv: "sp", results: "sp (+sp_dec)", racecards: null, verdict: "different", level: "runner",
    note: "Both are unreduced fractions with an F/J/C favourite suffix — but at even money the CSV writes EvensF (never 1/1) and the API writes 1/1 (never Evens)." },
  { csv: "jockey", results: "jockey", racecards: "jockey", verdict: "different", level: "runner",
    note: "/racecards appends the claim to the name (Alice Bond(5)); /results and the CSV do not, and the API exposes it as jockey_claim_lbs instead. The CSV also drops apostrophes: Kieran ONeill vs Kieran O'Neill." },
  { csv: "trainer", results: "trainer", racecards: "trainer", verdict: "caution", level: "runner",
    note: "286 names match exactly; 11 differ only in punctuation — CSV A P OBrien / K R Burke vs API A P O'Brien / K. R. Burke. Ampersands survive in the CSV, apostrophes and initial periods do not." },
  { csv: "prize", results: "prize", racecards: "prize", verdict: "different", level: "runner",
    note: "CSV and /results mean prize won by this runner (4710.60, 2210.40, 1104.30 down the finishing order). /racecards prize is the race's winning purse, race-level (£4,187). The CSV also writes bare decimals for GB rows and €-prefixed integers for Irish/French ones — never £, never a thousands separator." },
  { csv: "or", results: "or", racecards: "ofr", verdict: "caution", level: "runner",
    note: "Same value, three different null tokens: CSV en dash – (U+2013), racecards ASCII -, results empty string. toNullableRating() handles all three." },
  { csv: "rpr", results: "rpr", racecards: "rpr", verdict: "different", level: "runner",
    note: "Real integers in the CSV; permanently empty on the API since June 2026 (0 of 4,221 captured runners). The replacement, performance_rating, is not read by any mapper yet." },
  { csv: "ts", results: "tsr", racecards: "ts", verdict: "different", level: "runner",
    note: "Note the name change — the results feed calls it tsr, not ts. Also permanently empty (0 of 4,221); replaced by speed_rating, likewise unread." },
  { csv: "sire", results: "sire", racecards: "sire", verdict: "different", level: "runner",
    note: "CSV always suffixes the country (Mehmas (IRE)); racecards never do (Mehmas), carrying sire_region separately. 330 sires match once the suffix is stripped." },
  { csv: "dam", results: "dam", racecards: "dam", verdict: "different", level: "runner",
    note: "Same as sire — CSV Atlantic Edge (IRE) vs racecards Atlantic Edge. 889 dams match after stripping." },
  { csv: "damsire", results: "damsire", racecards: "damsire", verdict: "caution", level: "runner",
    note: "The CSV suffixes sire and dam but not damsire, so this column already matches the API's form. 442 overlap; the only 16 differences are apostrophes (Sadlers Wells vs Sadler's Wells)." },
  { csv: "owner", results: "owner", racecards: "owner", verdict: "caution", level: "runner",
    note: "0 of 3,653 CSV owner strings contain & ( , ' or . — all stripped (K Shenton D Cunha, Power Geneva Equine Ltd). The API keeps the punctuation and the honorifics (Mr Jaber Abdullah)." },
  { csv: "comment", results: "comment", racecards: "comment", verdict: "different", level: "runner",
    note: "Four different meanings across the two sources — see the comment section." },
];

export const DATA_SOURCE_COMPARISON: DataSourceComparison = {
  generatedAt: "2026-08-16",
  headline: [
    "The Kaggle CSV is a Racing Post results feed built on the same data model as RacingAPI's /results endpoints: 36 of its 37 columns have a same-named counterpart there, down to the idiosyncratic ones (ovr_btn, sex_rest, off, dist).",
    "/racecards is a different shape from /results, and the CSV matches the results shape. The expensive mistake is mapping a CSV column onto the same-named racecard field — horse, sex, jockey, comment, prize and class all mean different things on the two endpoints.",
    "The CSV is results-only. It carries no pre-race declaration state at all, so nothing in it reconstructs what was knowable before a race.",
  ],
  samples: [
    { name: "CSV", what: "mini-update.csv", scale: "3,653 rows · 385 races · 54 courses · 37 columns", window: "2026-05-28 → 06-03" },
    { name: "API racecards", what: "daily_racecards, from /racecards/free", scale: "573 races · ~4,900 runners", window: "2026-07 → 08-16" },
    { name: "API results", what: "industry_starting_prices, from /results/today", scale: "529 races · 4,221 runners", window: "2026-07-01 → 08-15" },
    { name: "CSV history", what: "industry_starting_prices, from raceform.csv", scale: "109,775 races", window: "2015 → 2026-05-27" },
  ],
  caveats: [
    "No RacingAPI credentials exist in any checkout on this VM, so API values were read back from Atlas after mapping rather than from raw HTTP responses. The mapping copies strings verbatim, so string comparisons hold; parsed fields (sp, weight, or) are called out individually.",
    "The samples are different weeks, so no runner appears in both. Comparisons are semantic, distributional, or name-for-name across the ~700 horses, ~300 trainers, ~215 jockeys and ~440 damsires that recur in both corpora.",
    "Fields neither mapper stores (btn, time, prize, sp_dec, sex_rest) are verified against the OpenAPI spec only.",
  ],
  fields: FIELDS,
  commentMeanings: [
    { where: "CSV comment", meaning: "Racing Post post-race in-running commentary, with market moves and stewards'/jockey explanations appended in brackets." },
    { where: "/results runner comment", meaning: "RacingAPI's own post-race analyst note. Same concept, different author and house style." },
    { where: "/racecards runner comment", meaning: "A PRE-race analyst preview of the runner — it replaced spotlight in June 2026. Nothing to do with how the race was run." },
    { where: "/results race-level comments", meaning: "Official stewards' notes from the racing authority, one per race." },
  ],
  commentStyle: [
    { label: "Mean length", csv: "99 chars (max 980)", api: "142 chars (max 337)" },
    { label: "Segment separator ' - '", csv: "95%", api: "99.9%" },
    { label: "Contains a bracket", csv: "81%", api: "0% (0 of 3,551)" },
    { label: "Market move (op 40/1)", csv: "67%", api: "0%" },
    { label: "Touched price (tchd 50/1)", csv: "13%", api: "0%" },
    { label: "Jockey/trainer explanation", csv: "7%", api: "0%" },
    { label: "Populated", csv: "80% overall, 100% on GB and IRE rows", api: "84%" },
  ],
  lexiconRates: [
    { label: "hasTroubleInRunning", csv: "8.0%", api: "8.2%" },
    { label: "hasTravelledWell", csv: "1.4%", api: "2.8%" },
    { label: "hasWeakened", csv: "53.2%", api: "25.5%" },
    { label: "hasGreenness", csv: "8.6%", api: "0.4%" },
  ],
  populationEras: [
    { field: "rpr", csvEra: "90%", apiEra: "0%", why: "Removed by the API in June 2026; performance_rating replaces it and no mapper reads it yet." },
    { field: "ts", csvEra: "89%", apiEra: "0%", why: "Same removal; speed_rating replaces it, likewise unread." },
    { field: "comment", csvEra: "0% (field absent)", apiEra: "84%", why: "The importer only started mapping comment on 2026-07-25 and the full import has not been re-run since. The source column is 80% populated, so a reseed would fill it." },
    { field: "officialRating", csvEra: "78%", apiEra: "83%", why: "Populated from both sources." },
    { field: "hg", csvEra: "37%", apiEra: "37%", why: "Populated from both sources." },
  ],
  apiOnly: [
    { group: "Identity and joins", fields: "horse_id · jockey_id · trainer_id · owner_id · sire_id · dam_id · damsire_id · course_id" },
    { group: "Results extras", fields: "sp_dec · weight_lbs · jockey_claim_lbs · off_dt · dist_y · dist_m · dist_f · surface · jumps · winning_time_detail · non_runners · stewards' comments · tote dividends · silk_url · performance_rating · speed_rating" },
    { group: "Pre-race only (racecards)", fields: "form · last_run · pre-race ofr · colour · dob · breeder · breeding regions · trainer_location · trainer_14_days · trainer_rtf · prev_trainers · prev_owners · medical · headgear_run · wind_surgery · past_results_flags · quotes · stable_tour · going_detailed · stalls · weather · big_race · is_abandoned · race_status · field_size" },
  ],
  normalisation: [
    "Strip the country suffix from horse/sire/dam before comparing to /racecards — but not to /results, which keeps it.",
    "Re-insert apostrophes, or strip them from both sides: the CSV has none anywhere.",
    "Strip periods from initials (K. R. Burke → K R Burke) and normalise ampersands.",
    "Strip the jockey claim — (3), (5), (7) — from racecard jockey names.",
    "Case-fold: the results feed re-cases some names (Mister Mcgregor, Hk Fourteen).",
    "Convert one of the two clocks before comparing off; prefer off_dt.",
    "Handle three null tokens: en dash – (CSV ratings), - (racecard ofr, CSV time/ovr_btn), empty string (results).",
    "Map Evens ↔ 1/1 before comparing any stored fraction.",
    "Weight: parseWeightPounds('9-2') = 128 = the API's lbs.",
    "Strip the CSV's trailing 1 from headgear before comparing codes.",
    "Region: the CSV can only be regionalised via the course allowlist in course-country.ts — it has no region column.",
  ],
};
