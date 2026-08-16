# The Racing API — full field reference

Everything `https://api.theracingapi.com/v1` exposes, and which of it this
repo actually consumes. Generated from the API's own OpenAPI spec
(`The Racing API 1.4.4`), not from memory or from what
happened to come back in one sample response — regenerate with:

```bash
curl -s https://api.theracingapi.com/openapi.json | jq '.components.schemas'
```

Client wrapper: `src/lib/service/racing-api-client.ts` (HTTP Basic auth,
returns `{status, ok, body}` rather than throwing, so plan-gated 401s stay
distinguishable from outages). Live smoke tests:
`src/lib/service/__tests__/racing-api-smoke.live.test.ts` (`npm run
test:racing-api-live`).

For how these fields line up against the Kaggle CSV that seeds the same
collection — which names match but mean different things, and how the actual
values differ — see `README-kaggle-vs-racingapi-fields.md`.

## What we call, and on which plan

| Consumer | Endpoint | Config key / env |
|---|---|---|
| `DailyRaceService.ingestFromRacingApi` (06:00 UTC daily-races cron) | `/racecards/free` | `racingApi.racecardsPath` / `RACINGAPI_RACECARDS_PATH` |
| `IndustrySpResultsCaptureService.captureTodayResults` (21:30 UTC results cron) | `/results/today` | `racingApi.resultsPath` / `RACINGAPI_RESULTS_PATH` |

The account is on the **Basic** plan. `/results/today` works; dated
`/results` and `/results/{race_id}` need Standard, and
`/racecards/standard`/`/racecards/pro` need their own tiers.

Naming trap worth internalising before reading anything below:
**`/racecards/free` returns the schema called `RacecardBasic`;
`/racecards/basic` returns the richer schema called `Racecard`.**

### Gotcha 1: we're on Basic but still ingesting the Free racecard feed

