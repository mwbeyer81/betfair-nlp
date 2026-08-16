# Kaggle CSV ↔ The Racing API — field-by-field comparison

The two sources that feed `industry_starting_prices` are the Kaggle
"Horse Racing results — UK/Ireland" CSV (history, `yarn import:industry-sp`)
and The Racing API's `/results/today` (live, 21:30 UTC cron). They look
interchangeable — they are not. This file records which fields correspond,
which *look* like they correspond but mean different things, and how the
actual values differ when both sources describe the same concept.

Companions: `README-racing-api-fields.md` (every RacingAPI field, from the
OpenAPI spec) · `data/README.md` (dataset provenance) ·
`src/lib/dao/industry-sp-row-mapping.ts` (the shared mapper both importers use).

## How this was produced

Nothing below is inferred from field names alone; every claim is from real
values in one of these four samples.

| Sample | What | Scale | Window |
|---|---|---|---|
| **CSV** | `data/kaggle-horse-racing-uk-ireland/extracted/mini-update.csv` | 3,653 rows, 385 races, 54 courses, 37 columns | 2026-05-28 → 06-03 |
| **API racecards** | Atlas `daily_racecards` (ingested from `/racecards/free`) | 573 races, ~4,900 runners | 2026-07 → 2026-08-16 |
| **API results** | Atlas `industry_starting_prices`, `raceDate ≥ 2026-07-01` (captured from `/results/today`) | 529 races, 4,221 runners | 2026-07-01 → 08-15 |
| **CSV history** | Atlas `industry_starting_prices`, `raceDate < 2026-05-28` (imported from `raceform.csv`) | 109,775 races | 2015 → 2026-05-27 |

Plus `https://api.theracingapi.com/openapi.json` (v1.4.4) for field
*definitions*.

**Caveats, stated up front.** No credentials for The Racing API exist in any
checkout on this VM (`config/local.json` is absent everywhere), so the API-side
values here are read back from Atlas *after* `industry-sp-row-mapping.ts` /
`daily-race-dao.ts` mapped them, not from raw HTTP responses. The mapping is
near-identity for strings (`comment`, `jockey`, `trainer`, `horse`, `position`,
`headgear`, `sex` are copied verbatim), so string-level comparisons hold; where
a value is parsed (`sp` → `isp`/`ispFraction`, `weight_lbs` → `wgt`, `or` →
`officialRating`) that is called out. Fields the mappers never store
(`btn`, `time`, `prize`, `sp_dec`, `tote_*`, `dist_y`) are marked **spec-only**
— definition verified, values not.

The two samples are also from different weeks (the CSV file is late May/June,
the API data is July/August), so *no runner appears in both*. Comparisons are
therefore either semantic, distributional, or — where the same entity recurs
across weeks — name-for-name on the ~700 horses, ~300 trainers, ~215 jockeys,
~440 damsires that appear in both corpora.

---

## Headline

**The Kaggle CSV is a Racing Post results feed with the same underlying data
model as RacingAPI's `/results/*` endpoints.** 36 of its 37 columns have a
same-or-near-same-named counterpart on `/results/today`, including the
idiosyncratic ones — `ovr_btn`, `sex_rest`, `off`, `dist`, `class`, `ran`'s
neighbours. That is not a coincidence of naming; it is the same source data
model, reached two different ways.

But: **`/racecards/*` is a different shape from `/results/*`, and the CSV
matches the results shape, not the racecard one.** The single most expensive
mistake available here is mapping a CSV column onto the same-named *racecard*
field. `horse`, `sex`, `jockey`, `comment`, `prize` and `class` all mean
different things on the two API endpoints.

---

## 1. Coverage and scope

