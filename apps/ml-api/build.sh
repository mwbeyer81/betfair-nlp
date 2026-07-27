#!/bin/bash
# Builds + deploys the ml-prediction-api container-image Lambda. Assumes
# the function, ECR repo, and S3 bucket already exist — see
# scripts/setup-prediction-api-lambda.sh for one-time provisioning.
#
# Usage:
#   MODEL_VERSION_ID=xgb-20260727-171521 bash apps/ml-api/build.sh
# MODEL_VERSION_ID selects which S3-uploaded model to bake into the image
# (see ml/train_and_predict.py's upload_model_to_s3()) — required, no
# "latest" guessing here, so a deploy always names exactly which model
# went live.
set -e

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
REGION="eu-north-1"
FUNCTION_NAME="ml-prediction-api"
BUCKET="betfair-nlp-ml-models"
ECR_REPO="ml-prediction-api"

if [ -z "$MODEL_VERSION_ID" ]; then
  echo "ERROR: MODEL_VERSION_ID is required (e.g. MODEL_VERSION_ID=xgb-20260727-171521 bash $0)" >&2
  exit 1
fi

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_URI="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${ECR_REPO}"

echo "Fetching model ${MODEL_VERSION_ID} from S3..."
rm -rf "$REPO_ROOT/apps/ml-api/models"
mkdir -p "$REPO_ROOT/apps/ml-api/models"
aws s3 cp "s3://${BUCKET}/models/win-probability/${MODEL_VERSION_ID}/win_probability_model.json" \
  "$REPO_ROOT/apps/ml-api/models/win_probability_model.json" --region "$REGION"
aws s3 cp "s3://${BUCKET}/models/win-probability/${MODEL_VERSION_ID}/win_probability_model_categories.json" \
  "$REPO_ROOT/apps/ml-api/models/win_probability_model_categories.json" --region "$REGION"

echo "Logging in to ECR..."
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"

echo "Building image..."
docker build --platform linux/amd64 -f "$REPO_ROOT/apps/ml-api/Dockerfile" -t "${ECR_REPO}:${MODEL_VERSION_ID}" "$REPO_ROOT"
docker tag "${ECR_REPO}:${MODEL_VERSION_ID}" "${ECR_URI}:${MODEL_VERSION_ID}"
docker tag "${ECR_REPO}:${MODEL_VERSION_ID}" "${ECR_URI}:latest"

echo "Pushing image..."
docker push "${ECR_URI}:${MODEL_VERSION_ID}"
docker push "${ECR_URI}:latest"

echo "Deploying code..."
if aws lambda get-function --function-name "$FUNCTION_NAME" --region "$REGION" >/dev/null 2>&1; then
  aws lambda update-function-code \
    --function-name "$FUNCTION_NAME" \
    --image-uri "${ECR_URI}:${MODEL_VERSION_ID}" \
    --region "$REGION" \
    --output text --query FunctionName
  aws lambda wait function-updated --function-name "$FUNCTION_NAME" --region "$REGION"
else
  echo "Function does not exist yet — creating (first deploy)..."
  # lambda-basic-exec is the same minimal (CloudWatch Logs only) role
  # hello-api already uses — this function needs no other AWS permissions
  # at runtime (model is baked into the image, no Mongo/S3 access here).
  ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/lambda-basic-exec"
  aws lambda create-function \
    --function-name "$FUNCTION_NAME" \
    --package-type Image \
    --code "ImageUri=${ECR_URI}:${MODEL_VERSION_ID}" \
    --role "$ROLE_ARN" \
    --timeout 30 \
    --memory-size 1024 \
    --region "$REGION" \
    --output text --query FunctionName
  aws lambda wait function-active --function-name "$FUNCTION_NAME" --region "$REGION"
fi

echo "Configuring runtime + secrets..."
LOCAL_CONFIG="$REPO_ROOT/config/local.json"
PREDICTION_API_KEY=""
if [ -f "$LOCAL_CONFIG" ]; then
  PREDICTION_API_KEY=$(node -e "const c=require('$LOCAL_CONFIG'); console.log((c.predictionApi && c.predictionApi.apiKey) || '')")
fi
aws lambda update-function-configuration \
  --function-name "$FUNCTION_NAME" \
  --timeout 30 \
  --memory-size 1024 \
  --environment "Variables={PREDICTION_API_KEY=$PREDICTION_API_KEY,MODEL_VERSION_ID=$MODEL_VERSION_ID}" \
  --region "$REGION" \
  --output text --query FunctionName

aws lambda wait function-updated --function-name "$FUNCTION_NAME" --region "$REGION"

rm -rf "$REPO_ROOT/apps/ml-api/models"

echo "Done. ${FUNCTION_NAME} now serving model ${MODEL_VERSION_ID}."
