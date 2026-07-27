#!/bin/bash
# One-time (but safe to re-run) setup for the ml-prediction-api Lambda:
# S3 bucket for durable model artifacts, ECR repo for the container
# image, and IAM permission letting hello-api's execution role invoke
# this new function. Does NOT create the Lambda function itself — that
# happens on first deploy via apps/ml-api/build.sh (it needs an image
# already pushed to ECR before create-function can succeed, so build.sh
# owns that bootstrap-ordering step).
set -e

REGION="eu-north-1"
BUCKET="betfair-nlp-ml-models"
ECR_REPO="ml-prediction-api"
CALLER_ROLE_NAME="lambda-basic-exec"
FUNCTION_NAME="ml-prediction-api"
POLICY_NAME="invoke-ml-prediction-api"

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
FUNCTION_ARN="arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:${FUNCTION_NAME}"

echo "Creating S3 bucket ${BUCKET} (if it doesn't exist)..."
if aws s3api head-bucket --bucket "$BUCKET" --region "$REGION" 2>/dev/null; then
  echo "  Already exists, skipping."
else
  aws s3api create-bucket \
    --bucket "$BUCKET" \
    --region "$REGION" \
    --create-bucket-configuration "LocationConstraint=${REGION}" \
    --output text --query Location
  aws s3api put-public-access-block \
    --bucket "$BUCKET" \
    --region "$REGION" \
    --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
fi

echo "Creating ECR repo ${ECR_REPO} (if it doesn't exist)..."
if aws ecr describe-repositories --repository-names "$ECR_REPO" --region "$REGION" >/dev/null 2>&1; then
  echo "  Already exists, skipping."
else
  aws ecr create-repository \
    --repository-name "$ECR_REPO" \
    --region "$REGION" \
    --image-scanning-configuration scanOnPush=true \
    --output text --query "repository.repositoryArn"
fi

# hello-api and this function share the same lambda-basic-exec execution
# role (see apps/ml-api/build.sh) — this policy is what lets that role's
# Node code (PredictionApiClient) call lambda:InvokeFunction on this
# specific function's ARN. Same-account Lambda-to-Lambda invoke is
# authorized via the CALLER's identity policy, not a resource policy on
# the target, so this attaches to lambda-basic-exec, not ml-prediction-api.
echo "Granting ${CALLER_ROLE_NAME} permission to invoke ${FUNCTION_NAME}..."
POLICY_DOC=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "lambda:InvokeFunction",
      "Resource": "${FUNCTION_ARN}"
    }
  ]
}
EOF
)
aws iam put-role-policy \
  --role-name "$CALLER_ROLE_NAME" \
  --policy-name "$POLICY_NAME" \
  --policy-document "$POLICY_DOC"

echo "Done. Next: MODEL_VERSION_ID=<id> bash apps/ml-api/build.sh (first run creates the function)."
