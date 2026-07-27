#!/bin/bash
# One-time (but safe to re-run) setup: creates/updates the EventBridge
# Scheduled Rule that triggers the daily-races ingest on the `hello-api`
# Lambda. See .claude/commands/daily-races-cron.md for the full writeup.
#
# `put-rule`/`put-targets` are themselves upsert-style (safe to re-run to
# change the schedule/target later) — only `add-permission` errors on a
# duplicate statement id, so that step checks first via `get-policy`.
set -e

REGION="eu-north-1"
FUNCTION_NAME="hello-api"
RULE_NAME="daily-races-fetch-schedule"
# Daily at 06:00 UTC — racecards are schedule/card data, not live odds, so a
# single daily refresh is enough. Change here (and re-run this script) if
# you want a different cadence — see the doc above for RacingAPI's own
# Free-plan rate limits before tightening this.
SCHEDULE_EXPRESSION="cron(0 6 * * ? *)"

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
RULE_ARN="arn:aws:events:${REGION}:${ACCOUNT_ID}:rule/${RULE_NAME}"
FUNCTION_ARN="arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:${FUNCTION_NAME}"

echo "Creating/updating EventBridge rule ${RULE_NAME} (${SCHEDULE_EXPRESSION})..."
aws events put-rule \
  --name "$RULE_NAME" \
  --schedule-expression "$SCHEDULE_EXPRESSION" \
  --region "$REGION" \
  --state ENABLED \
  --output text --query RuleArn

echo "Checking for existing Lambda invoke permission..."
if aws lambda get-policy --function-name "$FUNCTION_NAME" --region "$REGION" 2>/dev/null \
  | grep -q "daily-races-eventbridge"; then
  echo "  Permission already exists, skipping."
else
  echo "Granting EventBridge permission to invoke ${FUNCTION_NAME}..."
  aws lambda add-permission \
    --function-name "$FUNCTION_NAME" \
    --statement-id daily-races-eventbridge \
    --action lambda:InvokeFunction \
    --principal events.amazonaws.com \
    --source-arn "$RULE_ARN" \
    --region "$REGION" \
    --output text --query Statement
fi

echo "Wiring rule target to ${FUNCTION_NAME}..."
FAILED_COUNT=$(aws events put-targets \
  --rule "$RULE_NAME" \
  --region "$REGION" \
  --targets "[{\"Id\":\"${FUNCTION_NAME}\",\"Arn\":\"${FUNCTION_ARN}\"}]" \
  --output text --query "FailedEntryCount")
if [ "$FAILED_COUNT" != "0" ]; then
  echo "ERROR: put-targets reported $FAILED_COUNT failed entries." >&2
  exit 1
fi

echo "Done. Verify with:"
echo "  aws events describe-rule --name $RULE_NAME --region $REGION"
echo "  aws events list-targets-by-rule --rule $RULE_NAME --region $REGION"
