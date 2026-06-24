#!/bin/bash
# Build the Expo web client and deploy to Cloudflare Pages.
# Serves at https://cf.backbet.co.uk (CF Pages project: backbet-web-cf)
set -e

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LAMBDA_URL="https://fd0xrhcmj0.execute-api.eu-north-1.amazonaws.com"

if [ -z "$CLOUDFLARE_API_TOKEN" ]; then
  echo "Error: CLOUDFLARE_API_TOKEN env var is required" >&2
  exit 1
fi

echo "Building Expo web client (pointing at Lambda API)..."
cd "$REPO_ROOT/client"
EXPO_PUBLIC_API_URL="$LAMBDA_URL" yarn build:web:production

echo "Deploying to Cloudflare Pages..."
CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API_TOKEN" \
  npx wrangler pages deploy dist \
    --project-name backbet-web-cf \
    --commit-dirty=true

echo "Done. App deployed to cf.backbet.co.uk"
