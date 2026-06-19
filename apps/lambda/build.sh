#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "Bundling Lambda handler..."
npx esbuild src/handler.ts \
  --bundle \
  --platform=node \
  --target=node22 \
  --outfile=dist/handler.js

echo "Zipping..."
cd dist
zip -q ../function.zip handler.js
cd ..

echo "Deploying to AWS Lambda..."
aws lambda update-function-code \
  --function-name hello-api \
  --zip-file fileb://function.zip \
  --region eu-north-1 \
  --output text --query 'FunctionName'

echo "Done."
