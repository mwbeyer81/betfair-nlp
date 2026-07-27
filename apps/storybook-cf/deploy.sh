#!/bin/bash
# Build Storybook from the current checkout and deploy it to Cloudflare Pages.
# Serves at https://backbet-storybook.pages.dev (CF Pages project: backbet-storybook)
#
# Unlike apps/web-cf/deploy.sh (pinned to origin/main via a worktree),
# Storybook is an internal review tool meant to be deployed often from
# whatever branch is currently checked out — this always builds from the
# current working copy, same as apps/web-cf/deploy-dev.sh.
set -e

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
source "$(dirname "$0")/../common.sh"

if [ -z "$CLOUDFLARE_API_TOKEN" ]; then
  echo "Error: CLOUDFLARE_API_TOKEN env var is required" >&2
  exit 1
fi

BRANCH="${1:-main}"

echo "Building Storybook..."
cd "$REPO_ROOT/client"
yarn install --frozen-lockfile
yarn storybook:build

echo "Deploying to Cloudflare Pages..."
CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API_TOKEN" \
  npx wrangler pages deploy storybook-static \
    --project-name backbet-storybook \
    --branch "$BRANCH" \
    --commit-dirty=true

echo "Done. Storybook deployed to backbet-storybook.pages.dev"
