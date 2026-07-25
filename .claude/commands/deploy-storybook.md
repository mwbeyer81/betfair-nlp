# Deploy Storybook

Build Storybook from the **current checkout** (whatever branch you're on — this
is a review tool, not a production deploy) and publish it as a static site.
Live at: `http://backbet-storybook.s3-website.eu-north-1.amazonaws.com`

## Command

```bash
cd /home/ubuntu/betfair-nlp && bash apps/storybook-aws/deploy.sh
```

## What it does

1. `cd client && yarn install --frozen-lockfile && yarn storybook:build` — builds
   `storybook-static/` from whatever's currently checked out
2. Syncs all static assets to `s3://backbet-storybook` with long-lived immutable
   cache headers
3. Uploads `index.html` with `no-cache` so the entry point is always fresh

## AWS resources

| Resource | ID / Name |
|---|---|
| S3 bucket | `backbet-storybook` (eu-north-1, public-read, static website hosting) |
| Website endpoint | `backbet-storybook.s3-website.eu-north-1.amazonaws.com` |

No CloudFront distribution or custom domain in front of this — it's an
internal review tool, not the production app, so a plain public S3 website
bucket is enough. No worktree pinning either (unlike `/deploy-web` /
`/deploy-backbet`): Storybook is meant to be redeployed often from whatever
branch you're actively reviewing.

## First-time setup

Already done (bucket `backbet-storybook` created 2026-07-25 — public-access-block
disabled, static website hosting enabled with `index.html` as both index and
error document, bucket policy allows public `s3:GetObject`). If the bucket
is ever deleted, recreate it with:

```bash
BUCKET=backbet-storybook REGION=eu-north-1
aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
  --create-bucket-configuration LocationConstraint="$REGION"
aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration \
  BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false
aws s3api put-bucket-website --bucket "$BUCKET" --website-configuration '{
  "IndexDocument": {"Suffix": "index.html"},
  "ErrorDocument": {"Key": "index.html"}
}'
aws s3api put-bucket-policy --bucket "$BUCKET" --policy "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [{\"Sid\": \"PublicReadGetObject\", \"Effect\": \"Allow\", \"Principal\": \"*\",
    \"Action\": \"s3:GetObject\", \"Resource\": \"arn:aws:s3:::$BUCKET/*\"}]
}"
```

## Cloudflare alternative (unused — no token available yet)

`apps/storybook-cf/deploy.sh` deploys the same `storybook-static/` build to a
Cloudflare Pages project (`backbet-storybook`, auto-provisioned on first run,
no `wrangler.toml` needed) instead of S3. It's written and ready but has
never actually been run — it needs `CLOUDFLARE_API_TOKEN` in the environment:

```bash
cd /home/ubuntu/betfair-nlp && CLOUDFLARE_API_TOKEN=<token> bash apps/storybook-cf/deploy.sh
```

## Verify

```bash
curl -sI http://backbet-storybook.s3-website.eu-north-1.amazonaws.com/
# Expect: HTTP/1.1 200, content-type: text/html

curl -s http://backbet-storybook.s3-website.eu-north-1.amazonaws.com/index.json | head -c 200
# Expect: Storybook's story index JSON
```
