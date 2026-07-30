# Bet Orders Evaluation Cron

**NOT PROVISIONED YET.** This doc and its setup script
(`scripts/setup-bet-orders-schedule.sh`) exist so the real EventBridge rule
can be created deliberately, later, once you're ready — this was written as
part of building the feature, but the script was never run against real AWS.
Until it is, `BetOrderService.evaluatePendingOrders()` never runs on a
schedule at all; bet orders created via the app just sit as `"pending"`
forever.

## Safety, read this first

Even once the schedule above is provisioned, **no real bet can be placed
until both of these are true**:
1. Real Betfair credentials (`betfair.appKey`/`username`/`password`) are
   configured on the Lambda — they aren't yet (see `config/default.json`).
2. `betfair.dryRun` is explicitly set to `false` — it defaults to `true`,
   and `BetfairApiClient.placeOrders()` (`src/lib/service/betfair-api-
   client.ts`) checks this flag *inside itself*, not just in the calling
   service, so there's no code path that reaches Betfair's real
   place-order endpoint while it's on. With `dryRun: true`, the evaluator
   still does everything else for real (resolves the live market, watches
   the live price) and logs exactly what it *would* have bet — useful for
   watching the whole pipeline behave correctly before ever risking money.

## Why this exists

Extends the mocked "Bet" button on Daily Races' Today's Picks (see
`AGENTS.md`'s `daily-races-bet-button` entry) into a real, scheduled watcher:
a user sets a target profit + max stake on a pick, and this cron
periodically checks whether Betfair's live price for that runner has risen
to the point where backing it (at that price, up to that stake) would hit
the target profit — and if so, either logs the decision (dry run) or places
a real back bet (live).

## How it works

Third EventBridge Scheduled Rule (alongside `daily-races-fetch-schedule` and
`industry-sp-results-capture-schedule`) invoking the same `hello-api`
Lambda, `apps/lambda/src/handler.ts` branching on `event.action ===
"evaluate-bet-orders"` → `BetOrderService.evaluatePendingOrders()`
(`src/lib/service/bet-order-service.ts`). For every still-open bet order
(`status` "pending" or "unmatched"):
1. Resolves the live Betfair market/selection for the race/runner if not
   already resolved (`betfair-market-resolver.ts`) — conservative by
   design: an ambiguous or missing match marks the order `"unmatched"`
   with a human-readable reason rather than guessing.
2. Fetches the live best-available-to-back price for that runner.
3. If the price meets the order's `minQualifyingPrice`, atomically
   transitions the order to a transient `"placing"` state (a
   compare-and-swap in `BetOrderDAO.tryTransition` — see its doc comment)
   *before* calling Betfair, so an overlapping/retried invocation can never
   place the same bet twice, then calls `placeOrders`.
4. An order whose race off-time has passed (plus a grace window) without
   triggering is marked `"expired"`.

`"error"` (a failed/ambiguous `placeOrders` call) is a terminal state —
deliberately **not** auto-retried on the next tick, since this codebase
can't always tell a clean rejection apart from an ambiguous timeout; a
human has to look at it rather than risk a blind duplicate bet.

## First-time setup (when you're ready to actually turn this on)

```bash
bash apps/lambda/build.sh                      # ships the handler branch + betfair.* env vars, once config/local.json has real credentials
bash scripts/setup-bet-orders-schedule.sh       # creates the EventBridge rule + Lambda permission
```

## Schedule

`rate(2 minutes)`, all day — Betfair prices move continuously, unlike the
once/day racecards or every-10-minutes results cron, so this needs to poll
far more often. No time-of-day windowing (unlike only running during UK
racing hours) to keep the setup script simple — worth adding later once
this is in real use and weighed against a real account's Betfair API rate
limits.

## Manually trigger a run

```bash
aws lambda invoke \
  --function-name hello-api \
  --region eu-west-2 \
  --payload '{"source":"aws.events","action":"evaluate-bet-orders"}' \
  --cli-binary-format raw-in-base64-out \
  /tmp/bet-orders-evaluate-invoke-out.json
cat /tmp/bet-orders-evaluate-invoke-out.json
```

## Where to look when it fails

CloudWatch Logs, log group `/aws/lambda/hello-api` — logs `Scheduled
bet-order evaluation: N evaluated, ... triggered, ... unmatched, ...
expired, ... errors.` on success, or `Scheduled bet-order evaluation
failed: ...` if the whole batch call itself threw (e.g. Mongo unreachable)
— an individual order's own failure is caught per-order inside
`evaluatePendingOrders` and turned into that order's own `"error"` status,
not a thrown exception.
