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

REGION="eu-west-2"
FUNCTION_NAME="hello-api"
RULE_NAME="industry-sp-results-capture-schedule"
STATEMENT_ID="industry-sp-results-eventbridge"
# Every 2 minutes, all day — tightened from an earlier 10-minute rate
# (itself a change from the original once-daily 21:30 UTC firing, see git
# history/AGENTS.md) at the user's request on 2026-07-29 so a finished
# race's result shows up within ~2 minutes instead of up to 10. RacingAPI's
# /results/today only ever returns races that have ALREADY finished (never
# an unresolved race), so calling it more often is safe — it just means
# newly-finished races get upserted sooner, same idempotent
# upsert-by-hashed-raceId as before. Still well within RacingAPI's Basic
# plan rate limit (1-5 requests/second) — one call every 2 minutes is not
# remotely close to that ceiling. No day-boundary concern either: since
# this runs continuously through and past midnight UK time, it naturally
# keeps working across that transition rather than needing to land in one
# narrow pre-midnight window.
SCHEDULE_EXPRESSION="rate(2 minutes)"

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
