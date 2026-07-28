#!/bin/bash
# One-time (but safe to re-run) setup: creates/updates a SECOND EventBridge
# Scheduled Rule (distinct from daily-races-fetch-schedule) that triggers
# the industry-sp results capture on the same `hello-api` Lambda. See
# .claude/commands/industry-sp-results-cron.md for the full writeup.
#
# This needs its own rule (not a reuse of daily-races-fetch-schedule)
# because results for "today" don't exist until racing finishes — it must
# fire later in the day than the 06:00 UTC racecards fetch. The rule's
# target carries a custom Input JSON with `action: "capture-results"` so
# apps/lambda/src/handler.ts's scheduled branch can tell the two rules
# apart; the original rule has no Input at all, so its behavior is
# unchanged (default branch).
#
# `put-rule`/`put-targets` are themselves upsert-style (safe to re-run to
# change the schedule/target later) — only `add-permission` errors on a
# duplicate statement id, so that step checks first via `get-policy`.
set -e

REGION="eu-north-1"
FUNCTION_NAME="hello-api"
RULE_NAME="industry-sp-results-capture-schedule"
STATEMENT_ID="industry-sp-results-eventbridge"
# Daily at 21:30 UTC — after UK racing has finished for the day, but safely
# before RacingAPI's own "today" rolls over. Confirmed empirically while
# building this (not just inferred): a live call at 23:09 UTC on a July day
# (BST, UTC+1) already returned zero results for "today" — RacingAPI's day
# boundary tracks UK local time, so 23:00 UTC is already past midnight BST
# and too late. 21:30 UTC stays safely on the UK-today side of that
# boundary year-round (21:30 UTC = 22:30 BST in summer, 21:30 GMT in
# winter) while still being after typical UK race-card end times. Still
# worth double-checking against any unusually late-finishing card.
SCHEDULE_EXPRESSION="cron(30 21 * * ? *)"

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
  | grep -q "$STATEMENT_ID"; then
  echo "  Permission already exists, skipping."
else
  echo "Granting EventBridge permission to invoke ${FUNCTION_NAME} from this rule..."
  aws lambda add-permission \
    --function-name "$FUNCTION_NAME" \
    --statement-id "$STATEMENT_ID" \
    --action lambda:InvokeFunction \
    --principal events.amazonaws.com \
    --source-arn "$RULE_ARN" \
    --region "$REGION" \
    --output text --query Statement
fi

echo "Wiring rule target to ${FUNCTION_NAME} with action=capture-results input..."
FAILED_COUNT=$(aws events put-targets \
  --rule "$RULE_NAME" \
  --region "$REGION" \
  --targets "[{\"Id\":\"${FUNCTION_NAME}\",\"Arn\":\"${FUNCTION_ARN}\",\"Input\":\"{\\\"source\\\":\\\"aws.events\\\",\\\"action\\\":\\\"capture-results\\\"}\"}]" \
  --output text --query "FailedEntryCount")
if [ "$FAILED_COUNT" != "0" ]; then
  echo "ERROR: put-targets reported $FAILED_COUNT failed entries." >&2
  exit 1
fi

echo "Done. Verify with:"
echo "  aws events describe-rule --name $RULE_NAME --region $REGION"
echo "  aws events list-targets-by-rule --rule $RULE_NAME --region $REGION"
