# Deploy Lambda

Build and deploy the API to AWS Lambda (`hello-api`, eu-north-1).
Live at: `https://fd0xrhcmj0.execute-api.eu-north-1.amazonaws.com`

## Command

```bash
cd /home/mwbeyer/betfair-nlp && bash apps/lambda/build.sh
```

## What it does

1. Bundles `apps/lambda/src/handler.ts` with esbuild (single `dist/handler.js`)
2. Copies `config/default.json` and `config/custom-environment-variables.json` into `dist/config/`
3. Copies `src/lib/service/prompts/` into `dist/prompts/`
4. Zips and uploads to Lambda via `aws lambda update-function-code`
5. Configures handler, timeout (30s), memory (512MB)
6. Skips secrets update if `config/local.json` is absent (existing Lambda env vars unchanged)

## Secrets (set once, persist across deploys)

`MONGODB_URI`, `MONGODB_DB_NAME`, `OPENAI_API_KEY` are set as Lambda environment variables.
To update them, create `config/local.json` (gitignored) — build.sh will pick them up automatically.

## Scheduled invocations

This same Lambda also runs a daily EventBridge-triggered ingest (branches
on `event.source === "aws.events"` in `handler.ts`, entirely separate from
the API Gateway HTTP path) — see `/daily-races-cron`. A normal deploy via
this command ships that handler branch and the `RACINGAPI_*` secrets
together with everything else; no separate step needed unless you're
setting the schedule up for the first time.

## Verify

```bash
curl -s -H "Authorization: Basic bWF0dGhldzpiZXllcg==" \
  https://fd0xrhcmj0.execute-api.eu-north-1.amazonaws.com/api/stats
# Expect: {"success":true,"data":{...}}
```

Or run the Playwright Lambda test suite from `/home/mwbeyer/playwright-test`:
```bash
yarn playwright test --project=lambda --reporter=line
```
