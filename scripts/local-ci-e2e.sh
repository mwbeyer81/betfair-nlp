#!/usr/bin/env bash
# CI-style local E2E run: spins up a THROWAWAY mongod + backend + frontend,
# seeds a one-day CSV slice + a hardcoded test user, runs Playwright against
# them, then tears everything down again — regardless of how the run ends.
#
# Never touches the real shared dev mongod (localhost:27019, betfair_nlp_dev)
# or a developer's already-running backend (3000)/frontend (8081) — every
# port/db-name here is deliberately distinct. See
# .claude/commands/local-ci-e2e-tests.md for the full writeup.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
REPO_ROOT="$(pwd)"

# Overridable via LOCAL_CI_MONGO_PORT/LOCAL_CI_BACKEND_PORT/LOCAL_CI_FRONTEND_PORT
# (see .claude/commands/worktree-ports.md) so concurrent worktrees running this
# suite at the same time don't collide on these fixed defaults.
MONGO_PORT="${LOCAL_CI_MONGO_PORT:-27020}"
MONGO_DBPATH="$REPO_ROOT/.local-ci/mongo-data"
MONGO_DB_NAME="betfair_nlp_ci_test"
MONGO_URI="mongodb://localhost:${MONGO_PORT}"
BACKEND_PORT="${LOCAL_CI_BACKEND_PORT:-3050}"
FRONTEND_PORT="${LOCAL_CI_FRONTEND_PORT:-8090}"
JWT_SECRET="local-ci-test-secret-do-not-use-in-prod"
SCRATCH_DIR="$REPO_ROOT/.local-ci"
CSV_SOURCE="data/kaggle-horse-racing-uk-ireland/extracted/mini-update.csv"
SEED_FROM_DATE="2026-06-03"
SEED_TO_DATE="2026-06-03"
# Resolve mongod in this order: an explicit MONGOD_BIN (what
# /etc/profile.d/betfair-nlp.sh sets on the WSL box), then whatever is on PATH
# (a distro/native install), then the hand-unpacked tarball path the original
# EC2 box used. Auto-detecting rather than relying on MONGOD_BIN alone matters
# because profile.d is only sourced by login shells — a cron job or a plain
# `ssh host 'yarn test:e2e:local-ci'` would otherwise fall through to the EC2
# path and fail with a confusing "not found" on a machine where mongod is
# installed perfectly well.
MONGOD_BIN="${MONGOD_BIN:-$(command -v mongod || echo /home/ubuntu/mongodb-local/bin/mongod)}"
PYTHON_BIN="ml/venv/bin/python"

log() { echo "[local-ci-e2e] $*"; }

if [ ! -x "$MONGOD_BIN" ]; then
  echo "[local-ci-e2e] ERROR: mongod not found at '$MONGOD_BIN'." >&2
  echo "Install it (Ubuntu/WSL: the mongodb-org-server package) or set MONGOD_BIN to its path." >&2
  echo "This suite needs its OWN throwaway mongod binary to fork on port ${LOCAL_CI_MONGO_PORT:-27020};" >&2
  echo "an already-running system mongod on 27019 is deliberately not reused." >&2
  exit 1
fi

port_in_use() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null && { exec 3<&- 3>&-; return 0; }
  return 1
}

# --- Step 0: preflight ---------------------------------------------------
if [ -f "$SCRATCH_DIR/mongod.pid" ]; then
  log "Found stale mongod.pid from a previous run — attempting to kill it."
  kill "$(cat "$SCRATCH_DIR/mongod.pid")" 2>/dev/null || true
  sleep 1
fi

if [ ! -x "$PYTHON_BIN" ]; then
  echo "[local-ci-e2e] ERROR: $PYTHON_BIN not found." >&2
  echo "This worktree needs its own real Python venv (not symlinked) for the daily-races" >&2
  echo "model prediction step: python3 -m venv ml/venv && ml/venv/bin/pip install -r ml/requirements.txt" >&2
  exit 1
fi

for p in "$MONGO_PORT" "$BACKEND_PORT" "$FRONTEND_PORT"; do
  if port_in_use "$p"; then
    echo "[local-ci-e2e] ERROR: port $p is already in use." >&2
    echo "This suite uses fixed ports (mongo=$MONGO_PORT, backend=$BACKEND_PORT, frontend=$FRONTEND_PORT)" >&2
    echo "deliberately distinct from real dev (27019/3000/8081) so it never collides with a" >&2
    echo "developer's running services — but something else already holds port $p." >&2
    echo "Check what it is (ps aux, not lsof — see AGENTS.md) and stop it, or wait for it to exit." >&2
    exit 1
  fi
done

rm -rf "$SCRATCH_DIR"
mkdir -p "$SCRATCH_DIR/mongo-data" "$SCRATCH_DIR/logs"

