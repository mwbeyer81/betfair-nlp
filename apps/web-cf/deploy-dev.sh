#!/bin/bash
# Build the Expo web client and deploy to Cloudflare Pages as a dev branch deployment.
# Serves at https://dev.backbet.co.uk (CF Pages project: backbet-web-cf, branch: dev)
set -e

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
source "$(dirname "$0")/../common.sh"

if [ -z "$CLOUDFLARE_API_TOKEN" ]; then
  echo "Error: CLOUDFLARE_API_TOKEN env var is required" >&2
  exit 1
fi

echo "Building Expo web client (pointing at dev Lambda API)..."
cd "$REPO_ROOT/client"
EXPO_PUBLIC_API_URL="$LAMBDA_URL_DEV" yarn build:web:production

echo "Deploying to Cloudflare Pages (dev branch)..."
CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API_TOKEN" \
  npx wrangler pages deploy dist \
    --project-name backbet-web-cf \
    --branch dev \
    --commit-dirty=true

echo "Done. App deployed as a preview under the 'dev' branch."
