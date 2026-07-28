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

echo "Building and copying codebase snapshot..."
bash "$REPO_ROOT/scripts/build-codebase-snapshot.sh"
mkdir -p dist/codebase-snapshot
cp -r "$REPO_ROOT/src/lib/service/codebase-snapshot/"* dist/codebase-snapshot/

echo "Zipping..."
cd dist
zip -qr ../function.zip handler.js config/ prompts/ codebase-snapshot/
cd ..

echo "Deploying code..."
aws lambda update-function-code \
  --function-name hello-api \
  --zip-file fileb://function.zip \
  --region eu-north-1 \
  --output text --query FunctionName

# update-function-code leaves the function in an async "in progress" state
# briefly — update-function-configuration right after it can hit
# ResourceConflictException if it lands before that settles. Wait it out
# rather than let the next call race it.
aws lambda wait function-updated --function-name hello-api --region eu-north-1

echo "Configuring Lambda runtime..."
# timeout/memory bumped from the original 30s/512MB — the scheduled
# racecards-ingest path now chains feature-compute + predict (see
# handler.ts, ~40-50 sequential per-race ml-prediction-api invokes plus
# targeted historical queries against a 100k+ doc collection) onto the
# same invocation. Only affects the scheduled/direct-invoke path — API
# Gateway HTTP requests are still bounded by its own ~29s gateway timeout
# regardless of this value, so normal API latency is unaffected.
aws lambda update-function-configuration \
  --function-name hello-api \
  --timeout 300 \
  --memory-size 1536 \
  --handler handler.handler \
  --region eu-north-1 \
  --output text --query FunctionName

aws lambda wait function-updated --function-name hello-api --region eu-north-1

echo "Configuring API Gateway throttling..."
aws apigatewayv2 update-stage \
  --api-id fd0xrhcmj0 \
  --stage-name '$default' \
  --region eu-north-1 \
  --default-route-settings '{"ThrottlingBurstLimit":50,"ThrottlingRateLimit":10}' \
  --output text --query StageName

# Update secrets only when config/local.json is present (not committed, lives on dev machines)
LOCAL_CONFIG="$REPO_ROOT/config/local.json"
if [ -f "$LOCAL_CONFIG" ]; then
  echo "Updating Lambda secrets from config/local.json..."
  MONGODB_URI=$(node -e "const c=require('$LOCAL_CONFIG'); console.log(c.mongodb.uri)")
  MONGODB_DB_NAME=$(node -e "const c=require('$LOCAL_CONFIG'); console.log(c.mongodb.dbName)")
  OPENAI_API_KEY=$(node -e "const c=require('$LOCAL_CONFIG'); console.log(c.openai.apiKey)")
  JWT_SECRET=$(node -e "const c=require('$LOCAL_CONFIG'); console.log(c.jwt.secret)")
  # email.* is optional — signup still succeeds with verification emails
  # skipped (see EmailService) if these are blank, so default to "" rather
  # than erroring when config/local.json predates this section.
  RESEND_API_KEY=$(node -e "const c=require('$LOCAL_CONFIG'); console.log((c.email && c.email.apiKey) || '')")
  EMAIL_FROM_ADDRESS=$(node -e "const c=require('$LOCAL_CONFIG'); console.log((c.email && c.email.fromAddress) || '')")
  API_URL=$(node -e "const c=require('$LOCAL_CONFIG'); console.log((c.app && c.app.apiUrl) || 'https://fd0xrhcmj0.execute-api.eu-north-1.amazonaws.com')")
  # google.*/twilio.* are optional too — Google/SMS sign-in return a clear
  # 503 ("not configured") rather than crashing if these are blank, same
  # non-fatal-by-default pattern as email.*. Same footgun as email.* also
  # applies here: since update-function-configuration replaces the whole
  # Variables map, if config/local.json exists but omits a google/twilio
  # section, these silently reset to blank (disabling Google/SMS sign-in)
  # on the next full deploy that goes through this branch.
  GOOGLE_CLIENT_ID=$(node -e "const c=require('$LOCAL_CONFIG'); console.log((c.google && c.google.clientId) || '')")
  TWILIO_ACCOUNT_SID=$(node -e "const c=require('$LOCAL_CONFIG'); console.log((c.twilio && c.twilio.accountSid) || '')")
  TWILIO_AUTH_TOKEN=$(node -e "const c=require('$LOCAL_CONFIG'); console.log((c.twilio && c.twilio.authToken) || '')")
  TWILIO_VERIFY_SERVICE_SID=$(node -e "const c=require('$LOCAL_CONFIG'); console.log((c.twilio && c.twilio.verifyServiceSid) || '')")
  # racingApi.* — used by the scheduled daily-races ingest (EventBridge ->
  # this Lambda, see .claude/commands/daily-races-cron.md), not by any HTTP
  # route directly. Same optional/blank-default pattern as email/google/twilio.
  RACINGAPI_USERNAME=$(node -e "const c=require('$LOCAL_CONFIG'); console.log((c.racingApi && c.racingApi.username) || '')")
  RACINGAPI_PASSWORD=$(node -e "const c=require('$LOCAL_CONFIG'); console.log((c.racingApi && c.racingApi.password) || '')")
  RACINGAPI_BASE_URL=$(node -e "const c=require('$LOCAL_CONFIG'); console.log((c.racingApi && c.racingApi.baseUrl) || 'https://api.theracingapi.com/v1')")
  aws lambda update-function-configuration \
    --function-name hello-api \
    --environment "Variables={MONGODB_URI=$MONGODB_URI,MONGODB_DB_NAME=$MONGODB_DB_NAME,OPENAI_API_KEY=$OPENAI_API_KEY,JWT_SECRET=$JWT_SECRET,RESEND_API_KEY=$RESEND_API_KEY,EMAIL_FROM_ADDRESS=$EMAIL_FROM_ADDRESS,API_URL=$API_URL,GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID,TWILIO_ACCOUNT_SID=$TWILIO_ACCOUNT_SID,TWILIO_AUTH_TOKEN=$TWILIO_AUTH_TOKEN,TWILIO_VERIFY_SERVICE_SID=$TWILIO_VERIFY_SERVICE_SID,RACINGAPI_USERNAME=$RACINGAPI_USERNAME,RACINGAPI_PASSWORD=$RACINGAPI_PASSWORD,RACINGAPI_BASE_URL=$RACINGAPI_BASE_URL}" \
    --region eu-north-1 \
    --output text --query FunctionName
else
  echo "Skipping secrets update (config/local.json not found — existing Lambda env vars unchanged)"
fi

echo "Done."
