# Deploy Backbet (main → backbet.co.uk)

Build the Expo React Native Web client from the **`main`** branch and deploy it to
Cloudflare Pages as a production deployment.
Live at: `https://backbet.co.uk` (also served at `https://cf.backbet.co.uk`)

For the staging site (`app.backbet.co.uk`, built from `develop`), use `/deploy-web` instead.

## Command

```bash
cd /home/ubuntu/betfair-nlp && CLOUDFLARE_API_TOKEN=<token> bash apps/web-cf/deploy.sh
```

## What it does

1. Syncs a persistent worktree at `~/betfair-nlp-deploy-main` to the latest `origin/main` (detached HEAD) — this always ships `main`, regardless of what branch is checked out in the primary working copy
2. Builds the Expo web client from that worktree with `EXPO_PUBLIC_API_URL` pointing at the Lambda API
3. Stamps `<meta name="build-branch" content="main">` and `<meta name="build-commit" content="...">` into `dist/index.html`
4. Deploys `dist/` to the Cloudflare Pages project `backbet-web-cf` with `--branch main`, which Cloudflare serves as the production deployment (the custom domains `backbet.co.uk` and `cf.backbet.co.uk` are attached to this project)

## Cloudflare resources

| Resource | ID / Name |
|---|---|
| Pages project | `backbet-web-cf` |
| Production branch | `main` |
| Custom domains | `backbet.co.uk`, `cf.backbet.co.uk` |
| Preview domain | `dev.backbet.co.uk` (see `apps/web-cf/deploy-dev.sh`, deploys the `dev` git branch as a CF Pages preview, not part of this main/develop split) |
| Lambda API | `https://6fj7nh9mw6.execute-api.eu-west-2.amazonaws.com` |

Requires `CLOUDFLARE_API_TOKEN` in the environment.

## Verify

```bash
curl -sI https://backbet.co.uk/
# Expect: HTTP/2 200, content-type: text/html

curl -s https://backbet.co.uk/ | grep -o '<meta name="build-branch" content="[^"]*"'
# Expect: content="main"
```

Or run the Playwright branch-verification test:

```bash
cd client && npx playwright test --config playwright.production.config.ts tests-production/branch-verification.spec.ts
```
