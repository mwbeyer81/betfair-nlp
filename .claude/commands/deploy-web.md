# Deploy Web App

Build the Expo React Native Web client and deploy it to S3 + CloudFront.
Live at: `https://app.backbet.co.uk`

## Command

```bash
cd /home/mwbeyer/betfair-nlp && bash apps/web/deploy.sh
```

## What it does

1. Builds the Expo web client with `EXPO_PUBLIC_API_URL` pointing at the Lambda API
2. Syncs all static assets to `s3://betfair-nlp-web` with long-lived immutable cache headers
3. Uploads `index.html` with `no-cache` so the entry point is always fresh
4. Invalidates CloudFront distribution `E1MADGEADM9CJZ` so edge nodes serve the new build

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
```
