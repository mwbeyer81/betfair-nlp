# Daily Races Cron

Keeps the `daily_racecards` collection fresh automatically — an AWS
EventBridge Scheduled Rule invokes the existing `hello-api` Lambda once a
day, which pulls RacingAPI's `/v1/racecards/free` and upserts the result.
No new Lambda function, no VM crontab — same function that serves the
public API, branching on event shape.

## How it works

`apps/lambda/src/handler.ts` checks `event.source === "aws.events"` (the
shape every EventBridge-triggered Lambda invocation carries, distinct from
an API Gateway HTTP event) — if true, it calls
`DailyRaceService.ingestFromRacingApi()` directly and returns, skipping the
Express/API Gateway proxy path entirely. Ingest logic itself lives in
`src/lib/service/daily-race-service.ts` (`ingestFromRacingApi`) +
`src/lib/dao/daily-race-dao.ts` (`bulkUpsertRaces`) — the same code path
`src/commands/fetch-daily-races.ts` (manual CLI run) uses, so there's one
implementation, not two.

## First-time setup

```bash
bash apps/lambda/build.sh                        # ships the handler branch + RACINGAPI_* env vars
bash scripts/setup-daily-races-schedule.sh        # creates the EventBridge rule + Lambda permission
```

`build.sh` only pushes `RACINGAPI_USERNAME`/`RACINGAPI_PASSWORD`/`RACINGAPI_BASE_URL`
(along with every other secret) when `config/local.json` is present — see
`/deploy-lambda`. Without real RacingAPI credentials on the Lambda, the
scheduled run will fail with "credentials not configured" (visible in
CloudWatch, harmless to the API itself — see "Failure behavior" below).

## Schedule

Default: **daily at 06:00 UTC**, `cron(0 6 * * ? *)`, set in
`scripts/setup-daily-races-schedule.sh`. Racecards are schedule/card data,
not live odds, so a single daily refresh is enough for "today's races" to
stay current. To change it, edit `SCHEDULE_EXPRESSION` in that script and
re-run it — `put-rule` is upsert-safe.

Before tightening this: RacingAPI's Free plan documents 1-5 requests/second
depending on endpoint, and their own dashboard says today's racecards
update every ~3 minutes on their end — there's no reason to poll anywhere
near that often for what is fundamentally a daily schedule listing, not
live prices.

## Verify it's wired up

```bash
aws events describe-rule --name daily-races-fetch-schedule --region eu-north-1
aws events list-targets-by-rule --rule daily-races-fetch-schedule --region eu-north-1
aws lambda get-policy --function-name hello-api --region eu-north-1
# expect a statement with Sid "daily-races-eventbridge", Principal events.amazonaws.com
```

## Manually trigger a run (don't wait for 06:00 UTC)

```bash
aws lambda invoke \
  --function-name hello-api \
  --region eu-north-1 \
  --payload '{"source":"aws.events","detail-type":"Scheduled Event"}' \
  --cli-binary-format raw-in-base64-out \
  /tmp/daily-races-invoke-out.json
cat /tmp/daily-races-invoke-out.json
```

## Where to look when it fails

CloudWatch Logs, log group `/aws/lambda/hello-api` — the handler logs
`Scheduled daily-races ingest: upserted N races.` on success or
`Scheduled daily-races ingest failed: ...` on error (credentials missing,
RacingAPI down/rate-limited, Mongo unreachable). A failed scheduled
invocation does **not** affect the live API — `initPromise` (the Mongo
connection) is established once at cold start independently of either
code path, so a bad ingest run can't take down HTTP traffic on the same
warm container.

## Confirm real data landed

```bash
# mint a token, then:
curl -H "Authorization: Bearer <token>" \
  "https://fd0xrhcmj0.execute-api.eu-north-1.amazonaws.com/api/daily-races"
# expect non-empty data for today
```
