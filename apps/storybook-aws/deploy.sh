#!/bin/bash
# Build Storybook from the current checkout and sync it to an S3 static
# website hosting bucket.
# Serves at http://backbet-storybook.s3-website.eu-north-1.amazonaws.com
# (bucket: backbet-storybook, region: eu-north-1, public-read + static
# website hosting enabled — no CloudFront/custom domain in front of it, this
# is a review tool, not the production app).
#
# Bucket provisioning (create-bucket, public-access-block, website config,
# bucket policy) is a one-time step done outside this script, not repeated
# on every deploy — see this file's git history for the exact commands.
set -e

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BUCKET="backbet-storybook"

echo "Building Storybook..."
cd "$REPO_ROOT/client"
yarn install --frozen-lockfile
yarn storybook:build

# Reported live (screenshot from an actual phone): a redeploy landed, but
# the phone kept showing an old version of the component's UI. Root cause —
# `iframe.html`, `index.json`, and `project.json` keep the SAME filename on
# every build (unlike the *.iframe.bundle.js chunks, which are content-
# hashed), but an earlier version of this script cached everything except
# index.html with `max-age=31536000, immutable` anyway. A browser that has
# ever loaded iframe.html once will never even revalidate it again for a
# year, no matter how many times the bucket gets redeployed underneath it.
#
# `aws s3 sync`'s own --cache-control flag only applies to objects it
# actually re-uploads (i.e. ones whose content changed) — an unchanged file
# (a favicon, project.json if the Storybook version hasn't moved) silently
# keeps whatever Cache-Control it already has from a previous deploy. So
# this can't be fixed "going forward" by just changing the flag on a sync;
# every deploy now force-uploads with `cp` (which always re-uploads,
# unconditionally) so every object's Cache-Control header is genuinely
# reset every time, regardless of whether its content changed.
echo "Uploading everything with a short, safe cache (correctness over cache-hit-rate for this low-traffic internal tool)..."
aws s3 cp storybook-static/ "s3://$BUCKET/" \
  --recursive \
  --cache-control "no-cache,no-store,must-revalidate"

echo "Re-uploading content-hashed JS bundle chunks with a long cache (safe: the filename itself changes whenever the content does)..."
aws s3 cp storybook-static/ "s3://$BUCKET/" \
  --recursive \
  --exclude "*" \
  --include "*.iframe.bundle.js" \
  --include "*.iframe.bundle.js.map" \
  --cache-control "public,max-age=31536000,immutable"

echo "Removing any objects left over from a previous build..."
aws s3 sync storybook-static/ "s3://$BUCKET/" \
  --delete \
  --cache-control "no-cache,no-store,must-revalidate"

echo "Done. Storybook deployed to http://$BUCKET.s3-website.eu-north-1.amazonaws.com"
echo "Note: browsers that already cached iframe.html under the old immutable"
echo "policy won't see this update until they hard-refresh / clear site data —"
echo "only NEW visits from here on are protected."
