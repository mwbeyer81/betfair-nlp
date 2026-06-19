#!/bin/bash
# Build the Expo web client and sync it to S3, then invalidate CloudFront.
# Serves at https://app.backbet.co.uk (CloudFront E1MADGEADM9CJZ → s3://betfair-nlp-web)
set -e

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LAMBDA_URL="https://fd0xrhcmj0.execute-api.eu-north-1.amazonaws.com"
BUCKET="betfair-nlp-web"
CF_DIST_ID="${CF_DIST_ID:-E1MADGEADM9CJZ}"

echo "Building Expo web client (pointing at Lambda API)..."
cd "$REPO_ROOT/client"
EXPO_PUBLIC_API_URL="$LAMBDA_URL" yarn build:web:production

echo "Syncing static assets to S3 (long cache)..."
aws s3 sync dist/ "s3://$BUCKET/" \
  --delete \
  --cache-control "public,max-age=31536000,immutable" \
  --exclude "index.html"

echo "Uploading index.html (no-cache)..."
aws s3 cp dist/index.html "s3://$BUCKET/index.html" \
  --cache-control "no-cache,no-store,must-revalidate" \
  --content-type "text/html"

if [ -n "$CF_DIST_ID" ]; then
  echo "Invalidating CloudFront distribution $CF_DIST_ID..."
  aws cloudfront create-invalidation \
    --distribution-id "$CF_DIST_ID" \
    --paths "/*" \
    --output text --query Invalidation.Id
fi

echo "Done. App deployed to S3 bucket: $BUCKET"
