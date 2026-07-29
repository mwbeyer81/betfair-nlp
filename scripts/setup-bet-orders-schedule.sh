#!/bin/bash
# One-time (but safe to re-run) setup: creates/updates a THIRD EventBridge
# Scheduled Rule (alongside daily-races-fetch-schedule and
# industry-sp-results-capture-schedule) that triggers BetOrderService's
# conditional-bet evaluator on the same `hello-api` Lambda. See
# .claude/commands/bet-orders-cron.md for the full writeup.
#
# NOT RUN as part of building this feature — writing this script is not the
# same as provisioning real, recurring AWS infrastructure. Run it yourself,
# deliberately, once you're ready for the evaluator to actually start firing
# on a schedule (it stays fully inert either way: BetfairApiClient defaults
# to dryRun=true, and this Lambda has no real Betfair credentials
# configured yet — see config/default.json's betfair block).
#
# `put-rule`/`put-targets` are themselves upsert-style (safe to re-run to
# change the schedule/target later) — only `add-permission` errors on a
# duplicate statement id, so that step checks first via `get-policy`.
set -e

REGION="eu-north-1"
FUNCTION_NAME="hello-api"
RULE_NAME="bet-orders-evaluate-schedule"
STATEMENT_ID="bet-orders-evaluate-eventbridge"
# Betfair prices move continuously, not once a day — a conditional bet
# order needs to be re-checked far more often than the daily racecards/
# results crons. 2 minutes is a starting point, not a tuned value; there's
# no time-of-day/day-of-week windowing here (unlike e.g. only running
# during UK racing hours) to keep this script as simple as its two
# siblings above — narrower windowing can be added later once this is
# actually in use and the always-on cost/rate-limit tradeoff has been
# weighed against a real account's Betfair API rate limits.
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

echo "Wiring rule target to ${FUNCTION_NAME} with action=evaluate-bet-orders input..."
FAILED_COUNT=$(aws events put-targets \
  --rule "$RULE_NAME" \
  --region "$REGION" \
  --targets "[{\"Id\":\"${FUNCTION_NAME}\",\"Arn\":\"${FUNCTION_ARN}\",\"Input\":\"{\\\"source\\\":\\\"aws.events\\\",\\\"action\\\":\\\"evaluate-bet-orders\\\"}\"}]" \
  --output text --query "FailedEntryCount")
if [ "$FAILED_COUNT" != "0" ]; then
  echo "ERROR: put-targets reported $FAILED_COUNT failed entries." >&2
  exit 1
fi

echo "Done. Verify with:"
echo "  aws events describe-rule --name $RULE_NAME --region $REGION"
echo "  aws events list-targets-by-rule --rule $RULE_NAME --region $REGION"