# --- Step 1: guaranteed teardown ------------------------------------------
BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
  local rc=$?
  # Unregister first — this function ends with `exit`, which would
  # otherwise re-trigger the EXIT trap and run cleanup a second time.
  trap - EXIT INT TERM
  log "Tearing down (exit code $rc)..."
  # Kill by PROCESS GROUP (`kill -- -PGID`), not by single PID or by asking
  # the kernel which process holds a port: `npx serve` in particular forks a
  # multi-process chain (npm exec -> sh -c -> the real serve process), so a
  # plain `kill $FRONTEND_PID` on the outermost PID left the real server
  # running and still bound to the port (confirmed the hard way). Tried
  # `fuser -k -n tcp <port>` next — also confirmed the hard way that
  # unprivileged fuser/`ss -p` can't see another process's socket ownership
  # in this sandbox at all (same category of restriction AGENTS.md already
  # documents for `lsof`), so it silently found nothing to kill. Both
  # backend and frontend are launched below via `setsid`, which makes that
  # top-level PID double as the whole tree's process group ID — killing
  # `-$PID` reaches every descendant regardless of how many npx/npm/sh
  # layers are in between, with no OS-level port/process introspection
  # needed at all.
  if [ -n "$FRONTEND_PID" ]; then
    kill -- "-$FRONTEND_PID" 2>/dev/null || true
  fi
  if [ -n "$BACKEND_PID" ]; then
    kill -- "-$BACKEND_PID" 2>/dev/null || true
  fi
  if [ -f "$SCRATCH_DIR/mongod.pid" ]; then
    kill "$(cat "$SCRATCH_DIR/mongod.pid")" 2>/dev/null || true
  fi
  sleep 1
  # Belt-and-braces: SIGKILL anything from either group that ignored the
  # above (e.g. mid-request Node handlers delaying a graceful SIGTERM exit).
  if [ -n "$FRONTEND_PID" ]; then
    kill -9 -- "-$FRONTEND_PID" 2>/dev/null || true
  fi
  if [ -n "$BACKEND_PID" ]; then
    kill -9 -- "-$BACKEND_PID" 2>/dev/null || true
  fi
  rm -rf "$SCRATCH_DIR/mongo-data"
  log "Teardown complete."
  exit "$rc"
}
trap cleanup EXIT INT TERM

# --- Step 2: start throwaway mongod ---------------------------------------
log "Starting throwaway mongod on port $MONGO_PORT..."
"$MONGOD_BIN" \
  --dbpath "$MONGO_DBPATH" --port "$MONGO_PORT" --bind_ip 127.0.0.1 \
  --fork --logpath "$SCRATCH_DIR/logs/mongod.log" \
  --pidfilepath "$SCRATCH_DIR/mongod.pid"

for i in $(seq 1 20); do
  if node -e "require('mongodb').MongoClient.connect('$MONGO_URI').then(c => (c.close(), process.exit(0))).catch(() => process.exit(1))" 2>/dev/null; then
    break
  fi
  if [ "$i" -eq 20 ]; then
    echo "[local-ci-e2e] ERROR: mongod never became reachable on $MONGO_URI — see $SCRATCH_DIR/logs/mongod.log" >&2
    exit 1
  fi
  sleep 0.5
done
log "mongod is up."

# --- Step 3: seed CSV slice -------------------------------------------------
log "Seeding CSV slice ($SEED_FROM_DATE) into $MONGO_DB_NAME..."
IMPORT_OUTPUT=$(SOURCE_CSV="$CSV_SOURCE" FROM_DATE="$SEED_FROM_DATE" TO_DATE="$SEED_TO_DATE" DROP_FIRST=true \
  MONGODB_URI="$MONGO_URI" MONGODB_DB_NAME="$MONGO_DB_NAME" \
  npx ts-node src/commands/import-industry-sp.ts 2>&1 | tee "$SCRATCH_DIR/logs/seed-csv.log")
echo "$IMPORT_OUTPUT" | tail -5

BUILT_LINE=$(echo "$IMPORT_OUTPUT" | grep "Built .* race docs" || true)
if [ -z "$BUILT_LINE" ]; then
  echo "[local-ci-e2e] ERROR: import script did not report a 'Built N race docs' line — see $SCRATCH_DIR/logs/seed-csv.log" >&2
  exit 1
fi
BUILT_COUNT=$(echo "$BUILT_LINE" | sed -E 's/Built ([0-9]+) race docs.*/\1/')
if [ "$BUILT_COUNT" -eq 0 ]; then
  echo "[local-ci-e2e] ERROR: seed imported 0 races — FROM_DATE/TO_DATE window ($SEED_FROM_DATE) matched nothing." >&2
  exit 1