Neither `RACINGAPI_RACECARDS_PATH` nor `RACINGAPI_RESULTS_PATH` is set on the
deployed Lambda (`apps/lambda/build.sh` doesn't ship them), so both consumers
fall back to their code defaults — which for racecards is `/racecards/free`,
not `/racecards/basic`.

That matters because `mapRacecardToDoc` (`src/lib/dao/daily-race-dao.ts`)
reads six runner fields that **don't exist on the free feed**: `rpr`, `ts`,
`comment`, `spotlight`, `trainer_14_days`, `trainer_rtf`. Confirmed empty in
Atlas on today's ingest (2026-08-12, `rac_32294141867`): `rpr: null, ts:
null, spotlight: "", comment: "", trainerRtf: null, trainer14Days: null` —
while free-tier fields on the same runner (`form: "159542"`, `ofr: "86"`,
`colour: "ch"`) are populated.

Setting `RACINGAPI_RACECARDS_PATH=/racecards/basic` on the Lambda fills
`comment`, `trainer_14_days` and `trainer_rtf` with no code change — but
**not** `rpr`/`ts`/`spotlight`, for the reason in Gotcha 2.

### Gotcha 2: `rpr`, `ts`/`tsr` and `spotlight` were removed by the API in June 2026

The spec marks these as permanently empty on every plan, replaced by
`performance_rating` and `speed_rating`:

| Removed field | Where | Replacement |
|---|---|---|
| `rpr` | racecard runner, result runner | `performance_rating` |
| `ts` (racecard) / `tsr` (result) | racecard runner, result runner | `speed_rating` |
| `spotlight` | racecard runner | `comment` |
| `quotes`, `stable_tour` | racecard runner | — (always empty arrays) |
| `rail_movements` | racecard race | — (empty since June 2026, may return) |

This is a live regression in our data, not a hypothetical: the 21:30 UTC
results capture writes `RunnerDoc.rpr`/`ts` from these fields, so every race
captured via the API since the removal has `rpr: null, ts: null`, while the
CSV-imported history still has real values. Verified in Atlas:

```
2026-08-01 (API-captured):  { rpr: null, ts: null, or: 98,  isp: 2.25 }
2026-05-01 (CSV-imported):  { rpr: 88,   ts: 82,   or: 78 }
```

`daily-race-feature-service.ts` derives `horseAvgRPR` / `horseAvgTS` model
features from those columns, so their coverage decays for anything after
June 2026 until the mapper is pointed at `performance_rating`/`speed_rating`
instead (both available on `/results/today`, i.e. our current plan and
endpoint).

## Endpoint catalogue (58 endpoints)

**Racecards**

| Endpoint | Response schema | Used here |
|---|---|---|
| `/v1/racecards/free` | `RacecardsBasicPage` | ✅ |
| `/v1/racecards/basic` | `RacecardsPage` | — |
| `/v1/racecards/standard` | `RacecardsOddsPage` | — |
| `/v1/racecards/pro` | `RacecardsOddsProPage` | — |
| `/v1/racecards/big-races` | `RacecardsOddsPage` | — |
| `/v1/racecards/summaries` | `RacecardsSummary` | — |
| `/v1/racecards/{horse_id}/results` | `ResultsBasicPage` | — |
| `/v1/racecards/{race_id}/standard` | `RacecardOdds` | — |
| `/v1/racecards/{race_id}/pro` | `RacecardOddsPro` | — |

**Results**

| Endpoint | Response schema | Used here |
|---|---|---|
| `/v1/results` | `ResultsStandardPage` | — |
| `/v1/results/today` | `ResultsBasicPage` | ✅ |
| `/v1/results/today/free` | `ResultsFreePage` | — |
| `/v1/results/{race_id}` | `ResultStandard` | — |

**Odds**

| Endpoint | Response schema | Used here |
|---|---|---|
| `/v1/odds/{race_id}/{horse_id}` | `RaceRunnerOdds` | — |

**Courses**

| Endpoint | Response schema | Used here |
|---|---|---|
| `/v1/courses` | `CoursesPage` | smoke test only |
| `/v1/courses/regions` | `array<Region>` | — |

**Horses**

| Endpoint | Response schema | Used here |
|---|---|---|
| `/v1/horses/search` | `Horses` | — |
| `/v1/horses/{horse_id}/results` | `ResultsStandardPage` | — |
| `/v1/horses/{horse_id}/standard` | `Horse` | — |
| `/v1/horses/{horse_id}/pro` | `HorsePro` | — |
| `/v1/horses/{horse_id}/analysis/distance-times` | `HorseDistanceTimeAnalysis` | — |

**Jockeys**

| Endpoint | Response schema | Used here |
|---|---|---|
| `/v1/jockeys/search` | `Jockeys` | — |
| `/v1/jockeys/{jockey_id}/results` | `ResultsStandardPage` | — |
| `/v1/jockeys/{jockey_id}/analysis/courses` | `JockeyCourseAnalysis` | — |
| `/v1/jockeys/{jockey_id}/analysis/distances` | `JockeyDistanceAnalysis` | — |
| `/v1/jockeys/{jockey_id}/analysis/owners` | `JockeyOwnerAnalysis` | — |
| `/v1/jockeys/{jockey_id}/analysis/trainers` | `JockeyTrainerAnalysis` | — |

**Trainers**

| Endpoint | Response schema | Used here |
|---|---|---|
| `/v1/trainers/search` | `Trainers` | — |
| `/v1/trainers/{trainer_id}/results` | `ResultsStandardPage` | — |
| `/v1/trainers/{trainer_id}/analysis/courses` | `TrainerCourseAnalysis` | — |
| `/v1/trainers/{trainer_id}/analysis/distances` | `TrainerDistanceAnalysis` | — |
| `/v1/trainers/{trainer_id}/analysis/horse-age` | `TrainerHorseAgeAnalysis` | — |
| `/v1/trainers/{trainer_id}/analysis/jockeys` | `TrainerJockeyAnalysis` | — |
| `/v1/trainers/{trainer_id}/analysis/owners` | `TrainerOwnerAnalysis` | — |

**Owners**

| Endpoint | Response schema | Used here |
|---|---|---|
| `/v1/owners/search` | `Owners` | — |
| `/v1/owners/{owner_id}/results` | `ResultsStandardPage` | — |
| `/v1/owners/{owner_id}/analysis/courses` | `OwnerCourseAnalysis` | — |
| `/v1/owners/{owner_id}/analysis/distances` | `OwnerDistanceAnalysis` | — |
| `/v1/owners/{owner_id}/analysis/jockeys` | `OwnerJockeyAnalysis` | — |
| `/v1/owners/{owner_id}/analysis/trainers` | `OwnerTrainerAnalysis` | — |

**Sires / dams / damsires**

| Endpoint | Response schema | Used here |
|---|---|---|
| `/v1/sires/search` | `Sires` | — |
| `/v1/sires/{sire_id}/results` | `ResultsStandardPage` | — |
| `/v1/sires/{sire_id}/analysis/classes` | `SireClassAnalysis` | — |
| `/v1/sires/{sire_id}/analysis/distances` | `SireDistanceAnalysis` | — |
| `/v1/dams/search` | `Dams` | — |
| `/v1/dams/{dam_id}/results` | `ResultsStandardPage` | — |
| `/v1/dams/{dam_id}/analysis/classes` | `DamClassAnalysis` | — |
| `/v1/dams/{dam_id}/analysis/distances` | `DamDistanceAnalysis` | — |
| `/v1/damsires/search` | `Damsires` | — |
| `/v1/damsires/{damsire_id}/results` | `ResultsStandardPage` | — |
| `/v1/damsires/{damsire_id}/analysis/classes` | `DamsireClassAnalysis` | — |
| `/v1/damsires/{damsire_id}/analysis/distances` | `DamsireDistanceAnalysis` | — |

**North America**

| Endpoint | Response schema | Used here |
|---|---|---|
| `/v1/north-america/meets` | `Meets` | — |
| `/v1/north-america/meets/{meet_id}/entries` | `Entries` | — |
| `/v1/north-america/meets/{meet_id}/results` | `Results` | — |

**Australia**

| Endpoint | Response schema | Used here |
|---|---|---|
| `/v1/australia/meets` | `Meets` | — |
| `/v1/australia/meets/{meet_id}/races` | `Races` | — |
| `/v1/australia/meets/{meet_id}/races/{race_number}` | `Race` | — |

---

## Racecards

### `/racecards/free` → `RacecardBasic` (race level)

| Field | Type | Used | Description |
|---|---|---|---|
| `race_id` | string | ✅ | Unique identifier for the race, prefixed `rac_`. |
| `course` | string | ✅ | Racecourse name. Non-GB courses carry a country suffix, e.g. `Ballinrobe (IRE)`. |
| `date` | string | ✅ | Date of the race, `YYYY-MM-DD`, in local track time. |
| `off_time` | string | ✅ | Scheduled off time as shown on the racecard, local track time, 12-hour clock without meridiem, e.g. `2:15`. |
| `off_dt` | string? | ✅ | Scheduled off time as a timezone-aware ISO 8601 datetime, e.g. `2026-08-04T14:15:00+01:00`. Prefer this over `off_time` and `date` for any time arithmetic. |
| `race_name` | string | ✅ | Full race title, including sponsor. |
| `distance_f` | string | ✅ | Exact race distance in furlongs as a decimal string, e.g. `7.0`. |
| `region` | string | ✅ | Region code for the racecourse, e.g. `GB`, `IRE`. |
| `pattern` | string | — | Pattern or graded status where applicable, e.g. `Group 1`, `Listed`. Empty for ordinary races. |
| `race_class` | string | ✅ | Official race class, e.g. `Class 3`. Empty where the racing authority does not class the race, which includes most Irish racing. |
| `type` | string | ✅ | Race type, e.g. `Flat`, `Hurdle`, `Chase`, `NH Flat`. |
| `age_band` | string | ✅ | Age restriction on entry, e.g. `2yo`, `4yo+`. |
| `rating_band` | string | — | Official rating band for a handicap, e.g. `0-100`. Empty for non-handicaps. |
| `sex_restriction` | string? | — | Sex restriction on entry, e.g. `F&M` for fillies and mares. Empty when the race is open. |
| `prize` | string | ✅ | Prize money to the winner, as a formatted string including the currency symbol, e.g. `£6,804`. |
| `field_size` | string | ✅ | Number of declared runners, as a string. |
| `going` | string | ✅ | Standardised official going, e.g. `Good To Firm`. |
| `surface` | string? | ✅ | Racing surface, e.g. `Turf`, `AW`. |
| `runners` | array&lt;RunnerBasic&gt; | ✅ | Declared runners. Non-runners remain in the array with `number` set to `NR`. |
| `race_status` | string? | — | Current status of the race: `entry` once entries are published, `declared` once final declarations are made, `result` once a result has been published. May be empty on older racecards. |

### `/racecards/free` → `RunnerBasic` (runner level, 26 fields)

| Field | Type | Used | Description |
|---|---|---|---|
| `horse` | string | ✅ | Horse name. Non-GB-bred horses carry a country suffix, e.g. `Mephisto (IRE)`. |
| `horse_id` | string | ✅ | Unique identifier for the horse, prefixed `hrs_`. |
| `age` | string | ✅ | Age in years at the date of the race, as a string. |
| `sex` | string? | ✅ | Sex in full, e.g. `gelding`, `filly`, `colt`, `mare`. |
| `sex_code` | string? | ✅ | Single-letter sex code, e.g. `G`, `F`, `C`, `M`. |
| `colour` | string? | ✅ | Coat colour abbreviation, e.g. `b` bay, `gr` grey, `ch` chestnut. |
| `region` | string | ✅ | Region the horse was bred in, e.g. `GB`, `IRE`, `USA`. |
| `dam` | string | ✅ | The horse's dam. |
| `dam_id` | string | ✅ | Unique identifier for the dam, prefixed `dam_`. |
| `sire` | string | ✅ | The horse's sire. |
| `sire_id` | string | ✅ | Unique identifier for the sire, prefixed `sir_`. |
| `damsire` | string | ✅ | The dam's sire. |
| `damsire_id` | string | ✅ | Unique identifier for the damsire, prefixed `dsi_`. |
| `trainer` | string | ✅ | Current trainer of the horse. |
| `trainer_id` | string | ✅ | Unique identifier for the trainer, prefixed `trn_`. |
| `owner` | string | ✅ | Current owner of the horse. |
| `owner_id` | string | ✅ | Unique identifier for the owner, prefixed `own_`. |
| `number` | string | ✅ | Saddlecloth number. `NR` marks a non-runner — check this before treating the entry as a live runner. |
| `draw` | string | ✅ | Stall number for flat races. Empty for jumps racing. |
| `headgear` | string? | ✅ | Headgear worn, as a letter code, e.g. `b` blinkers, `v` visor, `t` tongue tie, `h` hood, `p` cheekpieces. Empty when none. |
| `lbs` | string | ✅ | Weight to be carried, in pounds. |
| `ofr` | string | ✅ | Official handicap rating (the horse's mark). `-` when the horse is unrated. |
| `jockey` | string | ✅ | Booked jockey. A claim is shown in brackets after the name, e.g. `Adam Tracey(7)`. |
| `jockey_id` | string | ✅ | Unique identifier for the jockey, prefixed `jky_`. |
| `last_run` | string | ✅ | Days since the horse last ran. Empty for a horse that has not run before. |
| `form` | string? | ✅ | Recent finishing positions, most recent last. `-` separates seasons and `/` separates years off. Empty for an unraced horse. |

### `/racecards/basic` → `Racecard` (race level)

Adds to the free race shape: `course_id`, `distance_round`, `distance`, `going_detailed`, `rail_movements`, `stalls`, `weather`, `big_race`, `is_abandoned`.

| Field | Type | Used | Description |
|---|---|---|---|
| `race_id` | string | ✅ | Unique identifier for the race, prefixed `rac_`. |
| `course` | string | ✅ | Racecourse name. Non-GB courses carry a country suffix, e.g. `Ballinrobe (IRE)`. |
| `course_id` **(new)** | string | — | Unique identifier for the racecourse, prefixed `crs_`. |
| `date` | string | ✅ | Date of the race, `YYYY-MM-DD`, in local track time. |
| `off_time` | string | ✅ | Scheduled off time as shown on the racecard, local track time, 12-hour clock without meridiem, e.g. `2:15`. |
| `off_dt` | string? | ✅ | Scheduled off time as a timezone-aware ISO 8601 datetime, e.g. `2026-08-04T14:15:00+01:00`. Prefer this over `off_time` and `date` for any time arithmetic. |
| `race_name` | string | ✅ | Full race title, including sponsor. |
| `distance_round` **(new)** | string | — | Race distance rounded to the nearest furlong, e.g. `7f`. |
| `distance` **(new)** | string | — | Exact race distance in miles, furlongs and yards, e.g. `0m7f6y`. The miles component is always present, including when zero. |
| `distance_f` | string | ✅ | Exact race distance in furlongs as a decimal string, e.g. `7.0`. |
| `region` | string | ✅ | Region code for the racecourse, e.g. `GB`, `IRE`. |
| `pattern` | string | — | Pattern or graded status where applicable, e.g. `Group 1`, `Listed`. Empty for ordinary races. |
| `sex_restriction` | string? | — | Sex restriction on entry, e.g. `F&M` for fillies and mares. Empty when the race is open. |
| `race_class` | string | ✅ | Official race class, e.g. `Class 3`. Empty where the racing authority does not class the race, which includes most Irish racing. |
| `type` | string | ✅ | Race type, e.g. `Flat`, `Hurdle`, `Chase`, `NH Flat`. |
| `age_band` | string | ✅ | Age restriction on entry, e.g. `2yo`, `4yo+`. |
| `rating_band` | string | — | Official rating band for a handicap, e.g. `0-100`. Empty for non-handicaps. |
| `prize` | string | ✅ | Prize money to the winner, as a formatted string including the currency symbol, e.g. `£6,804`. |
| `field_size` | string | ✅ | Number of declared runners, as a string. |
| `going_detailed` **(new)** | string? | — | The racecourse's own detailed going description, which may vary by section of track, e.g. `GOOD TO FIRM, Good in places`. Empty when not published. |
| `rail_movements` **(new)** | string? | — | **Not populated since June 2026.** Always returns an empty string. May return in a future release. |
| `stalls` **(new)** | string? | — | Stalls position for flat races, e.g. `6f - Inside; Remainder - Centre`. Empty when not published or not applicable. |
| `weather` **(new)** | string? | — | Weather at the course, e.g. `Overcast`. Empty when not published. |
| `going` | string | ✅ | Standardised official going, e.g. `Good To Firm`. |
| `surface` | string? | ✅ | Racing surface, e.g. `Turf`, `AW`. |
| `runners` | array&lt;Runner&gt; | ✅ | Declared runners. Non-runners remain in the array with `number` set to `NR`. |
| `big_race` **(new)** | boolean? | — | `true` when the race is one of our featured races. |
| `is_abandoned` **(new)** | boolean? | — | `true` when the race has been abandoned. |
| `race_status` | string? | — | Current status of the race: `entry` once entries are published, `declared` once final declarations are made, `result` once a result has been published. May be empty on older racecards. |

### `/racecards/basic` → `Runner` (runner level, 50 fields)

Adds to the free runner shape: `dob`, `breeder`, `dam_region`, `sire_region`, `damsire_region`, `trainer_location`, `trainer_14_days`, `prev_trainers`, `prev_owners`, `comment`, `spotlight`, `quotes`, `stable_tour`, `medical`, `headgear_run`, `wind_surgery`, `wind_surgery_run`, `past_results_flags`, `rpr`, `ts`, `performance_rating`, `speed_rating`, `silk_url`, `trainer_rtf`.

| Field | Type | Used | Description |
|---|---|---|---|
| `horse_id` | string | ✅ | Unique identifier for the horse, prefixed `hrs_`. |
| `horse` | string | ✅ | Horse name. Non-GB-bred horses carry a country suffix, e.g. `Mephisto (IRE)`. |
| `dob` **(new)** | string? | — | Date of birth, `YYYY-MM-DD`. |
| `age` | string? | ✅ | Age in years at the date of the race, as a string. |
| `sex` | string? | ✅ | Sex in full, e.g. `gelding`, `filly`, `colt`, `mare`. |
| `sex_code` | string? | ✅ | Single-letter sex code, e.g. `G`, `F`, `C`, `M`. |
| `colour` | string? | ✅ | Coat colour abbreviation, e.g. `b` bay, `gr` grey, `ch` chestnut. |
| `region` | string? | ✅ | Region the horse was bred in, e.g. `GB`, `IRE`, `USA`. |
| `breeder` **(new)** | string? | — | Name of the breeder. Empty when not published. |
| `dam` | string | ✅ | The horse's dam. |
| `dam_id` | string | ✅ | Unique identifier for the dam, prefixed `dam_`. |
| `dam_region` **(new)** | string? | — | Region the dam was bred in. |
| `sire` | string | ✅ | The horse's sire. |
| `sire_id` | string | ✅ | Unique identifier for the sire, prefixed `sir_`. |
| `sire_region` **(new)** | string? | — | Region the sire was bred in. |
| `damsire` | string | ✅ | The dam's sire. |
| `damsire_id` | string | ✅ | Unique identifier for the damsire, prefixed `dsi_`. |
| `damsire_region` **(new)** | string? | — | Region the damsire was bred in. |
| `trainer` | string | ✅ | Current trainer of the horse. |
| `trainer_id` | string | ✅ | Unique identifier for the trainer, prefixed `trn_`. |
| `trainer_location` **(new)** | string? | — | The trainer's base, e.g. `Newmarket, Suffolk`. |
| `trainer_14_days` **(new)** | RunnerTrainer14Days? | ✅ | The trainer's record over the last 14 days: `runs`, `wins` and strike rate `percent`. |
| `owner` | string | ✅ | Current owner of the horse. |
| `owner_id` | string | ✅ | Unique identifier for the owner, prefixed `own_`. |
| `prev_trainers` **(new)** | array<RunnerPrevTrainer>? | — | Previous trainers, each with the date the horse changed yard. |
| `prev_owners` **(new)** | array<RunnerPrevOwner>? | — | Previous owners, each with the date the horse changed hands. |
| `comment` **(new)** | string? | ✅ | Our analyst's pre-race note on the runner. Empty when we have no note. |
| `spotlight` **(new)** | string? | ✅ | **Removed June 2026.** Always returns an empty string. Use `comment` for a pre-race analyst note on the runner. |
| `quotes` **(new)** | array<RunnerQuote>? | — | **Removed June 2026.** Always returns an empty array. |
| `stable_tour` **(new)** | array<RunnerStableTour>? | — | **Removed June 2026.** Always returns an empty array. |
| `medical` **(new)** | array<RunnerMedical>? | — | Reported medical procedures, each with a `date` and a `type`, e.g. wind surgery. |
| `number` | string | ✅ | Saddlecloth number. `NR` marks a non-runner — check this before treating the entry as a live runner. |
| `draw` | string | ✅ | Stall number for flat races. Empty for jumps racing. |
| `headgear` | string? | ✅ | Headgear worn, as a letter code, e.g. `b` blinkers, `v` visor, `t` tongue tie, `h` hood, `p` cheekpieces. Empty when none. |
| `headgear_run` **(new)** | string? | — | `1` when this is the first run in this headgear. Empty otherwise. |
| `wind_surgery` **(new)** | string? | — | Wind surgery code where the horse has had a procedure. Empty when none. |
| `wind_surgery_run` **(new)** | string? | — | `1` when this is the first run since wind surgery. Empty otherwise. |
| `past_results_flags` **(new)** | array<string>? | — | Course and distance form flags, e.g. `C` course winner, `D` distance winner, `CD` course and distance winner, `BF` beaten favourite last time out. |
| `lbs` | string | ✅ | Weight to be carried, in pounds. |
| `ofr` | string | ✅ | Official handicap rating (the horse's mark). `-` when the horse is unrated. |
| `rpr` **(new)** | string | ✅ | **Removed June 2026.** Always returns an empty string. Use `performance_rating` for a performance figure. |
| `ts` **(new)** | string | ✅ | **Removed June 2026.** Always returns an empty string. Use `speed_rating` for a speed figure. |
| `performance_rating` **(new)** | string? | — | Our performance rating for the horse, as a whole number. `-` when we have no rating, which includes unraced horses. |
| `speed_rating` **(new)** | string? | — | Our speed rating for the horse, as a whole number. `-` when we have no rating. |
| `jockey` | string | ✅ | Booked jockey. A claim is shown in brackets after the name, e.g. `Adam Tracey(7)`. |
| `jockey_id` | string | ✅ | Unique identifier for the jockey, prefixed `jky_`. |
| `silk_url` **(new)** | string? | — | URL of the owner's silks as an image. |
| `last_run` | string | ✅ | Days since the horse last ran. Empty for a horse that has not run before. |
| `form` | string? | ✅ | Recent finishing positions, most recent last. `-` separates seasons and `/` separates years off. Empty for an unraced horse. |
| `trainer_rtf` **(new)** | string? | ✅ | Our trainer "run to form" figure, 0-100, as a percentage of the trainer's recent runners performing to expectation. Empty when we have no figure. |

### `/racecards/standard` and `/racecards/pro`

Identical race/runner shape to `/racecards/basic` plus one runner field:
`odds` — an array of per-bookmaker prices (`OddsNoHistory` on standard,
`OddsHistory` on pro, which adds a `history` array of prior prices).

| Field | Type | Used | Description |
|---|---|---|---|
| `bookmaker` | string | — | Bookmaker or exchange the price is from. |
| `fractional` | string | — | Price in fractional form, e.g. `15/8`. For exchanges this is a decimal number rather than a fraction. |
| `decimal` | string | — | Price in decimal form, e.g. `2.88`. |
| `ew_places` | string | — | Number of places paid each way. Empty for exchanges. |
| `ew_denom` | string | — | Each-way fraction denominator, e.g. `4` for one quarter the odds. Empty for exchanges. |
| `updated` | string | — | When this price was last captured, `YYYY-MM-DD HH:MM:SS`, UK local time. |
| `history` | array<any>? | — | Previous prices from this bookmaker for this runner, oldest first. Pro plan only. |

---

## Results

### `/results/today` → `ResultBasic` (race level)

| Field | Type | Used | Description |
|---|---|---|---|
| `race_id` | string | ✅ | Unique identifier for the race, prefixed `rac_`. |
| `date` | string | ✅ | Date of the race, `YYYY-MM-DD`, in local track time. |
| `region` | string | ✅ | Region code for the racecourse, e.g. `GB`, `IRE`. |
| `course` | string | ✅ | Racecourse name. Non-GB courses carry a country suffix, e.g. `Ballinrobe (IRE)`. |
| `course_id` | string | — | Unique identifier for the racecourse, prefixed `crs_`. |
| `off` | string | ✅ | Scheduled off time, local track time, 12-hour clock without meridiem, e.g. `8:25`. |
| `off_dt` | string? | — | Scheduled off time as a timezone-aware ISO 8601 datetime. Prefer this over `off` and `date` for any time arithmetic. |
| `race_name` | string | ✅ | Full race title, including sponsor. |
| `type` | string | ✅ | Race type, e.g. `Flat`, `Hurdle`, `Chase`. |
| `class` | string | ✅ | Official race class, e.g. `Class 3`. Empty where the racing authority does not class the race. |
| `pattern` | string | — | Pattern or graded status where applicable. Empty for ordinary races. |
| `rating_band` | string | — | Official rating band for a handicap, e.g. `0-100`. Empty for non-handicaps. |
| `age_band` | string | — | Age restriction on entry, e.g. `4yo+`. |
| `sex_rest` | string | — | Sex restriction on entry. Empty when the race is open. |
| `dist` | string | ✅ | Race distance in miles and furlongs, e.g. `2m7f`. |
| `dist_y` | string | — | Race distance in yards. |
| `dist_m` | string | — | Race distance in metres. |
| `dist_f` | string | — | Race distance in furlongs, e.g. `23f`. |
| `going` | string | ✅ | Official going, e.g. `Good`. |
| `surface` | string? | — | Racing surface, e.g. `Turf`, `AW`. |
| `jumps` | string? | — | Description of the obstacles jumped, e.g. `12 hurdles`. Empty for flat races. |
| `runners` | array&lt;RunnerBasic&gt; | ✅ | Runners, in finishing order. |
| `winning_time_detail` | string? | — | Winning time with the comparison to standard, e.g. `5m 44.90s (slow by 7.90s)`. |
| `comments` | string? | — | Official race-level comments from the racing authority, such as stewards' notes. Empty when none. |
| `non_runners` | string? | — | Declared non-runners, with the reason in brackets where given. |
| `tote_win` | string? | — | Tote win dividend to a unit stake, including the currency symbol. |
| `tote_pl` | string? | — | Tote place dividends, one per placed horse, space separated. |
| `tote_ex` | string? | — | Tote Exacta dividend. |
| `tote_csf` | string? | — | Computer Straight Forecast dividend. |
| `tote_tricast` | string? | — | Computer Tricast dividend. Empty when the race did not qualify. |
| `tote_trifecta` | string? | — | Tote Trifecta dividend. Empty when not offered on the race. |

### `/results/today` → `RunnerBasic` (runner level, 36 fields)

| Field | Type | Used | Description |
|---|---|---|---|
| `horse_id` | string | ✅ | Unique identifier for the horse, prefixed `hrs_`. |
| `horse` | string | ✅ | Horse name. Non-GB-bred horses carry a country suffix, e.g. `Mephisto (IRE)`. |
| `sp` | string | ✅ | Starting price in fractional form, e.g. `15/2`. |
| `sp_dec` | string | — | Starting price in decimal form, e.g. `8.50`. |
| `number` | string | ✅ | Saddlecloth number. |
| `position` | string | ✅ | Finishing position. Non-completions are given as a code, e.g. `PU` pulled up, `F` fell, `UR` unseated rider, `DSQ` disqualified. |
| `draw` | string | ✅ | Stall number for flat races. Empty for jumps racing. |
| `btn` | string | — | Lengths beaten by the horse that finished immediately in front. `0` for the winner. |
| `ovr_btn` | string | ✅ | Cumulative lengths beaten by the winner. `0` for the winner. |
| `age` | string | ✅ | Age in years at the date of the race, as a string. |
| `sex` | string | ✅ | Single-letter sex code, e.g. `G`, `F`, `C`, `M`. |
| `weight` | string | — | Weight carried in stones and pounds, e.g. `11-12`. |
| `weight_lbs` | string | ✅ | Weight carried in pounds. |
| `headgear` | string | ✅ | Headgear worn, as a letter code, e.g. `b` blinkers, `v` visor, `t` tongue tie, `h` hood, `p` cheekpieces. Empty when none. |
| `time` | string | — | The horse's finishing time, e.g. `5:44.90`. |
| `or` | string | ✅ | Official handicap rating carried in this race. Empty when the horse was unrated. |
| `rpr` | string | ✅ | **Removed June 2026.** Always returns an empty string. Use `performance_rating` for a performance figure. |
| `tsr` | string | ✅ | **Removed June 2026.** Always returns an empty string. Use `speed_rating` for a speed figure. |
| `prize` | string | — | Prize money won by this horse, including the currency symbol. Empty when the horse was unplaced. |
| `jockey` | string | ✅ | Jockey who rode. |
| `jockey_claim_lbs` | string? | — | Weight allowance claimed by the jockey, in pounds. `0` when none. |
| `jockey_id` | string | — | Unique identifier for the jockey, prefixed `jky_`. |
| `trainer` | string | ✅ | Trainer of the horse. |
| `trainer_id` | string | — | Unique identifier for the trainer, prefixed `trn_`. |
| `owner` | string | — | Owner of the horse. |
| `owner_id` | string | — | Unique identifier for the owner, prefixed `own_`. |
| `sire` | string | — | The horse's sire. |
| `sire_id` | string | — | Unique identifier for the sire, prefixed `sir_`. |
| `dam` | string | — | The horse's dam. |
| `dam_id` | string | — | Unique identifier for the dam, prefixed `dam_`. |
| `damsire` | string | — | The dam's sire. |
| `damsire_id` | string | — | Unique identifier for the damsire, prefixed `dsi_`. |
| `comment` | string | ✅ | Our analyst's post-race note on the runner's performance. Empty when we have no note. |
| `silk_url` | string? | — | URL of the owner's silks as an image. |
| `performance_rating` | string? | — | Our performance rating for this run, as a whole number. `-` when we have no rating. |
| `speed_rating` | string? | — | Our speed rating for this run, as a whole number. `-` when we have no rating. |

### `/results` and `/results/{race_id}` → `ResultStandard` / `RunnerStandard` (Standard plan)

Same race shape as `ResultBasic`. The runner shape adds exactly one field —
and it's a notable one:

- `bsp` — BSP. Empty when unavailable. Standard and Pro plans only.

`/results/today/free` returns the thinner `ResultFree` / `RunnerFree` shape
(no `sp`, no `rpr`/`tsr`, no `comment`) — not useful for us.

---

## Nested shapes

### `trainer_14_days` (racecards, Basic+)

| Field | Type | Used | Description |
|---|---|---|---|
| `runs` | string? | — | Number of runners the trainer has sent out in the last 14 days. |
| `wins` | string? | — | Number of those runners that won. |
| `percent` | string? | — | Strike rate — wins as a percentage of runs. |

### `medical`, `quotes`, `stable_tour`, `prev_trainers`, `prev_owners` (racecards, Basic+)

| Field | Type | Used | Description |
|---|---|---|---|
| `date` | string? | — | Date of the procedure, `YYYY-MM-DD`. |
| `type` | string? | — | Type of procedure, e.g. wind surgery. |

| Field | Type | Used | Description |
|---|---|---|---|
| `date` | string? | — |  |
| `horse` | string? | — |  |
| `horse_id` | string? | — |  |
| `race` | string? | — |  |
| `race_id` | string? | — |  |
| `course` | string? | — |  |
| `course_id` | string? | — |  |
| `distance_f` | string? | — |  |
| `distance_y` | string? | — |  |
| `quote` | string? | — |  |

| Field | Type | Used | Description |
|---|---|---|---|
| `quote` | string? | — |  |

| Field | Type | Used | Description |
|---|---|---|---|
| `trainer` | string? | — | A previous trainer of the horse. |
| `trainer_id` | string? | — | Unique identifier for the trainer, prefixed `trn_`. |
| `change_date` | string? | — | Date the horse changed yard, `YYYY-MM-DD`. |

| Field | Type | Used | Description |
|---|---|---|---|
| `owner` | string? | — | A previous owner of the horse. |
| `owner_id` | string? | — | Unique identifier for the owner, prefixed `own_`. |
| `change_date` | string? | — | Date the horse changed hands, `YYYY-MM-DD`. |

### `RunnerStats` (horse pro endpoints)

A prebuilt trailing-form feature set — overlaps heavily with what
`daily-race-feature-service.ts` computes for itself out of
`industry_starting_prices`.

| Field | Type | Used | Description |
|---|---|---|---|
| `career_prize` | string? | — |  |
| `career_win_percent` | string? | — |  |
| `career_place_percent` | string? | — |  |
| `course_stats` | RunnerStatsBreakdown? | — |  |
| `course_distance_stats` | RunnerStatsBreakdown? | — |  |
| `distance_stats` | RunnerStatsBreakdown? | — |  |
| `ground_firm_stats` | RunnerStatsBreakdown? | — |  |
| `ground_good_stats` | RunnerStatsBreakdown? | — |  |
| `ground_heavy_stats` | RunnerStatsBreakdown? | — |  |
| `ground_soft_stats` | RunnerStatsBreakdown? | — |  |
| `ground_aw_stats` | RunnerStatsBreakdown? | — |  |
| `jockey_stats` | RunnerStatsBreakdown? | — |  |
| `jumps_stats` | RunnerStatsBreakdown? | — |  |
| `last_raced` | string? | — |  |
| `last_ten_races_stats` | RunnerStatsBreakdown? | — |  |
| `last_twelve_months_stats` | RunnerStatsBreakdown? | — |  |
| `last_won` | string? | — |  |
| `max_winning_distance` | string? | — |  |
| `min_winning_distance` | string? | — |  |

Each `*_stats` entry is a `RunnerStatsBreakdown`:

| Field | Type | Used | Description |
|---|---|---|---|
| `total` | string? | — |  |
| `first` | string? | — |  |
| `second` | string? | — |  |
| `third` | string? | — |  |

---

## Available but unused — worth a look

- **`performance_rating` / `speed_rating`** (racecard and result runner) —
  the live replacements for the dead `rpr`/`ts`/`tsr` columns two of our
  model features are built on. See Gotcha 2.
- **`sp_dec`** (results runner) — decimal SP straight from the API, which
  would make `parseIsp`'s fraction parsing in
  `industry-sp-results-capture-service.ts` redundant for this path.
- **`bsp`** (results runner, Standard plan) — Betfair SP alongside industry
  SP in one response, without touching the Betfair stream.
- **`off_dt`** (results race) — timezone-aware ISO datetime; we currently
  rebuild race time by string-concatenating `date` + `off`.
- **`is_abandoned` / `race_status`** (racecards race) — would let the Daily
  Races screen distinguish abandoned and pre-declaration cards.
- **`performance_rating` / `speed_rating`** (both racecard and result runner,
  Basic+) — model features we don't currently ingest.
- **`non_runners`, `winning_time_detail`, `tote_*`** (results race).
- **`silk_url`** — runner silks for the UI.
- **Per-entity analysis endpoints** (`/trainers/{id}/analysis/jockeys`,
  `/horses/{id}/analysis/distance-times`, course/distance/class/going splits
  for jockeys, trainers, owners, sires, dams, damsires) — prebuilt splits we
  currently derive ourselves.
