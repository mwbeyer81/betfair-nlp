# Local CI-Style E2E Tests

Run the full E2E suite unattended against a completely self-contained local
stack — real backend, real frontend, real (throwaway) Mongo, no mocking —
that gets built from nothing and torn down completely afterward. Unlike
`client/tests/*.spec.ts` (assumes you already started the dev backend/Mongo
by hand), this needs nothing running beforehand and never touches the
shared dev Mongo.

## Instructions

One command, from the repo root:

```bash
yarn test:e2e:local-ci
```

This runs `scripts/local-ci-e2e.sh`, which:
1. Starts a throwaway `mongod` (own dbpath, own port — never the shared dev instance).
2. Seeds a one-day slice of the CSV data and a hardcoded test user directly into it.
3. Starts the backend and a built copy of the frontend, pointed at that throwaway DB.
4. Runs `npx playwright test --config playwright.local-ci.config.ts` from `client/`.
5. Tears everything down — regardless of whether the tests passed, failed, or the script was interrupted (`Ctrl-C`).

### Ports / DB / identity used

| | Value | Real dev equivalent |
|---|---|---|
| Mongo | `localhost:27020`, db `betfair_nlp_ci_test` | `localhost:27019`, db `betfair_nlp_dev` |
| Backend | `localhost:3050` | `localhost:3000` |
| Frontend | `localhost:8090` | `localhost:8081` |
| Test login | `matthew@backbet.co.uk` / `beyer` | same identity used throughout `client/tests*/` |

All three ports are deliberately distinct from real dev so this can run
alongside a developer's normal local session without any collision. If a
port is already in use, the script aborts with an error naming it rather
than silently picking another (the test specs hardcode these ports).

Overridable via `LOCAL_CI_MONGO_PORT`/`LOCAL_CI_BACKEND_PORT`/`LOCAL_CI_FRONTEND_PORT`
env vars (defaults unchanged) if you need two worktrees running this suite
at the same time — see `/worktree-ports`. Note this only moves the
server-side ports; the spec files under `client/tests-local-ci/` still
hardcode `localhost:3050`/`localhost:8090` in their requests/`page.goto`
calls, so a fully isolated concurrent run also needs those literals updated
to match — not done today, since every existing spec already hardcodes them
this way.

### Seeded data

`data/kaggle-horse-racing-uk-ireland/extracted/mini-update.csv`, restricted
to **2026-06-03** only, imported via the existing `import:industry-sp`
command (`FROM_DATE`/`TO_DATE`/`SOURCE_CSV` env vars — no code changes).
That day yields exactly 4 GB meetings after the importer's own UK-only
allowlist filter (non-GB rows on that date — Curragh/IE, Happy Valley/HK,
Saratoga/US — are dropped): **Newton Abbot, Nottingham, Ripon, Warwick**
(24 races). The anchor race used by the specs is `raceId 919979`
(Nottingham, 14:48) — winner **The Ginger Kid (IRE)**, jockey Kieran
Shoemark, trainer Ed Walker, ISP `20/1`, 12 runners — verified directly
against the raw CSV row, not assumed. Note `data/` itself is gitignored (as
it already was before this suite existed) — the CSV must already be present
on whatever machine runs this, same as every other seeding path in this repo.

Also seeded: a Daily Races fixture (`src/lib/dao/__fixtures__/daily-racecards-free-response.json`,
a hand-written realistic `/v1/racecards/free` shape, never the real live
RacingAPI) via `src/commands/seed-daily-races-fixture.ts` — 5 races across 3
courses on the same 2026-06-03 date: **Newton Abbot** (`rac_test_0001`,
2 runners including "Fixture Star"/trainer "A Trainer"; `rac_test_0002`, 1
runner), **Ascot** (`rac_test_0003`, `rac_test_0004`), **Chepstow**
(`rac_test_0005`).

The test user is inserted directly via `scripts/seed-local-ci-user.ts`
(bcrypt hash, `emailVerified: true`) — bypassing real signup entirely. This
is only safe/acceptable because the target DB is destroyed and rebuilt on
every run; the equivalent shortcut against the real dev/prod DB is
deliberately avoided elsewhere in this codebase (see the comment in
`auth-service.ts` about not using an "unvalidated seeding backdoor").

### Where to look when a run fails

Logs land in `.local-ci/logs/` (git-ignored, wiped at the start of the next
run): `mongod.log`, `seed-csv.log`, `seed-daily-races.log`, `backend.log`,
`frontend-build.log`, `frontend.log`.

### Troubleshooting: "port already in use"

Check what's actually holding the port with `ps aux | grep <port>` — **not
`lsof`**, which `AGENTS.md` documents as unreliable in this sandbox. If it's
a stale process from a previous crashed run of this same script, kill it and
re-run; if it's a developer's real dev backend/frontend/Mongo, this suite's
ports (27020/3050/8090) shouldn't ever collide with those (27019/3000/8081)
— a collision here means something unexpected is running, worth
investigating rather than just picking a different port.

### Adding a new test

While building a new feature, run `yarn test:e2e:local-ci` repeatedly as
you go (not just once at the end) — see `AGENTS.md`'s "Testing new
features" section. Add tests to `client/tests-local-ci/` as an **inverted
pyramid — UI > API > integration**, most coverage at the top:

1. **UI first** — a real-browser test via `page.goto` using the
   `?email=&password=` login convention (see
   `client/tests/industry-sp-e2e.spec.ts`) against `http://localhost:8090`,
   actually driving the new feature the way a user would.
2. **API second** — request-level tests via Playwright's `request` fixture
   hitting `http://localhost:3050` directly, covering shapes/status
   codes/auth the UI test doesn't exercise on its own.
3. **Integration/DB last, and lightest** — only add a direct check when the
   above two don't already prove the data landed correctly.

Because the seeded dataset is small and fully known, prefer exact
assertions (specific race/runner values) over the sampling-style assertions
the shared-dev-DB specs use.