fi
log "Seeded $BUILT_COUNT races."

# --- Step 3b: seed Daily Races fixture ---------------------------------------
# A committed /v1/racecards/free-shaped fixture, never the real live
# RacingAPI — see src/lib/dao/__fixtures__/daily-racecards-free-response.json
# and src/commands/seed-daily-races-fixture.ts.
log "Seeding Daily Races fixture into $MONGO_DB_NAME..."
MONGODB_URI="$MONGO_URI" MONGODB_DB_NAME="$MONGO_DB_NAME" \
  npx ts-node src/commands/seed-daily-races-fixture.ts 2>&1 | tee "$SCRATCH_DIR/logs/seed-daily-races.log"

# --- Step 3c: seed the industry_starting_prices/daily-races overlap fixture -
# Deliberately overlapping trainer/jockey/horse names with the Daily Races
# fixture above, so daily-race-feature-service.ts's real historical joins
# have something real to match — see
# src/lib/dao/__fixtures__/industry-sp-daily-races-overlap-fixture.json.
log "Seeding industry-sp/daily-races overlap fixture..."
MONGODB_URI="$MONGO_URI" MONGODB_DB_NAME="$MONGO_DB_NAME" \
  npx ts-node src/commands/seed-industry-sp-overlap-fixture.ts 2>&1 | tee "$SCRATCH_DIR/logs/seed-overlap-fixture.log"

# --- Step 3d: install the committed CI-fixture model + seed its evaluation -
# A real model trained once, offline, on the CSV slice's full available date
# range + the overlap fixture (see ml/fixtures/) — keeps local-ci fast and
# deterministic, no real training run in the hot path.
log "Installing CI-fixture model..."
mkdir -p ml/models
cp ml/fixtures/win_probability_model.ci-fixture.json ml/models/win_probability_model.json
cp ml/fixtures/win_probability_model_categories.ci-fixture.json ml/models/win_probability_model_categories.json
MONGODB_URI="$MONGO_URI" MONGODB_DB_NAME="$MONGO_DB_NAME" \
  npx ts-node src/commands/seed-model-evaluation-fixture.ts 2>&1 | tee "$SCRATCH_DIR/logs/seed-model-evaluation.log"

# --- Step 3e: compute daily-race features + predict win probabilities ------
# Read-only against industry_starting_prices (the CSV slice + overlap
# fixture seeded above) — see daily-race-feature-service.ts. Then scores
# daily_racecards with the CI-fixture model installed above — no retraining.
log "Computing daily race features..."
MONGODB_URI="$MONGO_URI" MONGODB_DB_NAME="$MONGO_DB_NAME" DAILY_RACE_DATE="$SEED_FROM_DATE" \
  npx ts-node src/commands/compute-daily-race-features.ts 2>&1 | tee "$SCRATCH_DIR/logs/compute-daily-race-features.log"

log "Running daily-races model prediction..."
# predict_daily_races.py imports train_and_predict.py via a same-directory
# relative import, so it must run with cwd=ml/ (not repo root).
(cd ml && MONGODB_URI="$MONGO_URI" MONGODB_DB_NAME="$MONGO_DB_NAME" DAILY_RACE_DATE="$SEED_FROM_DATE" \
  "$REPO_ROOT/$PYTHON_BIN" predict_daily_races.py) 2>&1 | tee "$SCRATCH_DIR/logs/predict-daily-races.log"

# --- Step 3f: seed synthetic model probabilities onto the ISP slice ---------
# The steps above only ever score daily_racecards — nothing writes
# modelWinProbability back onto industry_starting_prices (that's
# ml/train_and_predict.py's job, and a real retrain is far too slow and
# non-deterministic for this hot path). Without this, /api/model-accuracy has
# nothing to aggregate and its e2e specs could only ever assert the empty
# state. The values are explicitly synthetic — see the header comment in
# src/commands/seed-isp-model-probabilities.ts.
log "Seeding synthetic model probabilities onto the ISP slice..."
MONGODB_URI="$MONGO_URI" MONGODB_DB_NAME="$MONGO_DB_NAME" \
  npx ts-node src/commands/seed-isp-model-probabilities.ts 2>&1 | tee "$SCRATCH_DIR/logs/seed-isp-model-probabilities.log"

# --- Step 4: seed hardcoded test user ---------------------------------------
log "Seeding hardcoded test user..."
MONGODB_URI="$MONGO_URI" MONGODB_DB_NAME="$MONGO_DB_NAME" \
  npx ts-node scripts/seed-local-ci-user.ts

