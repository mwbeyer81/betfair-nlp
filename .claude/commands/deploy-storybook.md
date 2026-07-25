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
2. Force-uploads (`aws s3 cp --recursive`, not `sync`) **everything** to
   `s3://backbet-storybook` with `no-cache, no-store, must-revalidate` —
   unconditional, every deploy, regardless of whether a file's content changed
3. Re-uploads just the content-hashed `*.iframe.bundle.js` chunks with a
   long, safe `immutable` cache (their filename changes whenever their
   content does, so long-caching them is genuinely safe)
4. A final `aws s3 sync --delete` pass removes any objects orphaned by a
   previous build (safe no-op for headers by this point — everything
   already matches from steps 2–3)

**Why force-upload instead of a plain `sync --cache-control`:** `aws s3
sync`'s `--cache-control` flag only applies to objects it actually
re-uploads (content-diffed) — a file whose content is byte-identical to
what's already in the bucket (a favicon, `project.json` if the Storybook
version hasn't changed) silently keeps whatever Cache-Control it already
has from a previous deploy. Found this the hard way (2026-07-25, see
AGENTS.md): `iframe.html`/`index.json`/`project.json` keep the same
filename every build, so an earlier version of this script that only
special-cased `index.html` left them `immutable`-cached — a browser that
loaded `iframe.html` once would never revalidate it again for a year, no
matter how many redeploys landed underneath it.

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

curl -sI http://backbet-storybook.s3-website.eu-north-1.amazonaws.com/iframe.html | grep -i cache-control
# Expect: no-cache,no-store,must-revalidate (NEVER "immutable" — see the
# caching bug above if this ever shows immutable again)
```

**A browser that already loaded a page under the old (buggy) immutable
cache policy won't see a new deploy until it hard-refreshes or clears
site data for that URL** — there's no way to retroactively un-poison an
already-cached client from the server side. If someone reports "I
redeployed but still see the old version," check their browser cache
before assuming the deploy itself failed.

For an actual visual/behavioral check against the live deployed site (not
just local Storybook), run the Playwright suite in
`client/tests-storybook-live/`:

```bash
cd client && npx playwright test --config playwright.storybook-live.config.ts \
  tests-storybook-live/model-performance-dashboard-live.spec.ts
```

This is the layer that catches regressions Storybook's own interaction
tests can't — `toBeInTheDocument()`-style assertions only prove an
element exists in the DOM, not that it actually renders with real height
or the right font. Both happened here (2026-07-25): a fullscreen panel's
content was in the DOM but zero-height due to a wrapper-div height
collapse, and text silently fell back to a serif font because Storybook
never loaded Inter — see the `preview-head.html` fix and the AGENTS.md
entry for the full story.

It's also the layer for the dashboard's responsive table view (one row
per model version, tap through to detail): Storybook's own `viewport`
parameter doesn't actually resize anything in this Storybook 9 config
(confirmed empirically — `@storybook/addon-viewport` was removed and
nothing replaced its resizing behavior), so the narrow-vs-wide layout
checks live here too, using Playwright's real `browser.newContext({
viewport })` rather than a Storybook parameter.

`storybook-live.spec.ts` in the same directory
targets a separate, older `punt-storybook.pages.dev` Cloudflare Pages
deployment (pre-dates the app's rename to Backbet) — unrelated to this
S3 bucket, left as-is.
