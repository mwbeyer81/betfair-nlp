#!/bin/bash
# Run once to create the S3 bucket and CloudFront distribution.
# After it completes, copy the Distribution ID into deploy.sh or pass as CF_DIST_ID.
set -e

BUCKET="betfair-nlp-web"
REGION="eu-north-1"

echo "Creating S3 bucket: $BUCKET in $REGION..."
aws s3api create-bucket \
  --bucket "$BUCKET" \
  --region "$REGION" \
  --create-bucket-configuration LocationConstraint="$REGION"

echo "Blocking all public access..."
aws s3api put-public-access-block \
  --bucket "$BUCKET" \
  --public-access-block-configuration \
  "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

echo "Creating CloudFront Origin Access Control..."
OAC_ID=$(aws cloudfront create-origin-access-control \
  --origin-access-control-config \
    "Name=betfair-nlp-web-oac,SigningProtocol=sigv4,SigningBehavior=always,OriginAccessControlOriginType=s3" \
  --query OriginAccessControl.Id \
  --output text)
echo "  OAC ID: $OAC_ID"

echo "Creating CloudFront distribution..."
DIST=$(aws cloudfront create-distribution --distribution-config "{
  \"CallerReference\": \"betfair-nlp-web-$(date +%s)\",
  \"Origins\": {
    \"Quantity\": 1,
    \"Items\": [{
      \"Id\": \"s3-betfair-nlp-web\",
      \"DomainName\": \"${BUCKET}.s3.${REGION}.amazonaws.com\",
      \"S3OriginConfig\": { \"OriginAccessIdentity\": \"\" },
      \"OriginAccessControlId\": \"${OAC_ID}\"
    }]
  },
  \"DefaultCacheBehavior\": {
    \"TargetOriginId\": \"s3-betfair-nlp-web\",
    \"ViewerProtocolPolicy\": \"redirect-to-https\",
    \"CachePolicyId\": \"658327ea-f89d-4fab-a63d-7e88639e58f6\",
    \"Compress\": true,
    \"AllowedMethods\": {
      \"Quantity\": 2,
      \"Items\": [\"GET\", \"HEAD\"],
      \"CachedMethods\": { \"Quantity\": 2, \"Items\": [\"GET\", \"HEAD\"] }
    }
  },
  \"CustomErrorResponses\": {
    \"Quantity\": 1,
    \"Items\": [{
      \"ErrorCode\": 403,
      \"ResponsePagePath\": \"/index.html\",
      \"ResponseCode\": \"200\",
      \"ErrorCachingMinTTL\": 0
    }]
  },
  \"DefaultRootObject\": \"index.html\",
  \"Enabled\": true,
  \"Comment\": \"betfair-nlp web client\"
}")

DIST_ID=$(echo "$DIST" | python3 -c "import sys,json; d=json.load(sys.stdin)['Distribution']; print(d['Id'])")
DIST_DOMAIN=$(echo "$DIST" | python3 -c "import sys,json; d=json.load(sys.stdin)['Distribution']; print(d['DomainName'])")

echo ""
echo "Attaching bucket policy so CloudFront OAC can read S3..."
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
aws s3api put-bucket-policy --bucket "$BUCKET" --policy "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [{
    \"Sid\": \"AllowCloudFront\",
    \"Effect\": \"Allow\",
    \"Principal\": { \"Service\": \"cloudfront.amazonaws.com\" },
    \"Action\": \"s3:GetObject\",
    \"Resource\": \"arn:aws:s3:::${BUCKET}/*\",
    \"Condition\": {
      \"StringEquals\": {
        \"AWS:SourceArn\": \"arn:aws:cloudfront::${ACCOUNT_ID}:distribution/${DIST_ID}\"
      }
    }
  }]
}"

echo ""
echo "=============================="
echo "Setup complete!"
echo "Distribution ID : $DIST_ID"
echo "CloudFront URL  : https://$DIST_DOMAIN"
echo ""
echo "Next steps:"
echo "  1. Wait ~5–10 min for CloudFront to deploy globally"
echo "  2. Run: CF_DIST_ID=$DIST_ID bash apps/web/deploy.sh"
echo "=============================="