# --- Step 5: start backend, wait for health ---------------------------------
log "Starting backend on port $BACKEND_PORT..."
# `setsid` makes this PID double as the process group leader for the whole
# tree it spawns (see the cleanup() comment above) — this also calls
# node_modules/.bin/ts-node directly rather than through `npx`, since it's
# already a project devDependency and there's no reason to add an extra
# layer of indirection here. Vars are exported inside the subshell (not
# prefixed on the command line) because `setsid` execs its argument as a
# program, and can't itself parse shell `VAR=val` prefix syntax.
(
  export MONGODB_URI="$MONGO_URI" MONGODB_DB_NAME="$MONGO_DB_NAME" JWT_SECRET="$JWT_SECRET"
  export NODE_CONFIG="{\"server\":{\"port\":$BACKEND_PORT}}"
  exec setsid ./node_modules/.bin/ts-node src/server/index.ts
) > "$SCRATCH_DIR/logs/backend.log" 2>&1 &
BACKEND_PID=$!

# /health is registered AFTER the global `router.use(jwtAuth)` gate
# (router.ts:581/630), so it 401s without a token — not a useful
# unauthenticated readiness probe here. Polling the seeded user's actual
# login instead is a better signal anyway: a 200 here proves the backend is
# up, connected to Mongo, AND that the seeded test user is really queryable
# — exactly what the specs need, not just a DB-connected flag.
# 40 x 0.5s = 20s, enough on an idle box but not on a busy one: ts-node
# compiles the whole server from source here, and on a 2-core machine also
# running a Storybook/Playwright job the cold start outlasts it — observed
# as 37 connection-refused attempts followed by 3 real 500s, because
# initializeServices had not yet reached `authService = ...`. Reads as a
# hard failure when it is only slowness. Overridable; default unchanged.
for i in $(seq 1 "${LOCAL_CI_LOGIN_RETRIES:-40}"); do
  LOGIN_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
    -H "Content-Type: application/json" \
    -d '{"email":"matthew@backbet.co.uk","password":"beyer"}' \
    "http://localhost:$BACKEND_PORT/api/auth/login" 2>/dev/null || echo "000")
  if [ "$LOGIN_STATUS" = "200" ]; then
    break
  fi
  if [ "$i" -eq "${LOCAL_CI_LOGIN_RETRIES:-40}" ]; then
    echo "[local-ci-e2e] ERROR: backend never accepted the seeded user's login on port $BACKEND_PORT (last status: $LOGIN_STATUS) — see $SCRATCH_DIR/logs/backend.log" >&2
    exit 1
  fi
  sleep 0.5
done
log "Backend is up."

# --- Step 6: build + serve frontend -----------------------------------------
log "Building frontend (EXPO_PUBLIC_API_URL=http://localhost:$BACKEND_PORT)..."
(cd client && EXPO_PUBLIC_API_URL="http://localhost:$BACKEND_PORT" \
   npx expo export --platform web --dev --output-dir dist-local-ci) \
  > "$SCRATCH_DIR/logs/frontend-build.log" 2>&1

log "Serving frontend on port $FRONTEND_PORT..."
# `setsid` (see the cleanup() comment above) — this one matters even more
# than for the backend, since `npx serve` forks a multi-process chain
# (npm exec -> sh -c -> the real serve process) that a single-PID `kill`
# can't reach at all; killing the whole process group is the only reliable
# way to actually stop it.
(cd client && exec setsid npx serve -s dist-local-ci -p "$FRONTEND_PORT" > "$SCRATCH_DIR/logs/frontend.log" 2>&1) &
FRONTEND_PID=$!

for i in $(seq 1 40); do
  if curl -sf -o /dev/null "http://localhost:$FRONTEND_PORT" 2>/dev/null; then
    break
  fi
  if [ "$i" -eq 40 ]; then
    echo "[local-ci-e2e] ERROR: frontend never became reachable on port $FRONTEND_PORT — see $SCRATCH_DIR/logs/frontend.log" >&2
    exit 1
  fi
  sleep 0.5
done
log "Frontend is up."

# --- Step 7: run Playwright --------------------------------------------------
log "Running Playwright suite..."
set +e
# Playwright cannot install its own chromium on ubuntu 26.04 (see
# playwright.local-ci.config.ts), so a system browser is used. Prefer an
# explicit env var, then Google Chrome (what the WSL box has), then the snap
# chromium the EC2 box had.
SYSTEM_CHROME="${PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH:-}"
if [ -z "$SYSTEM_CHROME" ]; then
  for candidate in /usr/bin/google-chrome-stable /snap/bin/chromium /usr/bin/chromium; do
    if [ -x "$candidate" ]; then SYSTEM_CHROME="$candidate"; break; fi
  done
fi
(cd client && PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="$SYSTEM_CHROME" \
  npx playwright test --config playwright.local-ci.config.ts)
TEST_EXIT_CODE=$?
set -e

log "Playwright exited with code $TEST_EXIT_CODE."
exit "$TEST_EXIT_CODE"
