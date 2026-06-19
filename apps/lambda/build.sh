#!/bin/bash
set -e

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT/apps/lambda"

echo "Bundling Lambda handler..."
npx esbuild src/handler.ts \
  --bundle \
  --platform=node \
  --target=node22 \
  --outfile=dist/handler.js

echo "Copying config files..."
mkdir -p dist/config
cp "$REPO_ROOT/config/default.json" dist/config/
cp "$REPO_ROOT/config/custom-environment-variables.json" dist/config/

echo "Copying prompt files..."
mkdir -p dist/prompts
cp "$REPO_ROOT/src/lib/service/prompts/"* dist/prompts/

echo "Zipping..."
cd dist
zip -qr ../function.zip handler.js config/ prompts/
cd ..

echo "Deploying code..."
aws lambda update-function-code \
  --function-name hello-api \
  --zip-file fileb://function.zip \
  --region eu-north-1 \
  --output text --query FunctionName

echo "Configuring Lambda runtime..."
aws lambda update-function-configuration \
  --function-name hello-api \
  --timeout 30 \
  --memory-size 512 \
  --handler handler.handler \
  --region eu-north-1 \
  --output text --query FunctionName

# Update secrets only when config/local.json is present (not committed, lives on dev machines)
LOCAL_CONFIG="$REPO_ROOT/config/local.json"
if [ -f "$LOCAL_CONFIG" ]; then
  echo "Updating Lambda secrets from config/local.json..."
  MONGODB_URI=$(node -e "const c=require('$LOCAL_CONFIG'); console.log(c.mongodb.uri)")
  MONGODB_DB_NAME=$(node -e "const c=require('$LOCAL_CONFIG'); console.log(c.mongodb.dbName)")
  OPENAI_API_KEY=$(node -e "const c=require('$LOCAL_CONFIG'); console.log(c.openai.apiKey)")
  aws lambda update-function-configuration \
    --function-name hello-api \
    --environment "Variables={MONGODB_URI=$MONGODB_URI,MONGODB_DB_NAME=$MONGODB_DB_NAME,OPENAI_API_KEY=$OPENAI_API_KEY}" \
    --region eu-north-1 \
    --output text --query FunctionName
else
  echo "Skipping secrets update (config/local.json not found — existing Lambda env vars unchanged)"
fi

echo "Done."
