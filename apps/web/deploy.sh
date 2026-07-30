#!/bin/bash
# Build the Expo web client from the `develop` branch and sync it to S3, then
# invalidate CloudFront.
# Serves at https://app.backbet.co.uk (CloudFront E1MADGEADM9CJZ → s3://betfair-nlp-web)
#
# Always builds from origin/develop via a pinned worktree, regardless of what
# branch is checked out locally. Use apps/web-cf/deploy.sh to deploy `main`
# to backbet.co.uk instead.
set -e

BRANCH="develop"
WORKTREE_DIR="$HOME/betfair-nlp-deploy-develop"

source "$(dirname "$0")/../common.sh"
BUCKET="betfair-nlp-web"
CF_DIST_ID="${CF_DIST_ID:-E1MADGEADM9CJZ}"

echo "Syncing worktree to origin/$BRANCH..."
COMMIT_SHA=$(sync_worktree "$BRANCH" "$WORKTREE_DIR")
echo "  -> $COMMIT_SHA"

echo "Building Expo web client (pointing at Lambda API)..."
cd "$WORKTREE_DIR/client"
yarn install --frozen-lockfile
EXPO_PUBLIC_API_URL="$LAMBDA_URL" EXPO_PUBLIC_GOOGLE_CLIENT_ID="$GOOGLE_CLIENT_ID" yarn build:web:production

echo "Removing mockServiceWorker.js (test-only, Expo copies client/public/ verbatim so it always ends up in dist/ — it must never be live in production: once a browser registers a service worker against this origin, it keeps intercepting fetches and serving stale/cached responses indefinitely, surviving normal reloads and even tab closes)..."
rm -f dist/mockServiceWorker.js

echo "Stamping build metadata into index.html..."
sed -i "s#<meta charset=\"utf-8\" />#<meta charset=\"utf-8\" /><meta name=\"build-branch\" content=\"$BRANCH\" /><meta name=\"build-commit\" content=\"$COMMIT_SHA\" />#" dist/index.html

echo "Removing node_modules (not needed post-build, keeps the worktree lean on disk)..."
rm -rf node_modules

# Deliberately three steps, in this order. The old single `sync --delete`
# deleted the previous build's hashed JS bundle *before* the new index.html
# went up, so for the seconds in between, anyone loading the site got an
# index.html pointing at a bundle that no longer existed — a hard white-screen
# failure, and one that CloudFront could then cache at the edge. Uploading
# additively first, cutting index.html over second, and only then pruning the
# now-unreferenced old assets means every index.html that's ever live has its
# bundle present.
echo "Uploading new static assets to S3 (long cache, additive)..."
aws s3 sync dist/ "s3://$BUCKET/" \
  --cache-control "public,max-age=31536000,immutable" \
  --exclude "index.html"

echo "Uploading index.html (no-cache) — cuts traffic over to the new bundle..."
aws s3 cp dist/index.html "s3://$BUCKET/index.html" \
  --cache-control "no-cache,no-store,must-revalidate" \
  --content-type "text/html"

echo "Pruning assets no longer referenced by this build..."
aws s3 sync dist/ "s3://$BUCKET/" \
  --delete \
  --cache-control "public,max-age=31536000,immutable" \
  --exclude "index.html"

if [ -n "$CF_DIST_ID" ]; then
  echo "Invalidating CloudFront distribution $CF_DIST_ID..."
  aws cloudfront create-invalidation \
    --distribution-id "$CF_DIST_ID" \
    --paths "/*" \
    --output text --query Invalidation.Id
fi

echo "Done. develop@$COMMIT_SHA deployed to app.backbet.co.uk"
