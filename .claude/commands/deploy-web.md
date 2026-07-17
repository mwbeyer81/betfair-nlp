# Deploy Web App (develop → app.backbet.co.uk)

Build the Expo React Native Web client from the **`develop`** branch and deploy it to S3 + CloudFront.
Live at: `https://app.backbet.co.uk`

For the production site (`backbet.co.uk`, built from `main`), use `/deploy-backbet` instead.

## Command

```bash
cd /home/ubuntu/betfair-nlp && bash apps/web/deploy.sh
```

## What it does

1. Syncs a persistent worktree at `~/betfair-nlp-deploy-develop` to the latest `origin/develop` (detached HEAD) — this always ships `develop`, regardless of what branch is checked out in the primary working copy
2. Builds the Expo web client from that worktree with `EXPO_PUBLIC_API_URL` pointing at the Lambda API
3. Stamps `<meta name="build-branch" content="develop">` and `<meta name="build-commit" content="...">` into `dist/index.html`
4. Syncs all static assets to `s3://betfair-nlp-web` with long-lived immutable cache headers
5. Uploads `index.html` with `no-cache` so the entry point is always fresh
6. Invalidates CloudFront distribution `E1MADGEADM9CJZ` so edge nodes serve the new build

## AWS resources

| Resource | ID / Name |
|---|---|
| S3 bucket | `betfair-nlp-web` (eu-north-1, private, OAC-only access) |
| CloudFront distribution | `E1MADGEADM9CJZ` → `d3jepqko9i1lgu.cloudfront.net` |
| ACM certificate | `arn:aws:acm:us-east-1:465137780330:certificate/1d0fef63-a6d2-405c-9170-b2d5957dbda0` |
| Custom domain | `app.backbet.co.uk` (CNAME in GoDaddy → CloudFront) |
| Lambda API | `https://fd0xrhcmj0.execute-api.eu-north-1.amazonaws.com` |

## First-time setup

If starting from scratch, run `apps/web/setup.sh` once to create the S3 bucket,
OAC, and CloudFront distribution. Then run `deploy.sh` to push the first build.

## Verify

```bash
curl -sI https://app.backbet.co.uk/
# Expect: HTTP/2 200, content-type: text/html, via: CloudFront

curl -s https://app.backbet.co.uk/ | grep -o '<meta name="build-branch" content="[^"]*"'
# Expect: content="develop"
```

Or run the Playwright branch-verification test:

```bash
cd client && npx playwright test --config playwright.live.config.ts tests-live/branch-verification.spec.ts
```
