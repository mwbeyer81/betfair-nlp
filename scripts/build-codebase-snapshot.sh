#!/bin/bash
# Builds the read-only "codebase snapshot" the chat assistant's
# list_directory/search_code/read_file tools browse at runtime (see
# src/lib/service/codebase-file-access.ts's ALLOWED_PATHS). This is a build
# artifact (gitignored), not committed source — regenerate it any time an
# allowlisted file changes, and it always runs fresh as part of
# apps/lambda/build.sh so a deploy can never ship a stale one.
set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SNAPSHOT_DIR="$REPO_ROOT/src/lib/service/codebase-snapshot"

rm -rf "$SNAPSHOT_DIR"
mkdir -p "$SNAPSHOT_DIR/src/lib/dao" "$SNAPSHOT_DIR/src/lib/service" "$SNAPSHOT_DIR/src/commands" "$SNAPSHOT_DIR/ml"

# Only .ts files directly in dao/ and service/ — __tests__ subdirectories are
# never copied at all, so they can't leak in even if codebase-file-access.ts's
# denylist logic ever had a bug.
cp "$REPO_ROOT"/src/lib/dao/*.ts "$SNAPSHOT_DIR/src/lib/dao/"
cp "$REPO_ROOT"/src/lib/service/*.ts "$SNAPSHOT_DIR/src/lib/service/"
cp "$REPO_ROOT/src/commands/precompute-trainer-form.ts" "$SNAPSHOT_DIR/src/commands/"
cp "$REPO_ROOT/ml/train_and_predict.py" "$SNAPSHOT_DIR/ml/"
cp "$REPO_ROOT/README.md" "$SNAPSHOT_DIR/"

echo "Codebase snapshot built at $SNAPSHOT_DIR"
