#!/usr/bin/env bash
# Claims a stable port-offset index for a git worktree from a shared,
# flock-protected registry outside any worktree, then prints `export
# VAR=port` lines for every local dev/test port this repo's tooling can
# bind to. Idempotent — re-running for a slug that already has an index
# returns the same ports every time.
#
# Usage:
#   eval "$(scripts/claim-worktree-ports.sh <slug>)"
#
# See .claude/commands/worktree-ports.md for the full port table and why
# this exists: multiple agents run concurrent worktrees on this VM, and
# fixed default ports (Storybook 6006/6007, MSW Playwright 3737, etc.) have
# caused repeated real collisions — see AGENTS.md's dated incident log.
set -euo pipefail

SLUG="${1:-}"
if [ -z "$SLUG" ]; then
  echo "Usage: $0 <worktree-slug>" >&2
  exit 1
fi

REGISTRY="$HOME/.betfair-nlp-worktree-ports.json"
LOCKFILE="$HOME/.betfair-nlp-worktree-ports.lock"

if [ ! -f "$REGISTRY" ]; then
  echo '{"slugs":{},"nextIndex":0}' > "$REGISTRY"
fi

INDEX=$(
  flock "$LOCKFILE" node -e "
    const fs = require('fs');
    const path = '$REGISTRY';
    const slug = '$SLUG';
    const reg = JSON.parse(fs.readFileSync(path, 'utf8'));
    if (!(slug in reg.slugs)) {
      reg.slugs[slug] = reg.nextIndex;
      reg.nextIndex += 1;
      fs.writeFileSync(path, JSON.stringify(reg, null, 2));
    }
    process.stdout.write(String(reg.slugs[slug]));
  "
)

cat <<EOF
export WORKTREE_PORT_INDEX=$INDEX
export NODE_CONFIG='{"server":{"port":$((3010 + INDEX))}}'
export EXPO_WEB_PORT=$((8091 + INDEX))
export STORYBOOK_PORT=$((6100 + INDEX))
export STORYBOOK_HEADLESS_PORT=$((6200 + INDEX))
export MSW_PORT=$((3800 + INDEX))
export LOCAL_CI_MONGO_PORT=$((27100 + INDEX))
export LOCAL_CI_BACKEND_PORT=$((3100 + INDEX))
export LOCAL_CI_FRONTEND_PORT=$((8200 + INDEX))
EOF
