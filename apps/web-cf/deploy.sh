#!/bin/bash
# Build the Expo web client from the `main` branch and deploy to Cloudflare Pages
# as a production deployment.
# Serves at https://backbet.co.uk and https://cf.backbet.co.uk (CF Pages project: backbet-web-cf)
#
# Always builds from origin/main via a pinned worktree, regardless of what
# branch is checked out locally. Use apps/web/deploy.sh to deploy `develop`
# to app.backbet.co.uk instead.
set -e

BRANCH="main"
WORKTREE_DIR="$HOME/betfair-nlp-deploy-main"

source "$(dirname "$0")/../common.sh"

if [ -z "$CLOUDFLARE_API_TOKEN" ]; then
  echo "Error: CLOUDFLARE_API_TOKEN env var is required" >&2
  exit 1
fi

echo "Syncing worktree to origin/$BRANCH..."
COMMIT_SHA=$(sync_worktree "$BRANCH" "$WORKTREE_DIR")
echo "  -> $COMMIT_SHA"

echo "Building Expo web client (pointing at Lambda API)..."
cd "$WORKTREE_DIR/client"
yarn install --frozen-lockfile
EXPO_PUBLIC_API_URL="$LAMBDA_URL" yarn build:web:production

echo "Stamping build metadata into index.html..."
sed -i "s#<meta charset=\"utf-8\" />#<meta charset=\"utf-8\" /><meta name=\"build-branch\" content=\"$BRANCH\" /><meta name=\"build-commit\" content=\"$COMMIT_SHA\" />#" dist/index.html

echo "Deploying to Cloudflare Pages (production)..."
CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API_TOKEN" \
  npx wrangler pages deploy dist \
    --project-name backbet-web-cf \
    --branch main \
    --commit-dirty=true

echo "Removing node_modules (not needed post-build, keeps the worktree lean on disk)..."
rm -rf node_modules

echo "Done. main@$COMMIT_SHA deployed to backbet.co.uk"
