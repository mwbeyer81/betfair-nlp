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

echo "Syncing static assets to S3 (long cache)..."
aws s3 sync storybook-static/ "s3://$BUCKET/" \
  --delete \
  --cache-control "public,max-age=31536000,immutable" \
  --exclude "index.html"

echo "Uploading index.html (no-cache)..."
aws s3 cp storybook-static/index.html "s3://$BUCKET/index.html" \
  --cache-control "no-cache,no-store,must-revalidate" \
  --content-type "text/html"

echo "Done. Storybook deployed to http://$BUCKET.s3-website.eu-north-1.amazonaws.com"
