# Industry SP Results Cron

Keeps `industry_starting_prices` fresh with each day's real, finished
race results — a second AWS EventBridge Scheduled Rule invokes the same
`hello-api` Lambda used by the daily-races racecards cron (see
`daily-races-cron.md`), which pulls RacingAPI's `/v1/results/today` and
upserts the result. No new Lambda function, no VM crontab — same function
serves the public API, the racecards fetch, and this capture, branching on
event shape/input.

## Why this exists

`industry_starting_prices` is the collection `daily-race-feature-
service.ts` queries to compute each Daily Races runner's recent form
(trainer/jockey 14-day trailing win-rate, horse career stats) for the
win-probability model. It was originally seeded only from a static Kaggle
CSV that stops updating at a fixed date — without this cron, that
collection would fall further and further behind, and every runner scored
today would show "no recent form." This job closes that gap going forward,
one real day at a time, using data the RacingAPI account's Basic plan can
already reach (historical/dated results need a Standard-tier upgrade the
account doesn't have — see the plan this cron shipped under).

## How it works

`apps/lambda/src/handler.ts` checks `event.source === "aws.events"` (as
the racecards cron does) and additionally branches on `event.action`:
`"capture-results"` calls `IndustrySpResultsCaptureService.
captureTodayResults()` directly and returns, skipping the Express/API
Gateway proxy path entirely; anything else (including the racecards rule's
existing input, which has no `action` field) keeps the original
`ingestFromRacingApi()` behavior, unchanged. Capture logic itself lives in
`src/lib/service/industry-sp-results-capture-service.ts` — the same code
path `src/commands/capture-industry-sp-results.ts` (manual CLI run) uses,
so there's one implementation, not two.

Only real, finished races are ever written this way — RacingAPI's
`/results/today` only ever returns races that have already run, so this
never risks the "never write an unresolved race into
industry_starting_prices" invariant `daily-race-feature-service.ts`
depends on. It's the intentional complement to that read-only boundary,
not an exception to it.

## First-time setup

```bash
bash apps/lambda/build.sh                              # ships the handler branch + RACINGAPI_RESULTS_PATH env var
bash scripts/setup-industry-sp-results-schedule.sh      # creates the second EventBridge rule + Lambda permission
```

`build.sh` only pushes `RACINGAPI_USERNAME`/`RACINGAPI_PASSWORD`/
`RACINGAPI_BASE_URL`/`RACINGAPI_RESULTS_PATH` (along with every other
secret) when `config/local.json` is present — see `/deploy-lambda`.
Without real RacingAPI credentials on the Lambda, the scheduled run will
fail with "credentials not configured" (visible in CloudWatch, harmless to
the API itself — see "Failure behavior" below).

## Schedule

**As of 2026-07-28: every 10 minutes, all day** (`rate(10 minutes)`), set
in `scripts/setup-industry-sp-results-schedule.sh` — changed from the
original once-daily 21:30 UTC firing once Daily Races' Today's Picks
started showing live per-pick results/P&L (`feat/daily-picks-results-pnl`):
punters want a race's result to show up shortly after it finishes, not
only once in the evening. Safe to call this often — `/results/today` only
ever returns races that have already finished, and the write is an
idempotent upsert keyed by hashed raceId, so an extra call just means
nothing new to upsert yet. Also sidesteps the old day-boundary edge case
below (running continuously through midnight UK time rather than needing
to land in one narrow pre-midnight window). **Worth keeping an eye on**:
this is ~144 calls/day to RacingAPI's `/results/today` — if the account's
Basic-plan rate limit ever becomes a problem, dial `SCHEDULE_EXPRESSION`
back down (e.g. `rate(30 minutes)`) rather than reverting to once-daily.

Original reasoning for the old once-daily 21:30 UTC default, kept for
context: deliberately later than the racecards cron's 06:00 UTC, since
results for "today" don't exist until racing has actually finished, but
**not as late as 23:00 UTC** — a live call during this cron's original
build, at 23:09 UTC on a July day (BST, UTC+1), came back with zero
results for "today" (RacingAPI's day boundary tracks UK local time, so
23:00 UTC is already past midnight BST and lands on the wrong day). To
change the schedule, edit `SCHEDULE_EXPRESSION` in that script and re-run
it — `put-rule` is upsert-safe.

## Verify it's wired up

```bash
aws events describe-rule --name industry-sp-results-capture-schedule --region eu-north-1
aws events list-targets-by-rule --rule industry-sp-results-capture-schedule --region eu-north-1
aws lambda get-policy --function-name hello-api --region eu-north-1
# expect a statement with Sid "industry-sp-results-eventbridge", Principal events.amazonaws.com
# expect the target's Input to be {"source":"aws.events","action":"capture-results"}
```

## Manually trigger a run (don't wait for 23:00 UTC)

```bash
aws lambda invoke \
  --function-name hello-api \
  --region eu-north-1 \
  --payload '{"source":"aws.events","action":"capture-results"}' \
  --cli-binary-format raw-in-base64-out \
  /tmp/industry-sp-results-invoke-out.json
cat /tmp/industry-sp-results-invoke-out.json
```

## Where to look when it fails

CloudWatch Logs, log group `/aws/lambda/hello-api` — the handler logs
`Scheduled industry-sp results capture: upserted N races (M runners),
skipped K non-GB races.` on success or `Scheduled industry-sp results
capture failed: ...` on error (credentials missing, RacingAPI plan
downgraded/rate-limited, Mongo unreachable). A failed scheduled invocation
does **not** affect the live API or the racecards cron — `initPromise` (the
Mongo connection) is established once at cold start independently of every
event-shape branch, so a bad capture run can't take down HTTP traffic or
the other cron on the same warm container.

## Confirm real data landed

```bash
# against dev Mongo, or via mongosh on prod:
db.industry_starting_prices.find({ raceDate: "2026-07-27" }).count()
# expect > 0 the day after this cron first runs successfully
```

Trailing-form fields on Daily Races runners (`daily-race-feature-
service.ts`) will start turning non-null for runners whose trainer/jockey
had a real run captured in the intervening days — full trainer/jockey
14-day trailing coverage takes about two weeks from this cron's first
successful run, since it's filling the window forward one day at a time,
not backfilling.