| | Kaggle CSV | RacingAPI (our plan/endpoints) |
|---|---|---|
| Geography | Worldwide — 54 courses in one week, incl. Sha Tin, Happy Valley, Tokyo, Kyoto, Churchill Downs, Santa Anita, Saratoga, Belmont Park (Perth), Eagle Farm, Longchamp, Chantilly, Auteuil, San Siro, Dusseldorf, Greyville, Woodbine | GB + IRE on `/results/today` and `/racecards/*`; North America and Australia are separate endpoint families with their own schemas |
| Country marker | **None.** No `region` column, and `course` carries no country suffix — "Curragh", "Tramore", "Compiegne" are bare. This is why `src/lib/dao/course-country.ts` has to keep a 59-course BHA allowlist | `region` field (`GB`/`IRE`) at race level, plus a country suffix on the course name (`Ballinrobe (IRE)`) |
| Our own filtering | `import-industry-sp.ts` drops ~42% of races (non-BHA courses) via the allowlist | `industry-sp-results-capture-service.ts:229` drops anything with `region !== "GB"` |
| Row grain | One row per **runner that came under starter's orders**; `ran` always equals the row count per race (385/385 races checked). Non-runners are absent | `/results` runners array is finishers-in-order, same grain. `/racecards/*` keeps non-runners in the array with `number: "NR"` |
| Race identity | `race_id` numeric, ~6 digits (`921775`) | `race_id` string, `rac_`-prefixed (`rac_32294141867`). No shared key exists — `industry-sp-row-mapping.ts` synthesises numeric `_id`s by hashing |
| Entity ids | **None at all** — no horse/jockey/trainer/owner/sire/dam ids | `horse_id`, `jockey_id`, `trainer_id`, `owner_id`, `sire_id`, `dam_id`, `damsire_id`, `course_id`. Joins are by id, not by name |

---

## 2. Column-by-column: CSV → RacingAPI

`R` = `/results/today` (`ResultBasic` / result `RunnerBasic`), `C` = `/racecards/*`.
"Same?" answers *do the actual values look alike*, not *do the names match*.

### Race-level CSV columns (constant within a race — verified across all 385)

| CSV | R | C | Same? | Actual values |
|---|---|---|---|---|
| `date` | `date` | `date` | ✅ identical | `2026-05-28` / `2026-08-16` — `YYYY-MM-DD`, local track date, both |
| `course` | `course` | `course` | ⚠️ suffix means different things | Both use a parenthesised suffix, but the CSV's is **surface only** (`Wolverhampton (AW)`, `Lingfield (AW)`, and `Lingfield`/`Southwell` unsuffixed for their turf meetings); the API's is surface *and* country (`Kempton (AW)`, `Newmarket (July)`, `Ballinrobe (IRE)`). Exact string overlap of the two course sets: 19 |
| `race_id` | `race_id` | `race_id` | ❌ different id space | `921775` vs `rac_32294141867` |
| `off` | `off` | `off_time` | ❌ **different clock** | CSV is **24-hour**, spanning `00:32`→`22:59` (worldwide cards). API is **12-hour with no meridiem** — `3:45`, `8:25`. A 3:45 API race is 15:45. Use `off_dt` (ISO 8601, tz-aware) instead where available; CSV has no equivalent |
| `race_name` | `race_name` | `race_name` | ⚠️ punctuation | Same title, but the CSV strips apostrophes: `Dine In The Altiors Resturant Novices Handicap Chase` vs API `... Novices' Hurdle`. 0/3,653 CSV race names contain `'`; 109/513 API ones do |
| `type` | `type` | `type` | ✅ identical | `Flat`, `Hurdle`, `Chase`, `NH Flat` — same four tokens in both |
| `class` | `class` | `race_class` | ✅ identical values | `Class 1`…`Class 6`, blank where unclassed. Coverage matches the API's own note: 100% on GB rows, **1% on IRE rows**, 62% overall in the CSV |
| `pattern` | `pattern` | `pattern` | ✅ identical | `Group 1-3`, `Grade 1-3`, `Listed`; blank otherwise (13% filled) |
| `rating_band` | `rating_band` | `rating_band` | ✅ identical | `0-50` … `0-130`, always `0-`-prefixed |
| `age_band` | `age_band` | `age_band` | ✅ identical | `2yo`, `3yo+`, `4-5yo`, `6yo+` — same grammar in both |
| `sex_rest` | `sex_rest` | `sex_restriction` | ⚠️ spacing (spec-only on the API side) | CSV: `F`, `M`, `C & G`, `F & M` (spaced ampersand). Spec example: `F&M` (unspaced). Not stored by either mapper, so unverified against live values — treat as needing a normalise |
| `dist` | `dist` | `distance` / `distance_f` / `distance_round` | ✅ same convention on `R` | Both use the same miles-furlongs-halves string incl. the `½` character: CSV `3m2½f`, `1m½f`, `7½f`; API results `7½f`, `1m½f`, `1m3½f`. `/racecards` instead gives `distance_f` (`"7.0"`), `distance` (`0m7f6y`), `distance_round` (`7f`) — none of which is the CSV form |
| `going` | `going` | `going` | ⚠️ different granularity, **three renderings** | Shared: `Good`, `Good To Firm`, `Good To Soft`, `Soft`, `Heavy`, `Firm`, `Standard`. CSV adds Irish/French/US goings (`Yielding`, `Good To Yielding`, `Very Soft`, `Fast`). For a split all-weather surface the CSV says just `Standard` (288/288 AW rows), the results feed says `Standard / Slow`, and the racecards feed says `Standard To Slow` — same going, three strings |
| `ran` | — | `field_size` | ❌ no results-level equivalent | CSV `ran` = runners that started (== row count, always). `/results` has no field; our mapper uses `runners.length`. `/racecards`'s `field_size` is *declared* runners, so it includes non-runners |

