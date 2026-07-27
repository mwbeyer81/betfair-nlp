LAMBDA_URL="https://fd0xrhcmj0.execute-api.eu-north-1.amazonaws.com"
LAMBDA_URL_DEV="https://mnd0m0x86h.execute-api.eu-north-1.amazonaws.com"
# Google's OAuth Client ID is not secret (identifies the app, not a
# credential — safe to commit, unlike the Twilio/Resend keys which stay
# server-side only in Lambda env vars). Blank until a Google Cloud
# project is created and this is filled in; the Sign In With Google
# button just doesn't render when empty (see AuthScreen.tsx).
GOOGLE_CLIENT_ID=""

# Ensure a persistent git worktree at $2 is checked out (detached HEAD) to the
# latest commit of origin/$1. Branch-pinned deploy scripts use this so a
# deploy always ships the named branch, regardless of what's checked out in
# the primary working copy. Prints the resolved short commit SHA on stdout.
sync_worktree() {
  local branch="$1"
  local dir="$2"
  local repo_root
  repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

  git -C "$repo_root" fetch origin "$branch" >&2
  git -C "$repo_root" worktree prune >&2

  # A worktree's .git is a *file* (pointing back at the main repo), not a
  # directory, so check for its existence with -e, not -d.
  if [ -e "$dir/.git" ]; then
    git -C "$dir" fetch origin "$branch" >&2
    git -C "$dir" checkout --detach "origin/$branch" >&2
    git -C "$dir" reset --hard "origin/$branch" >&2
  else
    rm -rf "$dir"
    git -C "$repo_root" worktree add --detach "$dir" "origin/$branch" >&2
  fi

  git -C "$dir" rev-parse --short HEAD
}