### Runner-level CSV columns

| CSV | R | C | Same? | Actual values |
|---|---|---|---|---|
| `num` | `number` | `number` | ✅ | Saddlecloth number. Blank on 33/3,653 CSV rows (foreign cards); on racecards `NR` marks a non-runner, a value the CSV can never contain |
| `pos` | `position` | — | ✅ same vocabulary | CSV codes seen: `PU`(121) `F`(26) `UR`(18) `DSQ` `CO` `BD` `RR` `SU`. API codes seen: `PU`(12) `UR`(6) `RR`(5) `F`(2) `RO`(1). Same Racing Post code set; `deriveStatus()` treats every non-numeric as `NON_FINISHER` in both paths |
| `draw` | `draw` | `draw` | ✅ | Stall number, blank for jumps. 74% filled in the CSV (48% on Irish rows), 98% on the GB-only API sample |
| `ovr_btn` | `ovr_btn` | — | ⚠️ null token | Cumulative lengths behind the winner, `0` for the winner, in both. CSV writes `-` for unavailable (169 rows); API writes empty |
| `btn` | `btn` | — | ⚠️ formatting (spec-only) | Lengths behind the horse in front. CSV mixes leading-dot and leading-zero decimals in the same column: `.5`, `.25`, `.75` alongside `0.05`, `0.2`, `0.3`. Neither mapper stores `btn`, so the API's formatting is unverified |
| `horse` | `horse` | `horse` | ❌ **R and C disagree with each other** | CSV: country suffix on **every** row (3,653/3,653) — `Beorma (IRE)`. `/results`: suffix present too (`I'd Go Maniac (FR)`) — 662 of the two corpora's names match once the suffix is normalised. `/racecards`: **no suffix at all** (`Harley`, `Brosay`), with the country in a separate `region` field. So the same horse is `Harley (IRE)` in the CSV and on `/results`, but `Harley` + `region: "IRE"` on a racecard |
| `age` | `age` | `age` | ✅ | Integer-as-string, 2–13 in the CSV |
| `sex` | `sex` | `sex` / `sex_code` | ❌ **R and C disagree** | CSV: single letter — `G` `F` `M` `C` `H` **`R`** (rig). `/results` `sex`: single letter, same set (`G` 2,268, `F` 1,190, `C` 518, `M` 234, `H` 11 — no `R` observed). `/racecards` `sex`: the **word** (`gelding`, `filly`, `colt`, `mare`, `horse`), with the letter in `sex_code` |
| `wgt` | `weight` (+`weight_lbs`) | `lbs` | ⚠️ different unit | CSV: stone-pounds string `9-2`, `10-11` (61 distinct). `/results` gives both `weight` (`11-12`) and `weight_lbs`; `/racecards` gives only `lbs` (`133`). `parseWeightPounds()` converts the CSV form; the API path skips it. Scales agree — CSV `9-2` = 128 lb, the modal API `lbs` value |
| `hg` | `headgear` | `headgear` (+`headgear_run`) | ⚠️ **first-time marker is CSV-only** | Same letter codes (`t` `p` `b` `h` `v` and combinations) in both, and both carry odd slash forms — CSV `e/s`, API `/es`, `t/ce`, `/bes`, `h/es` (note the API's leading slash). But the CSV appends `1` for first-time headgear (`p1` 78, `t1` 41, `h1` 32, `b1` 25, `tp1` 22, `v1` 16 … 242 rows = 15% of filled values) and **the API never does** (0 digit-suffixed values in 1,554 results-feed and 1,793 racecard values). The API's equivalent is the separate `headgear_run` field, which exists only on `/racecards/basic`+ — i.e. not on the feed we ingest |
| `time` | `time` | — | ✅ same form | Per-horse finishing time, `3:54.14`. CSV null token is `-` (169 rows, 95% filled). Spec form `5:44.90` — same. **Spec-only** on the API side (not stored) |
| `sp` | `sp` (+`sp_dec`) | — | ❌ **evens is written differently** | Both are unreduced fractions with a favourite suffix — CSV `13/5F`, `9/2`, `107/20`, `85/40`, `167/10`; suffixes `F`(344) `J`(44) `C`(3). But at 1/1 the CSV writes **`EvensF`** (16 rows, and `1/1` appears 0 times) while the API writes **`1/1`** (21 runners, `Evens` appears 0 times). `parse-isp.ts` handles both and normalises to `Evens`/`1/1` respectively — so `ispFraction` in Atlas is *not* comparable as a string across eras |
| `jockey` | `jockey` | `jockey` | ❌ **R and C disagree**, plus punctuation | `/racecards` appends the claim: `Jude Fernandes(3)`, `Alice Bond(5)`, `Lewis Chalkley(7)` — 146/368 racecard jockey names carry it. `/results` and the CSV do not (the API exposes it as `jockey_claim_lbs` on results). Separately, the CSV strips apostrophes: `Fern OBrien` / `Kieran ONeill` vs API `Fern O'Brien` / `Kieran O'Neill` |
| `trainer` | `trainer` | `trainer` | ⚠️ punctuation | 286 exact matches across the corpora, 11 differing only in punctuation: CSV `A P OBrien`, `David OMeara`, `K R Burke`, `Jonjo & A J ONeill` vs API `A P O'Brien`, `David O'Meara`, `K. R. Burke`, `Jonjo & A.J. O'Neill`. CSV drops apostrophes and the periods in initials; ampersands survive |
| `prize` | `prize` | `prize` | ❌ **R and C mean different things** | CSV: prize won **by this runner** — `4710.60` / `2210.40` / `1104.30` down the finishing order, blank for the unplaced (57.5% filled). `/results` `prize` is the same per-runner concept (spec: "prize money won by this horse"). `/racecards` `prize` is the **winner's prize for the race**, race-level (`£4,187`). Currency also differs: the CSV writes bare decimals for GB/most rows and `€`-prefixed integers for 479 Irish/French rows — never `£`, never a thousands separator; the API always includes the symbol and commas |
| `or` | `or` | `ofr` | ⚠️ **three different null tokens** | Value itself identical (official mark as an integer string). Nulls: CSV uses **en dash `–` (U+2013)**, 1,039 rows; `/racecards` uses ASCII `-`; `/results` uses an empty string. `toNullableRating()` already handles all three — don't "simplify" it |
| `rpr` | `rpr` | `rpr` | ❌ **dead on the API since June 2026** | CSV: real integers (en dash for null). API: permanently empty on every plan — 0/4,221 captured runners have one. Replacement is `performance_rating`, which **no mapper reads yet** |
| `ts` | `tsr` ⚠️ | `ts` | ❌ **name differs *and* dead** | Note the results feed calls it `tsr`, not `ts`. Also permanently empty — 0/4,221. Replacement is `speed_rating`, likewise unread |
| `sire` | `sire` | `sire` | ❌ **R and C disagree** | CSV: always suffixed — `Mehmas (IRE)`, `Havana Grey (GB)` (3,653/3,653). `/racecards`: never suffixed — `Mehmas`, `Havana Grey`, with `sire_region` alongside (Basic+). 330 sires match once the suffix is stripped |
| `dam` | `dam` | `dam` | ❌ same as `sire` | CSV `Atlantic Edge (IRE)` vs racecards `Atlantic Edge` (+`dam_region`). 889 dams match after stripping |
| `damsire` | `damsire` | `damsire` | ⚠️ **CSV is inconsistent with its own sire/dam** | The CSV suffixes `sire` and `dam` but **not** `damsire` — `Galileo`, `Oasis Dream`, bare. That matches the API form directly: 442 damsires overlap, only 16 differing, all apostrophes (`Sadlers Wells` vs `Sadler's Wells`, `Medaglia dOro` vs `Medaglia d'Oro`) |
| `owner` | `owner` | `owner` | ⚠️ CSV is punctuation-stripped and honorific-stripped | 0/3,653 CSV owner strings contain `&`, `(`, `,`, `'` or `.` — all removed: `K Shenton D Cunha`, `Power Geneva Equine Ltd`, `Mrs V Owen I Owen`. API keeps them: `K Shenton & D Cunha`, `Power Geneva (Equine) Ltd`. The API also keeps honorifics the CSV drops (`Mr Jaber Abdullah` vs `Jaber Abdullah`) |
| `comment` | `comment` | `comment` | ❌ **see §3 — four different meanings** | |

---

## 3. `comment`: the same word for four different things

This is the trap worth reading twice.

| Where | What it actually is |
|---|---|
| **CSV `comment`** | Racing Post **post-race in-running commentary** for that runner, with market moves and stewards'/jockey explanations appended in parentheses |
| **`/results/*` runner `comment`** | RacingAPI's own **post-race analyst note** on the performance — same concept, different author and different house style |
| **`/racecards/*` runner `comment`** | A **pre-race** analyst preview of the runner. Spec, verbatim: *"Our analyst's pre-race note on the runner."* It replaced `spotlight` in June 2026. Nothing to do with how the race was run |
| **`/results/*` race-level `comments`** (plural) | Official **stewards' notes** from the racing authority, one per race |

Feeding a racecard `comment` into anything that consumes a results `comment` is
a straight leak-direction inversion: one describes what is expected to happen,
the other what did.

### Even the two post-race comments don't share a vocabulary

Measured over 2,910 populated CSV comments and 3,551 captured API comments:

| | Kaggle CSV | RacingAPI `/results/today` |
|---|---|---|
| Mean length | 99 chars (max 980) | 142 chars (max 337) |
| Segment separator ` - ` | 95% | 99.9% |
| Contains `(` | 81% | **0%** (0 of 3,551) |
| Market move `(op 40/1)` | 67% | 0% |
| `(tchd 50/1)` | 13% | 0% |
| `(jockey said …)` / `(trainer said …)` | 7% | 0% |
| Populated | 80% overall; **100% on GB and IRE rows**, 32% elsewhere | 84% |

CSV: `In rear throughout(op 40/1)` · `Prominent - not fluent 1st - led narrowly
after 2 out - kept on well(op 13/8 tchd 85/40)`

API: `Settled towards the back of the pack - progressed nicely to challenge with
the field bunched 2f out - pushed along a furlong from home - edged left but
driven into the front inside the final furlong - held on well to the finish`

So the CSV's `comment` carries **betting-market information the API's does not**
(opening price, touched price) — a genuine feature loss when a horse's history
comes from the API instead.

### This already changes model features

`src/lib/dao/comment-lexicon.ts` tags comments into four categories that
`precompute-horse-form.ts` turns into `horseAvgExcuseScore`,
`horseTroubleInRunningRate` and `horseTravelledWellRate`. Running that exact
lexicon over both corpora:

| Category | CSV hit rate | API hit rate |
|---|---|---|
| `hasTroubleInRunning` | 8.0% | 8.2% |
| `hasTravelledWell` | 1.4% | 2.8% |
| `hasWeakened` | **53.2%** | **25.5%** |
| `hasGreenness` | **8.6%** | **0.4%** |

The categories are not equally reachable because the phrase lists are
Racing Post idiom. Phrases that fire on the CSV and **never** on the API:
`hung left` (82), `hung right` (67), `green` (27), `awkward start` (25),
`reluctant` (7), `going easily` (8). Phrases that fire on the API and **never**
on the CSV: `dropped away` (489), `faded` (260), `boxed in` (45),
`never a factor` (37), `never a threat` (25), `in command` (13), `checked` (12),
`found little` (12), `travelling strongly` (12).

Consequence: a horse whose recent runs were captured from the API gets a
systematically *lower* `excuseScore` and a near-zero greenness rate versus one
whose history came from the CSV, purely from source, not from performance. Any
lexicon work should extend the phrase lists with the API idiom above before the
API-era share of history grows.

---

## 4. RacingAPI fields the CSV has no counterpart for

Everything here is unobtainable from the Kaggle dataset at any price.

**Identity/joins** — `horse_id`, `jockey_id`, `trainer_id`, `owner_id`,
`sire_id`, `dam_id`, `damsire_id`, `course_id`, `race_id` (as a stable key).
The CSV's only joinable keys are names, which is exactly why the punctuation
differences in §2 matter.

**Results extras** — `sp_dec`, `weight_lbs`, `jockey_claim_lbs`, `off_dt`,
`dist_y`, `dist_m`, `dist_f`, `surface`, `jumps`, `winning_time_detail`,
`non_runners`, `comments` (stewards), `tote_win`/`tote_pl`/`tote_ex`/`tote_csf`/
`tote_tricast`/`tote_trifecta`, `silk_url`, `performance_rating`, `speed_rating`.
`bsp` too, but that needs the Standard plan.

**Pre-race only (racecards)** — `form`, `last_run`, `ofr` as a *pre-race* mark,
`colour`, `dob`, `breeder`, `region` (horse's breeding region),
`sire_region`/`dam_region`/`damsire_region`, `trainer_location`,
`trainer_14_days`, `trainer_rtf`, `prev_trainers`, `prev_owners`, `medical`,
`headgear_run`, `wind_surgery`, `wind_surgery_run`, `past_results_flags`,
`quotes`, `stable_tour`, `going_detailed`, `stalls`, `weather`, `big_race`,
`is_abandoned`, `race_status`, `field_size`.

The structural point: **the CSV is results-only.** It contains no pre-race
declaration state at all, so nothing in it can be used to reconstruct what was
knowable before a race — which is what a model needs. Everything the CSV
carries describes the race after it was run.

Going the other way, **only `ran` has no API counterpart**, and it's trivially
derivable from the runners array.

---

## 5. Field population is complementary, and that's a live problem

Same collection, same schema, two sources — measured on the real Atlas data:

| Runner field | CSV-era (`raceform.csv`, 2015 → 2026-05-27) | API-era (`/results/today`, ≥ 2026-07-01) |
|---|---|---|
| `rpr` | 90% (6,817/7,573 in May 2026) | **0%** (0/4,221) |
| `ts` | 89% | **0%** |
| `comment` | **0%** (field absent entirely) | 84% (3,551/4,221) |
| `officialRating` | ~78% | 83% |
| `hg` | ~37% | 37% |

The mirror image is exact and both halves have a cause:

- `rpr`/`ts` are empty on the API side because RacingAPI removed those fields in
  June 2026 (see `README-racing-api-fields.md` Gotcha 2). `performance_rating` /
  `speed_rating` carry the data now and no mapper reads them.
- `comment` is absent on the CSV side of *production* because
  `import-industry-sp.ts` only started mapping it on **2026-07-25** (commit
  `92e38b1`) and the full import has not been re-run since. The source column is
  there — `mini-update.csv` is 80% populated — so a reseed would fill it.

So `horseAvgRPR`/`horseAvgTS` decay to null for anything after June 2026, and
the comment-derived features are null for everything *before* July 2026. No
runner in the collection currently has both.

### One more sampling artefact worth knowing

In `mini-update.csv` — a freshly-published week — `rpr` is only **24%** filled
on GB rows and `ts` **70%**, against ~90% for both in the settled `raceform.csv`
history. Racing Post backfills those ratings after publication. Don't measure
rating coverage from a recent-week snapshot and conclude the dataset is sparse.

---

## 6. Normalisation checklist

If you ever need to match a CSV row to an API record, or pool them:

1. **Strip the country suffix** from `horse`/`sire`/`dam` before comparing to
   `/racecards` (but not to `/results`, which keeps it).
2. **Re-insert apostrophes** — or strip them from both sides. The CSV has zero
   apostrophes anywhere; the API uses them in horses (158), dams (107), race
   names (109), trainers, jockeys, damsires.
3. **Strip periods from initials** (`K. R. Burke` → `K R Burke`) and normalise
   `&` (present in CSV trainers, absent from CSV owners, present in both API).
4. **Strip the jockey claim** `(3)`/`(5)`/`(7)` from racecard jockey names.
5. **Case-fold.** The results feed re-cases some names: `Mister Mcgregor`,
   `Hk Fourteen`, `Parole D'oro` vs CSV `Mister McGregor`, `HK Fourteen`,
   `Parole dOro`.
6. **`off`: convert the CSV's 24-hour clock or the API's 12-hour clock**; never
   compare them raw. Prefer `off_dt`.
7. **Null tokens**: en dash `–` (CSV ratings), `-` (racecard `ofr`, CSV
   `time`/`ovr_btn`), empty string (results). `toNullableRating()` covers the
   first two.
8. **`Evens` ↔ `1/1`** before comparing any stored `ispFraction`.
9. **Weight**: `parseWeightPounds("9-2")` = 128 = the API's `lbs`/`weight_lbs`.
10. **Headgear**: strip the CSV's trailing `1` before comparing codes, and
    remember that first-run information has no home on the free API feed.
11. **Country**: the CSV can only be regionalised via the course allowlist in
    `course-country.ts`; there is no region column to trust.

## 7. Reproducing this

```bash
# CSV side (the file is gitignored — see data/README.md to re-download)
python3 -c "import csv,collections; rows=list(csv.DictReader(open('data/kaggle-horse-racing-uk-ireland/extracted/mini-update.csv'))); print(collections.Counter(r['hg'] for r in rows if r['hg']).most_common())"

# API side, as captured (read-only queries against Atlas)
mongosh "$MONGODB_URI/betfair_nlp" --quiet --eval '
  db.industry_starting_prices.aggregate([{$match:{raceDate:{$gte:"2026-07-01"}}},
    {$unwind:"$runners"},{$group:{_id:"$runners.hg",n:{$sum:1}}},{$sort:{n:-1}}])'

# Field definitions
curl -s https://api.theracingapi.com/openapi.json | jq '.components.schemas.app__models__result__RunnerBasic.properties'
```

Raw API responses would be better than Atlas read-back for the spec-only rows in
§2 (`btn`, `time`, `prize`, `sex_rest`, `sp_dec`). That needs
`racingApi.username`/`password` in `config/local.json`, which no checkout on
this VM currently has.
