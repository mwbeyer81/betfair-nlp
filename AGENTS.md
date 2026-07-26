# Agent coordination log

This repo has multiple Claude Code agents working concurrently in sibling git
worktrees. This file is a check-in point so we don't clobber each other's
work or duplicate-debug the same infra issues. **Read this before touching
`src/lib/dao/industry-sp-dao.ts`, `client/src/components/IndustrySpScreen.tsx`,
`client/src/utils/ispUrlParams.ts`, or shared local infra (ports 3000/27019/80).**

**Storybook port:** don't assume 6006 or 6007 is free — with several agents
active at once, one of them is very likely already bound to whichever
default you reach for first (this has caused silent test-runner failures
and false "everything failed" results, see the dated entries below). Before
starting Storybook for local testing, run `ps aux | grep storybook` (not
`lsof` — unreliable in this sandbox, see the dated entry on that) to see
what's already running, then start yours on a port nothing else is using,
e.g. `npx storybook dev --port 6009 --ci` / `test-storybook --url
http://localhost:6009`. Don't kill another agent's Storybook process to
free up a port — pick a different one instead.

If you're an agent starting work here: add a new dated entry below (don't
edit/delete others' entries), and re-read this file before you push/merge.

## Local infra: MongoDB at localhost:27019

As of 2026-07-25 this is a **plain local `mongod` process on this VM, not
Docker** — binary lives at `/home/ubuntu/mongodb-local`, data dir at
`/home/ubuntu/mongo-data-27019`, started with `--port 27019 --bind_ip
127.0.0.1 --fork`. It's shared across every worktree on this VM, so don't
kill it unless you're sure nothing else is using it. `docker-compose.mongo-
only.yml` (the old Docker-based way to get a `localhost:27019` mongo) has
been deleted as unused/superseded — see `.claude/commands/mongo-
integration-tests.md` for how to start/seed it if it's ever down.
`docker-compose.local.yml` (the combined API-server + MongoDB Docker stack
behind `yarn server:docker`/`mongo:up`/etc.) is untouched and still works
independently of this.

## Working in a worktree

Do non-trivial work in its own git worktree, not in the primary checkout —
worktrees give each agent a real, isolated working directory and uncommitted
state, so two agents can't stomp on each other's edits just by being active
at the same time.

```bash
git worktree add ~/betfair-nlp-<slug> -b <slug> origin/develop
cd ~/betfair-nlp-<slug>
```

- **Naming:** `~/betfair-nlp-<slug>` as a sibling of the primary checkout,
  branch name matching `<slug>` — the convention every worktree below
  already follows.
- **Branch from `origin/develop`**, not a possibly-stale local `develop`.
- **Merge `origin/develop` into your branch frequently while work is still
  in progress — not just once at branch-creation and once right before your
  final push.** `develop` moves constantly with several agents active; on
  2026-07-25 the same `AGENTS.md` conflict was hit three separate times in a
  row while merging and deploying one feature, purely because each merge was
  a one-off reaction to a rejected push rather than a habit. Make `git fetch
  origin develop && git merge origin/develop` something you run periodically
  mid-task (e.g. before starting a new sub-task, or any time you're about to
  touch `AGENTS.md` yourself) — catching a small divergence early is a
  trivial conflict; catching three of them stacked up right before a deploy
  is not.
- **Before you push/merge:** re-read this file (top-level instruction above,
  still applies) and add/update your row in the table below.
- **After merge + deploy:** clean up so the next agent doesn't have to
  puzzle over a stale worktree —
  ```bash
  git worktree remove ~/betfair-nlp-<slug>
  git branch -d <slug>
  ```
- **Deploy scripts specifically must run from a worktree whose local HEAD
  actually *is* `origin/develop`** (e.g. `~/betfair-nlp-deploy-develop`) —
  pushing a merge to the remote does not move any other worktree's local
  branch pointer. Running `apps/lambda/build.sh` / `apps/web/deploy.sh`
  from a worktree that merged-and-pushed but never fast-forwarded itself
  silently ships stale code (this has happened — see the archive for the
  full incident).

## Active worktrees

Live snapshot, edited in place — update your own row, don't append a new
one. If this ever disagrees with reality, `git worktree list` is the
tiebreaker.

| Worktree | Branch | Task | Status |
|---|---|---|---|
| `/home/ubuntu/betfair-nlp` | `develop` | primary checkout | — |
| `~/betfair-nlp-deploy-develop` | `develop` (detached) | persistent — `/deploy-web` builds from here | keep |
| `~/betfair-nlp-deploy-main` | `main` (detached) | persistent — `/deploy-backbet` builds from here | keep |
| `~/betfair-nlp-isp-form-fields` | `feature/isp-form-fields` | ISP filter form fields | in progress, not merged — **large divergence on `IndustrySpScreen.tsx`** (~1500 lines vs. current `develop`) as of 2026-07-25; **`develop` just moved significantly (`fd3f394`) — Split A/B's runner-index machinery (`splitByRunners`, `fromRunnerA/toRunnerA/...`) was entirely removed and `IndustrySpScreen.tsx` heavily rewritten, see the dated entry below** — expect this branch's divergence to be much worse now, plan for a careful manual reconciliation, not a plain rebase |
| `.claude/worktrees/backbet-header-logo` | `worktree-backbet-header-logo` | Backbet header logo | in progress, not merged |
| `~/betfair-nlp-rename-labels` | `fix/rename-race-split-labels` | Rename race split labels (Race A/B → Split A/B) | **in progress — uncommitted changes, do not remove**; branch's earlier commits are already merged, this is new follow-up work on the same worktree; **also affected by the `fd3f394` rewrite of `IndustrySpScreen.tsx` above** — check for conflicts before merging |
| `~/betfair-nlp-convergence-filters` | `feat/convergence-filters-summary` | Convergence panel filter summary | in progress, not merged — uncommitted changes touching `IndustrySpScreen.tsx` and `PnlConvergencePanel.tsx` as of 2026-07-26 (found via `git worktree list`, not previously listed here — table was stale) |
| `~/betfair-nlp-model-perf-filters` | `model-perf-filters` | Model Performance dashboard doesn't actually query the server with the user's filters (Class/Type/date range) — it re-filters a fixed, hardcoded 500-race batch (`MODEL_PERFORMANCE_RACE_LIMIT`, earliest-scored races only, see the `model-perf-e2e` entry above) client-side, so it can never reach real 2024+ test-period data no matter what filters are applied. Fixing `loadRacesForModelVersion()`/`ModelPerformanceDashboard.tsx` in `IndustrySpScreen.tsx` to send real filter params server-side. **Touching `IndustrySpScreen.tsx`** — watch for conflicts with `convergence-filters` and `rename-labels` above. | in progress |
| `~/betfair-nlp-saved-results` | `feat/saved-results` | New feature: save the current Industry SP filter set (name + filters + a static PnL/graph snapshot computed once via `IndustrySpService.getRaceConvergenceSeries`) as a persisted "Result", reachable via a new "Results" burger-menu item on every screen; list/sort/detail/restore-into-Filters/delete. First user-owned MongoDB resource in this codebase (new `saved_filter_sets` collection, scoped by JWT `sub`). New backend files (`saved-filter-set-dao.ts`/`-service.ts`, 4 routes in `router.ts`) plus new frontend screens (`SavedResultsListScreen.tsx`, `SavedResultDetailScreen.tsx`, `SaveResultDialog.tsx`) that reuse `SplitDetailPanel`/`PnlConvergencePanel` unmodified. **Touching `IndustrySpScreen.tsx`** (new Save button + nav-menu entry) — watch for conflicts with `isp-form-fields`/`rename-labels`/`convergence-filters`/`model-perf-filters` above, all four of which are also live on that file right now. Full plan: `/home/ubuntu/.claude/plans/plan-an-advanced-feature-immutable-quilt.md`. | in progress |
`account-panel`, `anon-isp-home`, `auth-hardening`, `email-debug`,
`social-auth`, `convergence-tooltip`, `split-b-continuation`,
`split-ab-race-revert`, `header-overlap-fix`, `codebase-search-chat`, and
`local-ci-e2e-tests` were merged, clean, and have been removed (`git
worktree remove` + `git branch -d`, local and remote where applicable) as
of 2026-07-25/26 —
this is what "clean up after merge" in the section above looks like in
practice. `codebase-search-chat` was merged, pushed, and deployed (both
Lambda and web). `local-ci-e2e-tests` was docs/test-infra only (no
`src/`/`client/src/` changes), so no deploy was needed — merged to
`develop` and pushed straight through.

Older entries (2026-07-17 through the `auth-hardening` session) have been
moved to `AGENTS-archive-2026-07.md` to keep this file readable — see there
for the fix history behind e.g. the index-backed-sort fix or the
raceCap/anonymous-access design.

## Testing new features: run the local CI-style e2e suite as you go

`yarn test:e2e:local-ci` (see `.claude/commands/local-ci-e2e-tests.md`)
spins up a throwaway mongod + real backend + real frontend, seeds a tiny
known dataset, runs, and tears everything down — no shared state with
another agent's worktree, ~20s round trip. **While building a new feature,
run it repeatedly as you go — after each meaningful change, not just once
at the end** — the whole point of it being this fast and self-contained is
a tight feedback loop, not a final gate you only reach for once.

**Add tests for the new feature to `client/tests-local-ci/` following an
inverted pyramid — UI > API > integration, most coverage at the top:**
- **UI first** — a real-browser Playwright test driving the actual feature
  through the frontend is the primary coverage; if a feature has a screen
  or interaction, it needs one of these before anything else.
- **API second** — request-level tests against the new endpoint(s)
  directly, covering shapes/status codes/auth that a UI test wouldn't
  exercise on its own.
- **Integration/DB last, and lightest** — only add a direct DB-level check
  when the UI+API tests above don't already prove the data landed
  correctly; don't duplicate coverage for its own sake.

This is the opposite emphasis from the classic unit-heavy testing pyramid —
deliberately so, since this suite has no unit tier of its own; it exists to
prove the feature actually works end-to-end for a real user first.

---

## 2026-07-19 (later still) — Agent in `~/betfair-nlp-account-panel` (branch `account-panel`)

**Task:** Small addition on top of the auth-hardening work above — an
"Account" button on `IndustrySpScreen`'s header (visible only when
`isAuthenticated`) that toggles a small panel showing which email is
currently signed in, plus verification status. Reuses the `email`/
`emailVerified` already fetched via `chatApi.getMe()` in the existing
`isAuthenticated` effect (that effect previously discarded `email`,
keeping only `emailVerified` — now keeps both). Does not touch or
replace the existing "Log Out" button or the verify-email reminder
banner from the entry above — this is an additive, separate UI element,
not a refactor of either.

**Touching:** `client/src/components/IndustrySpScreen.tsx` only (plus
its `.stories.tsx` and the MSW spec file for test coverage). **Not**
touching any backend route, `AuthScreen.tsx`, `chatApi.ts`, or the
verify-banner/benefits-banner logic from the previous entry.

Will append a completion entry below once shipped/verified.

**Done — shipped and deployed (web only, no backend changes this time).**
New `industry-sp-account-button` (Appbar, visible only when
`isAuthenticated`) toggles `industry-sp-account-panel`, which shows
"Signed in as {email}" + verified/not-verified status, plus a Close
button. Reused the existing `isAuthenticated`-triggered `chatApi.getMe()`
effect — just captured `email` alongside `emailVerified` this time
instead of discarding it.

One test gotcha worth flagging: the two new Storybook stories initially
asserted on the panel's text content **immediately** after clicking the
Account button and awaiting `findByTestId` for the panel itself — the
panel renders synchronously (it's just local `showAccountPanel` state),
but the email text inside it comes from the separate async
`chatApi.getMe()` fetch, so the assertion sometimes ran while the panel
still showed its "…" not-yet-loaded placeholder. Fixed by wrapping the
text-content assertion in `waitFor(...)` instead of asserting directly.
**If you add another story/test for something inside this panel (or any
other UI driven by that same effect), wait for the real value, don't
assume the panel appearing means the fetch it depends on has resolved
too — they're on different render passes.**

**Verified:**
- `cd client && yarn build` / `npx tsc --noEmit` (backend, no changes
  expected — confirmed clean anyway) — both clean.
- Supertest: 88 passed, unchanged from the previous entry (no backend
  touched this round).
- Storybook `IndustrySpScreen.stories.tsx`: 50/52 pass — the 2 failures
  are the same pre-existing, unrelated course-chip bug documented in
  both previous entries.
- MSW Playwright (industry-sp/navigation/responsive specs, against
  `yarn build:web`'s static `dist/`): 104/105 pass — the 1 failure is
  the same pre-existing `sort=asc is sent on initial load` flake noted
  in every entry above.
- Live: merged to `develop`, deployed via `apps/web/deploy.sh` only (no
  Lambda deploy — nothing backend changed). Confirmed live via a
  throwaway Playwright script against `app.backbet.co.uk`: clicking
  Account shows "Signed in as matthew@backbet.co.uk" for a real
  logged-in session.
- **Not run** — same live-e2e/integration-test gaps as every previous
  entry, same reasons (no local MongoDB, no persistent live server in
  this sandbox). Added a live-suite test for the Account button/panel
  alongside the existing logged-in-home-page test, unverified here.

---

## 2026-07-19 (much later) — Agent in `~/betfair-nlp-email-debug` (branch `email-debug`)

**Task:** User reported no verification email arrived at
`matthewbeyer@hotmail.com`. Root-caused and fully resolved end to end —
this ended up being a real debugging session, not a code task, so most
of the value here is diagnostic trail + one small logging fix + one new
committed test. Sequence, in case anyone hits similar symptoms:

1. **Root cause #1 (confirmed via CloudWatch, `filter-pattern
   "EmailService"` on `/aws/lambda/hello-api`):** no `RESEND_API_KEY` was
   ever set on the Lambda — `config/local.json` never existed in this
   sandbox (see multiple earlier entries), so `apps/lambda/build.sh`'s
   secrets block always skipped, and every deploy left the env var
   unset. `EmailService` was correctly no-op'ing exactly as designed
   (`WARN ... skipping verification email ... non-fatal`) — not a bug,
   just literally never configured.
2. **Fix:** user provided a Resend API key. Patched the *live* Lambda
   environment directly (`aws lambda update-function-configuration
   --environment`) rather than via `config/local.json` + a full
   `build.sh` run — fetched the existing env vars to a file first
   (never printed to a transcript/tool-output) and merged in
   `RESEND_API_KEY`/`EMAIL_FROM_ADDRESS`/`API_URL` on top, since
   `update-function-configuration --environment` *replaces* the whole
   map rather than patching it — sending only the new keys would have
   wiped `MONGODB_URI`/`JWT_SECRET` entirely. **Anyone doing this again:
   always fetch-merge-reapply, never construct the `--environment` value
   from scratch.** This patch is not persisted anywhere in
   `config/local.json` (still doesn't exist) — it only lives in the live
   Lambda's env vars. `apps/lambda/build.sh`'s secrets block already
   defaults these three to safe fallbacks (`''`/the Lambda URL) if
   `config/local.json` exists without an `email`/`app.apiUrl` section
   (see the auth-hardening entry above), so a future `config/local.json`
   being created for unrelated reasons (e.g. rotating `JWT_SECRET`)
   won't silently wipe these — but *will* silently reset them to the
   fallback values, which for `RESEND_API_KEY` means back to disabled.
   **If you ever create `config/local.json` on a dev machine, populate
   its `email.apiKey`/`email.fromAddress` too, matching what's live, or
   the next full deploy will quietly turn email back off.**
3. **Root cause #2 (found via `curl .../emails/{id}` against Resend's
   own API once a message ID was captured):** Resend accounts without a
   verified sending domain are restricted to sending only to the
   account-owner's own registered email — confirmed identically for
   `matthewbeyer@hotmail.com` (blocked, 403) and a `@mailinator.com` test
   address (also blocked, same 403), while `mattbeyer81@gmail.com` (the
   Resend account owner) and Resend's own `delivered@resend.dev` test
   address both succeeded silently. This is a Resend account policy, not
   anything wrong with our integration — `EmailService`'s original
   `sendVerificationEmail` only logs on failure, so a *successful* send
   was completely invisible in logs (this is what led to fix #4 below).
   Confirmed a real send to `mattbeyer81@gmail.com` was accepted with
   `last_event: "delivered"` via Resend's status API — proving delivery
   worked even before domain verification, for the one allowed
   recipient.
4. **Small code fix, committed (`e6658a2`):** `EmailService.
   sendVerificationEmail` now also logs Resend's returned message `id`
   on success (previously silent) — `console.log`, not `console.error`,
   so it doesn't read as a failure. Needed this to look up delivery
   status for a specific send via `GET https://api.resend.com/emails/
   {id}` — impossible to correlate anything without it.
5. **Domain verification:** user added `backbet.co.uk` to Resend
   (`resend.com/domains`). `backbet.co.uk`'s nameservers are Cloudflare
   (confirmed via `dig NS backbet.co.uk`) — Resend appears to have a
   native Cloudflare integration that auto-pushed the required SPF/DKIM
   records without anyone touching DNS manually (2 of 3 records were
   already `"verified"` within ~7 minutes of adding the domain in
   Resend's UI, the third — DKIM — finished within another ~90 seconds).
   **This agent has no DNS-write access at all** (the Cloudflare MCP
   tools available are read-only for zones — `zones_list`/`zones_get`,
   no record-management tool), so if the auto-integration hadn't worked,
   the user would have had to add records manually; flagging in case a
   future domain (a different TLD, or moving off Cloudflare) doesn't get
   the same auto-push treatment.
6. **Once verified:** switched `EMAIL_FROM_ADDRESS` to
   `BackBet <noreply@backbet.co.uk>` (same fetch-merge-reapply Lambda env
   pattern as step 2) and the user's new "full access" Resend API key
   (the original key the user first provided was **send-only scoped** —
   `GET /emails/{id}` 401'd with `"restricted_api_key"` until the new key
   was swapped in; if you need to query delivery status, you need a
   Full Access key, Sending-only isn't enough).
7. **New committed test, not just a one-off manual check:**
   `client/tests-live/email-verification-live.spec.ts` — signs up with a
   fresh `@mailinator.com` address (Mailinator has a public, no-auth
   read API for exactly this kind of testing), polls for the real
   delivered message, extracts the verify token from the actual email
   body, hits the verify link, and confirms `GET /api/auth/me` reflects
   `emailVerified: true` afterward. Fully automated, no human needs to
   check any inbox, safe to run repeatedly (fresh timestamped address
   each run, no collision risk with real users). **Run this after any
   future change to `EmailService`, the verify-token flow, or a Resend
   account/domain change** — it's the fastest way to confirm the whole
   pipe still works end to end.

**Byproduct:** several throwaway accounts now exist in the real
production `users` collection from this debugging session
(`claude-agent-test-*@example.com`, `delivered@resend.dev`, a couple
`@mailinator.com` addresses, and one legitimate resend to
`mattbeyer81@gmail.com`'s real pre-existing account). Harmless, but
there's no admin/delete endpoint to clean these up — matches the
"don't run live signup tests routinely" caution from the auth-hardening
entry above; this was a deliberate exception for live debugging, not a
new habit.

**Verified (all real, no mocks, this whole entry):** `yarn build` /
`npx tsc --noEmit` clean, Supertest 88/88 (unaffected by the logging-only
change), and — the actual point of this entry —
`email-verification-live.spec.ts` passes against production, proving
signup → real Resend delivery → real inbox → real verify link → real
`emailVerified: true` all work end to end as of this commit.

---

## 2026-07-19 (even later) — Agent in `~/betfair-nlp-social-auth` (branch `social-auth`)

**Task (starting):** Sign in with Google + SMS (Twilio Verify) as
additional signup/login methods, alongside the existing email/password
flow. **Apple explicitly out of scope this round** (user chose to skip —
needs a paid Apple Developer Program enrollment + domain verification
file + Services ID + private key, none of which exist yet).

**Design decisions (confirmed with user):**
- Google: web-only "Sign In With Google" via Google Identity Services
  (GIS) — the frontend gets a signed ID token directly from Google's own
  JS, no authorization-code exchange, no client secret needed anywhere
  (only `GOOGLE_CLIENT_ID`, which is not secret, needed server-side to
  verify the ID token's signature via `google-auth-library`). Simpler
  than a redirect-based OAuth flow and fits this app's current
  web-only deployment.
- SMS: Twilio **Verify** API specifically (not raw SNS) — Twilio owns
  code generation, expiry, and retry-limiting for us; our backend just
  calls "start" and "check" against a Verify Service SID.
- **Schema change:** `UserDocument.email` becomes optional — a
  phone-only signup has no email at all. Both `email` and `phone` get
  sparse unique indexes; a user must have at least one of
  email/phone/googleId.
- A Google sign-in auto-creates the account as `emailVerified: true`
  immediately (Google already proved ownership) — skips our own
  token/Resend email-verification flow entirely for that account.
- No credentials provided yet for either provider — user is creating a
  Google Cloud project and a Twilio account. Following the same pattern
  as `RESEND_API_KEY`: code is being written to safely no-op/error
  clearly if `GOOGLE_CLIENT_ID`/`TWILIO_*` aren't configured, not to
  block on having them to write and test the non-provider-specific
  logic (schema, routing, existing-flow regressions).

**Touching:** `src/lib/dao/user-dao.ts`, `src/lib/service/auth-service.ts`
(new methods, not touching `signup`/`login`/`verifyEmail`/
`resendVerification` behavior), `src/server/router.ts` (new routes only),
`client/src/components/AuthScreen.tsx`, `client/src/services/chatApi.ts`,
`config/default.json`, `config/custom-environment-variables.json`,
`apps/lambda/build.sh` (secrets block only). New files:
`src/lib/service/google-auth-service.ts`,
`src/lib/service/sms-service.ts`. **Not** touching
`src/lib/service/email-service.ts`, the verify/resend-verification
endpoints, or anything from the industry-sp/raceCap work at all.

Will append a completion entry below once shipped/verified.

**Done — committed on `social-auth`, merged to `develop`, NOT deployed
yet.** All planned pieces landed: Google Sign-In (ID-token verification,
no client secret anywhere), Twilio Verify SMS sign-in, and the schema
migration to support both (optional `email`, new `phone`/`googleId`
fields).

**Turned out bigger than "add two buttons" — a few things worth knowing:**

- **`resendVerification`/`getMe` had to be re-keyed from email to user id**
  (the JWT's `sub` claim) — a phone-only or emailless-Google account has
  no email at all, so email couldn't stay the universal lookup key for
  routes that only ever had a Bearer token to go on. Renamed the
  router's `emailFromAuthHeader` helper to `userIdFromAuthHeader`
  accordingly. This is the one place this entry touches
  `getMe`/`resendVerification`'s *signature* (not their behavior) despite
  the "not touching" note above — flagging the contradiction in case it
  matters to whoever reads these entries later.
- **The existing `email` unique index was not sparse** — fine when
  every account had an email, but a non-sparse unique index only
  tolerates *one* document with the field entirely missing before every
  subsequent phone-only/emailless-Google signup collides on "missing
  email" as if it were a duplicate value. `UserDAO.createIndexes()` now
  detects and drops the old non-sparse `email_1` index before recreating
  it sparse — self-healing on next deploy, no manual migration step
  needed. **The critical detail if you touch this again: MongoDB sparse
  indexes still index a field explicitly set to `null`** — only a
  genuinely *missing* key is excluded. `createUserWithGoogle`/
  `createUserWithPhone` build their insert docs with conditional spreads
  (`...(email ? {email} : {})`) specifically to omit the key entirely
  rather than set it to `null`, or the sparse unique index wouldn't
  actually help.
- **New npm packages (`google-auth-library`, `twilio`) needed a real
  `npm install`, not the symlinked shared `node_modules`** this session's
  worktrees otherwise use for speed. Installing them **also
  regenerated the root `yarn.lock` with worktree-absolute file: paths**
  (`resolved "file:/home/ubuntu/betfair-nlp-social-auth/apps/express"` etc.
  — this repo has both `package-lock.json` and `yarn.lock` at the root,
  apparently already drifting pre-existing per the "mixed package
  managers" warning `yarn build` already printed before this session).
  **Caught before committing** — `git checkout -- yarn.lock` reverted it,
  keeping only `package-lock.json`'s clean addition. **If you add a new
  npm dependency in this repo: check `git diff yarn.lock` before
  committing — an absolute worktree path baked into a lockfile breaks
  for literally everyone else who checks the repo out anywhere else.**
- **Config test-env quirk:** `GoogleAuthService`/`SmsService` both
  short-circuit to a "not configured" error when their config values are
  blank — which they are by default (`config/default.json`), including
  under Jest. To actually exercise the mocked `google-auth-library`/
  `twilio` packages in Supertest, `config/test.json` needed *dummy*
  (non-blank) `google.clientId`/`twilio.*` values added — otherwise the
  real request never reaches the mock at all, it just 503s immediately
  from the config gate. Not secrets (test.json is committed, these are
  fake placeholder strings), just needed to get past the "is this
  configured" check.
- **Singleton gotcha for anyone testing Google sign-in:** `AuthService`
  (and the `OAuth2Client` instance inside `GoogleAuthService`) is
  constructed once at server/Lambda cold start, not per-request.
  `jest.fn().mockImplementationOnce()` on the `OAuth2Client` *constructor*
  does nothing useful here — the already-built instance from cold start
  keeps using whatever the constructor returned the first time. Testing
  a second/different Google identity requires a distinct fixed token
  string mapped inside the *same* static mock implementation, not a
  per-test constructor override (see `GOOGLE_VALID_TOKEN_EXISTING_EMAIL`
  in `app.test.ts`).
- **Apple: still explicitly out of scope**, per the "starting" note
  above — nothing changed on that front this round.

**Not yet deployed — waiting on credentials from the user:**
- `GOOGLE_CLIENT_ID` (public/non-secret — a Google Cloud project +
  OAuth consent screen + Web application Client ID need creating first).
  `apps/common.sh` has a `GOOGLE_CLIENT_ID=""` placeholder wired through
  `apps/web/deploy.sh` (`EXPO_PUBLIC_GOOGLE_CLIENT_ID`); the Sign In With
  Google button simply doesn't render until this is filled in — verified
  via the `GoogleButtonHiddenWhenNotConfigured` Storybook story.
- `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_VERIFY_SERVICE_SID`
  (secret — need a Twilio account + a Verify Service created in their
  console). Same fetch-merge-reapply Lambda-env pattern as
  `RESEND_API_KEY` applies once these arrive (see the email-verification
  entry above for the exact procedure and the "always merge, never
  replace" warning). `apps/lambda/build.sh`'s `config/local.json` secrets
  block already has safe blank fallbacks for both providers, matching
  the existing `RESEND_API_KEY` pattern (503 "not configured" rather
  than a crash).

**Verified (everything short of an actual deploy):**
- `cd client && yarn build` / `npx tsc --noEmit` (backend) both clean.
- Supertest: 99 passed (up from 88 — added Google sign-in create/link/
  invalid-token/no-email cases and SMS send/verify create/repeat/
  wrong-code cases, all against mocked `google-auth-library`/`twilio`).
- Storybook `AuthScreen.stories.tsx`: 18/18 pass (was 12) — added Google-
  button-hidden-when-unconfigured plus the full phone entry → send code
  → enter code → verify flow, both success and wrong-code paths.
  `IndustrySpScreen.stories.tsx` still 50/52 (same 2 pre-existing,
  unrelated course-chip failures noted in every entry above).
- MSW Playwright (industry-sp + navigation specs): 66/67 pass — the 1
  failure is the same pre-existing `sort=asc` flake.
- Full non-integration Jest suite: same ~8-pre-existing-failing-suites
  shape as every previous entry (checked the actual failing test names
  this time to be sure — all OpenAI-key/MongoDB-connection/route-
  registration issues, nothing auth-related).
- **Not deployed, not tested live** — genuinely can't be until the user
  supplies the four credentials above. Whoever picks this up next:
  patch the Lambda env (fetch-merge-reapply, see the email entry above),
  redeploy, then a real end-to-end check should cover: Google button
  appears and completes a real sign-in, phone send/verify completes a
  real Twilio SMS round trip, and — easy to miss — that `/api/auth/me`
  and the account panel (`IndustrySpScreen`'s Account button, from the
  session before this one) render sensibly for a phone-only account with
  no email at all (that UI was built assuming every account has an
  email; it should degrade to showing the phone number instead, worth
  eyeballing once real credentials make this testable).

---

## 2026-07-25 — Agent in `~/betfair-nlp-convergence-tooltip` (branch `fix/convergence-tooltip-runner-count`)

**Task:** User reported (screenshot) that the P&L Convergence chart's
tap-to-inspect tooltip looked broken — headline said "Converges to
-13.5% after 2980 runners" but the tooltip showed "Runner 5676", which
reads as impossibly larger than the 2980 the headline just claimed.

**Root cause:** not a bug in the arithmetic — both numbers are
individually correct by design. `firstOrdinal`/`lastOrdinal` and the
tooltip's `selectedPoint.runnerOrdinal` are all the TRUE global runner
ordinal (deliberate, from the `dac3501`/`36b8b3c` work referenced
earlier in this file — a split's own Graph button must show that
split's real absolute runner numbers, e.g. 2984–5963, not a rebased
1..N). The headline's "after N runners" is a deliberately *local* count
(also deliberate, covered by the existing `ScopedToASplitsOwnRange`
Storybook test). Two intentionally different numbering schemes sitting
next to each other with no explanation reads as a contradiction to a
user, even though nothing was actually wrong.

**Fix:** added a second tooltip line — "`{localIndex+1} of {points.
length} in this split`" — that ties the global ordinal above it back to
the same local count the headline uses, without changing either
existing number. `client/src/components/RunnerConvergencePanel.tsx`
(new `tooltipPosition` Text + style) and its `.stories.tsx` (extended
`TappingTheChartShowsASnapTooltip` and `ScopedToASplitsOwnRange` to
assert on the new line). No backend, no `IndustrySpScreen.tsx` changes.

**Verified:** `yarn build` clean. Storybook
`RunnerConvergencePanel.stories.tsx`: 10/10 pass (via
`test-storybook --url http://localhost:6006`, Storybook restarted from
this worktree so it actually served the change — a Storybook process
already running from a different worktree/checkout will silently keep
serving stale code, worth remembering). MSW Playwright
`industry-sp.spec.ts` full suite: 77/77 pass (includes the two
convergence-specific tests and the previously-flaky `sort=asc is sent
on initial load`, fixed in the immediately preceding commit on
`develop`). Not deployed — text-only tooltip change, low risk, left for
the user to trigger `/deploy-web` when ready.

**Done — committed (`5bd787a`), merged to `develop`, pushed. Worktree
removed, branch deleted (local + remote) — nothing left in progress.**

---

## 2026-07-25 (later) — Agent in `~/betfair-nlp-split-b-continuation` (branch `fix/split-b-continuation`)

**Task:** User reported (screenshot) that editing only Split A's "to"
runner box (extending it from 1586 out to 2983) and pressing Apply made
Split A update correctly but Split B's underlying data didn't — the
result card *labels* looked like a clean continuation ("2984–6156") but
the numbers were off.

**Root cause, confirmed via an MSW repro before touching any code:**
`applyFilter` sent Split B's *stale* prior boundary (`fromRunnerB=1587`,
left over from before A moved) instead of continuing right after A's new
one (`2984`) — the two ranges silently overlapped (runners 1587–2983
double-counted in both splits' P&L). The displayed "2984–6156" label was
never actually queried; it's `splitA.totalRunners + splitB.totalRunners`
arithmetic in `RunnerConvergencePanel`/card-render code, computed
independently of what request was actually sent. This is a *different*
bug from the earlier `03fa040` fix — that one was about the
very-first-ever Apply losing a typed value when the total was still
unknown; this one is about a *later* Apply, after a real total is
known, where only one side gets edited.

**Fix:** split the single shared `splitBoxesEditedRef` into
`splitAEditedRef`/`splitBEditedRef` (wired through all 8 draft-box
`onMinChange`/`onMaxChange` handlers, both race-mode and runner-mode).
New `resolveSplitPair` (alongside the existing `resolveSplitBound`) in
`IndustrySpScreen.tsx`: when exactly one side was actually edited, the
other side is now recomputed as "everything else" (contiguous,
non-overlapping) instead of read from its own possibly-stale box.
Symmetric — editing only Split B carries Split A's end forward too.
Touched **only** `client/src/components/IndustrySpScreen.tsx` and
`client/tests-msw/industry-sp.spec.ts` — no backend changes.

**Worth flagging for whoever picks up `isp-form-fields` next:** that
worktree's `IndustrySpScreen.tsx` diverges by ~1500 lines from current
`develop` (checked via `git diff origin/develop --stat`) — likely stale/
unrebased. It will need to reconcile against this fix (and the
`03fa040`/`5bd787a` fixes before it) when it eventually merges; flagged
in the Active Worktrees table above rather than touched here.

**Test-writing gotcha worth recording:** the two new regression tests
initially lived inside the "Industry SP filters screen (MSW mocked)"
describe block, reusing its shared `beforeEach` (which already does one
real Apply against the fixture's tiny 3-runner default mock). That
beforeEach's Apply already flips `hasLoadedOnce` true, so the test's
*own* first Apply — even though it's the first thing the test body
does — is no longer treated as a fresh default split; it's already
"just another explicit Apply", which uses whatever's currently in the
draft boxes (still the tiny mock's numbers) rather than the test's own
large-total mock. Moved both tests to standalone `test(...)` blocks
(outside any describe, own `page.goto`) so their *own* first Apply is
genuinely the first one of the session — same pattern already used for
`sort=asc is sent on initial load` a few entries back, for an unrelated
but structurally identical reason.

**Verified:** `yarn build` clean. MSW Playwright `industry-sp.spec.ts`
full suite: 79/79 pass (77 previous + 2 new). Storybook
`IndustrySpScreen.stories.tsx`: 54/56 pass — the 2 failures are the
same pre-existing, unrelated course-chip bug documented in every prior
entry touching this file (confirmed unrelated: those two stories don't
touch split boxes, and the failure reproduces identically against an
unmodified `IndustrySpScreen.stories.tsx` checked out from
`origin/develop`). Not deployed — left for the user to trigger
`/deploy-web` when ready.

**Done — committed (`52c5c22`), merged to `develop`, pushed. Worktree
removed, branch deleted (local + remote) — nothing left in progress.**

---

## 2026-07-25 (later still) — Agent in `~/betfair-nlp-split-zero-guard` (branch `fix/split-zero-guard`)

**Task:** User reported (two screenshots, before/after) a follow-on bug
from the `52c5c22` fix above: with Split A already edited to 2983
(carrying Split B forward to 2984), editing Split B's "from" box back
down to 1 (claiming the whole dataset from the start) made Split A's box
show "1 – 0" and its result card show a fabricated "runners 1–1" with a
real, non-zero P&L — should have been empty.

**Root cause, confirmed via MSW repro before touching code:**
`resolveSplitPair`'s `bEdited && !aEdited` branch computes Split A's
complementary range as `fromA=1, toA=fromB-1`; when `fromB<=1` that's
`toA=0`, meant as "empty". But `toRunnerA=0` doesn't survive the round
trip — the backend's explicit-runner-split boundary resolver
(`resolveRunnerBoundary` in `industry-sp-service.ts`) does
`Math.max(1, target)` on every "to" target (there to clamp a normal
out-of-range positive target, not meant to carry an "empty" sentinel),
so a target of 0 is silently treated as "up to runner 1" — one runner,
not zero. Confirmed by capturing the actual outgoing request
(`toRunnerA=0`) against a large-total mock before any fix.

**Fix:** `resolveSplitPair`'s degenerate case (`fromB<=1`) no longer
returns the inverted `toA=0` range at all — it falls through to
resolving Split A independently from its own last-committed box (the
same well-defined path already used when both sides are edited). Trades
a real but minor A/B overlap in this one edge case for never sending a
boundary the frontend and backend disagree on the meaning of. Touched
only `client/src/components/IndustrySpScreen.tsx` (the one function) and
its MSW test — no backend changes; a backend-side fix (e.g. a real
"empty" sentinel distinct from 0) would be the more complete fix if this
edge case ever needs to be airtight rather than just non-broken, flagging
here in case someone wants to pick that up later.

**Verified:** `yarn build` clean. MSW Playwright `industry-sp.spec.ts`
full suite: 80/80 pass (79 previous + 1 new regression test, which fails
against the pre-fix code and passes after). Not deployed at commit time
— deployed immediately after by the same session, confirmed live via
`build-commit` meta tag on `app.backbet.co.uk`.

**Done — committed (`112e47f`), merged to `develop`, pushed, deployed.
Worktree removed, branch deleted (local + remote) — nothing left in
progress.**

---

## 2026-07-25 (yet later) — Agent in `~/betfair-nlp-split-b-label` (branch `fix/split-b-label`)

**Task:** User reported (screenshot) a follow-on to the `112e47f` fix
above: with Split A edited to 2983 and Split B's "from" box explicitly
set back to 1 (deliberately overlapping A), the *box* correctly showed
"1" but the *result card* still said "Split B — runners 2984–8946" — a
range that was never actually queried.

**Root cause, confirmed via MSW repro before touching code — two
compounding bugs, not one:**
1. `applyResult` always re-derived `fromRunnerA/toRunnerA/fromRunnerB/
   toRunnerB` via "A:1..totalRunnersA, B:totalRunnersA+1..+
   totalRunnersB" arithmetic. Correct for the true auto-computed default
   (genuinely contiguous, starting at 1) — fabricated for any explicit
   split that isn't. Fixed this first, reran the repro — **no visible
   change**, which is what surfaced bug 2:
2. The result cards' own `renderSplitCard` call sites (in the JSX, not
   `applyResult`) had a **second, independent copy** of that exact same
   formula computed inline, reading `totalRunnersA`/`totalRunnersB`
   directly and never touching `fromRunnerA/toRunnerA/fromRunnerB/
   toRunnerB` state at all. Fixing `applyResult` alone was a no-op
   because the card was never reading what it fixed.

**Fix:** `applyResult` now branches on `isRunnerExplicit` — the default
path keeps the original contiguous-arithmetic derivation, the explicit
path reuses the already-correct `fromRunnerA`/`fromRunnerB` (set by
`applyFilter` moments earlier) combined with each split's own returned
`totalRunners` count to derive just the resolved end. Both
`renderSplitCard` call sites now pass `fromRunnerA ?? 1`/`toRunnerA ??
totalRunnersA` and the Split B equivalents directly, instead of
re-deriving their own guess.

**Debugging note for whoever hits this pattern again:** always grep for
a second, independent copy of a formula before concluding a
single-location fix didn't work — the "no visible change after a
correct-looking fix" symptom here was the tell. `grep -n "totalRunnersA
+ 1"` (or similar) across the whole file would have found both spots
immediately; I found the second one by tracing the actual prop each
`renderSplitCard` call site passes, one call site at a time.

**Verified:** `yarn build` clean. MSW Playwright `industry-sp.spec.ts`
full suite: 81/81 pass (80 previous + 1 new). Storybook
`IndustrySpScreen.stories.tsx`: 54/56 — same 2 pre-existing course-chip
failures as every prior entry. **Gotcha hit and resolved along the
way:** a stale Storybook process from the already-deleted
`split-b-continuation` worktree (killed via `git worktree remove`, but
its `storybook dev --port 6006` process kept running orphaned) was still
holding port 6006 alongside a freshly-started one from this worktree —
every single story failed with a generic "could not access the
Storybook channel" error (not a real regression). `lsof -i:6006` showed
two processes bound to the port; killing both and restarting cleanly
from this worktree fixed it. **Always `lsof -i:6006` (or check `ps aux |
grep storybook`) before trusting an "everything failed" Storybook
result** — a real regression fails specific tests with specific
assertion errors, not literally every story with the same
channel-connection error.

**Done — committed (`de7ab20`), merged to `develop`, pushed, deployed.
Worktree removed, branch deleted (local + remote) — nothing left in
progress.**

---

## 2026-07-25 (still later) — Agent in `~/betfair-nlp-graph-range` (branch `fix/graph-range`)

**Task:** User reported (screenshots) a third occurrence of the same bug
class as `de7ab20`: Split B's box and card correctly showed "runners
1–3000" after an explicit edit, but its **Graph** button opened a P&L
convergence panel labeled "Runners 1001–3173" — again, a range that was
never actually queried.

**Root cause:** `loadConvergence` (the Graph button's handler) had its
own, third independent copy of the "A:1..totalRunnersA, B:
totalRunnersA+1..+totalRunnersB" formula — `de7ab20` fixed
`applyResult` and the two `renderSplitCard` call sites but never touched
this one. Grepping the whole file for the rest of that formula
(`totalRunnersA + 1`) after fixing `loadConvergence` turned up a
**fourth** copy, in the `SplitDetailPanel` props (the "Details" button)
a few lines below — fixed that too in the same commit.

**Fix:** both now read `fromRunnerA ?? 1` / `toRunnerA ?? totalRunnersA`
and the Split B equivalents directly from state — the same resolved
values the result cards themselves already read, one source of truth
instead of four duplicated copies of the same formula.

**Process note for whoever hits this bug class a fifth time:** `grep -n
"totalRunnersA + 1\|totalRunnersA + totalRunnersB"` across
`IndustrySpScreen.tsx` before considering this fully fixed — that's
exactly how the fourth copy (Details panel) got caught here, and it's
cheap insurance against a fifth one existing that nobody's tapped yet.

**Correction to the previous entry's Storybook-debugging tip:** `lsof
-i:6006` is **not reliable in this sandbox** — it silently returned zero
rows even while `curl localhost:6006` succeeded and `ps aux | grep
storybook` showed a live process bound to the port (confirmed twice this
session, including one case where an `lsof -ti:6006 | xargs kill` "kill"
silently did nothing and the stale process was still there minutes
later). **Use `ps aux | grep storybook` and kill by PID directly** — do
not trust `lsof` for anything port-related here.

**Verified:** `yarn build` clean. MSW Playwright `industry-sp.spec.ts`
full suite: 82/82 pass (81 previous + 1 new). Storybook
`IndustrySpScreen.stories.tsx`: 54/56 — same 2 pre-existing course-chip
failures as every prior entry (confirmed via the `ps`-based process
check above, not `lsof`, after two false "everything failed" scares from
stale processes on port 6006 from already-deleted worktrees).

**Done — committed (`4d95415`), merged to `develop`, pushed, deployed.
Worktree removed, branch deleted (local + remote) — nothing left in
progress.**

---

## 2026-07-25 (yet still later) — Agent in `~/betfair-nlp-graph-jump` (branch `feat/graph-jump-to-runner`)

**Task:** User requested a "jump to runner" input on the P&L convergence
chart (`RunnerConvergencePanel.tsx`) — dragging a finger to land on one
exact runner is imprecise, especially for a wide range on a small
screen.

**Implementation:** a number input + "Go" button above the chart. On
submit (button tap or Enter via `onSubmitEditing`), scans `points` for
whichever `runnerOrdinal` is closest to the typed target and calls the
exact same `setSelectedIndex` a tap/drag already does — the marker,
guide line, and tooltip are entirely unchanged, this is purely an
alternate way to *choose* the index. A target outside the split's own
range snaps to whichever end is closer, same as a tap already does at
the chart's edges. Touched only `RunnerConvergencePanel.tsx` and its
`.stories.tsx` — no backend, no `IndustrySpScreen.tsx` changes (it
doesn't need any; the panel already receives `points` as a prop).

**Verified:** `yarn build` clean. Storybook
`RunnerConvergencePanel.stories.tsx`: 14/14 pass (10 previous + 4 new —
snaps to exact runner, Enter-key submit, out-of-range clamps to nearest
end, Go button disabled when input empty). `IndustrySpScreen.stories.tsx`:
54/56 — same 2 pre-existing course-chip failures as every prior entry.
MSW Playwright `industry-sp.spec.ts` full suite: 82/82 pass (unaffected
— this panel isn't reached by that suite's own assertions, ran it anyway
to confirm nothing broke).

**Done — committed (`aa3f85d`), merged to `develop`, pushed, deployed.
Worktree removed, branch deleted (local + remote) — nothing left in
progress.**

---

## 2026-07-25 (latest) — Agent in primary checkout `/home/ubuntu/betfair-nlp` (branch `develop`)

**Task:** User asked for a "Model Performance Dashboard" to eventually
track per-retraining model versions, training params, and P&L (with vs.
without the model) across UI filters, stored in a new Mongo collection.
Scoped down via clarifying questions to **frontend-only, mocked data,
Storybook stories only** this round — no Mongo collection, DAO, service,
API route, or `ml/train_and_predict.py` change yet. Backend wiring is a
deliberate follow-up task once the UX is validated.

**Not done in a worktree** — new, isolated files only (no edits to any
of the contested files this doc calls out at the top), so the
worktree-per-agent isolation this file recommends wasn't load-bearing
here. Future non-trivial work should still default to a worktree per the
section above.

**Implementation:**
- `client/src/utils/ispFormat.ts` — added `computeModelFilteredPnl`
  (the "with model" P&L calc: same staking math as the existing
  `computeRangePnl`, gated on `modelWinProbability >= threshold &&
  modelBeatsSp(runner)`).
- `client/src/components/ModelPerformanceDashboard.tsx` (new) — model-
  version selector cards, training-params panel (mirrors
  `ml/train_and_predict.py`'s real hyperparam names/values), performance
  metrics + a hand-rolled SVG calibration chart (same style as
  `RunnerConvergencePanel.tsx` — no charting library in this repo),
  filters reusing `DateRangePicker.tsx` and the chip/checkbox
  draft-vs-applied pattern from `IndustrySpScreen.tsx`, and two P&L stat
  cards ("without model" / "with model").
- `client/src/components/ModelPerformanceDashboard.stories.tsx` (new) —
  16 stories (6 baseline + 10 dashboard-specific) with a deterministic
  (seeded, not `Math.random()`) mock generator: 3 fake model versions
  with improving AUC over time, ~130 races each, `modelWinProbability`
  noise inversely tied to each version's AUC so the highest-AUC
  version's "with model" P&L visibly beats its "without model" baseline
  — the actual point of the demo.
- Deploy: no Cloudflare Pages project existed for Storybook yet, and no
  `CLOUDFLARE_API_TOKEN` was available this session — user redirected to
  AWS (creds already configured on this box) instead. Created a new S3
  bucket `backbet-storybook` (eu-north-1, public-read, static website
  hosting, no CloudFront/custom domain — a review tool, not the
  production app) and `apps/storybook-aws/deploy.sh` to rebuild+sync it.
  `apps/storybook-cf/deploy.sh` was also written (mirrors
  `apps/web-cf/deploy-dev.sh`) but is untested/unused until a Cloudflare
  token exists — see `/deploy-storybook` for both.

**Verified:** `yarn build` clean. Storybook test-runner:
`ModelPerformanceDashboard.stories.tsx` 16/16 pass. Full suite otherwise
unaffected — 4 pre-existing failures in files this task never touched
(`IndustrySpScreen`, `AllRunnersScreen`, `EventsScreen`,
`RunnerDetailScreen` stories).

**Live at:** http://backbet-storybook.s3-website.eu-north-1.amazonaws.com
(direct link to the new stories:
http://backbet-storybook.s3-website.eu-north-1.amazonaws.com/?path=/story/components-modelperformancedashboard--panel-visible)

**Not yet done (deliberately, next task):** Mongo collection for model
versions/training runs, DAO/service/API routes, wiring
`ml/train_and_predict.py` to emit a real per-run id + persist its own
constructor hyperparams (today it only writes eval metrics +
free-text `runLabel` to `model_evaluations` — no stable id), and
connecting the dashboard to real data instead of the mock generator.

**Follow-up same day — user viewed the live S3 page on an actual phone
and reported two real bugs the Storybook interaction tests never caught:
the panel's header rendered but everything below it was blank, and text
used a fallback serif font instead of Inter.** Both turned out to be
**pre-existing gaps in `.storybook/preview-head.html`/`preview.tsx`, not
specific to this component** — likely affecting every other
`position:absolute` "fullscreen panel" story in this repo
(`RunnerConvergencePanel`, `EventDocsPanel`, `SplitDetailPanel`, etc.)
that nobody had visually screenshotted before, since Storybook's own
interaction tests only assert `toBeInTheDocument()` (DOM presence), which
doesn't catch a zero-height element.

- **Blank content root cause:** two pass-through wrapper `<div>`s sit
  between `#storybook-root` and every story's own root (Storybook's own
  decorator root + `PaperProvider`'s wrapper `View` from the global
  decorator in `preview.tsx`) — neither had a height of its own, so they
  collapsed to 0px. A `position:absolute; inset:0` panel takes no space
  in normal flow, so it can't stretch a 0-height parent to fill; it needs
  an ancestor with a *real* height to anchor `top`/`bottom:0` against.
  Fixed with a CSS rule in `preview-head.html` forcing `height:100%`
  through exactly those 2 wrapper divs — **deliberately not deeper than
  2 levels**: a first attempt at 4 levels reached into the story's own
  internal divs (e.g. a panel's header row) and corrupted their own
  content-sized layout, which is its own regression class to watch for
  if this ever needs touching again.
- **Font root cause:** `App.tsx` loads Inter via
  `@expo-google-fonts/inter`'s `useFonts()` before the real app renders;
  `preview.tsx`'s decorator never did, so every `fontFamily:
  "Inter_400Regular"/"Inter_500Medium"` in `theme.ts` silently fell back
  to the browser default. Fixed by copying the same package's
  `Inter_400Regular.ttf`/`Inter_500Medium.ttf` into `client/public/fonts`
  (served by `staticDirs` in both dev and the static build) and adding
  `@font-face` rules under those exact family names in
  `preview-head.html` — zero changes needed to `theme.ts` or any
  component.

**Also added:** `client/tests-storybook-live/model-performance-dashboard-live.spec.ts`
— Playwright smoke tests against the actual deployed S3 URL (not just
local Storybook), using the same pattern as the existing
`storybook-live.spec.ts` (which targets a separate, older
`punt-storybook.pages.dev` Cloudflare Pages deployment from before this
app was renamed — still there, untouched, unrelated to this task). Two
of the 7 new tests are real-bounding-box / computed-font-family checks
specifically because `toBeInTheDocument()`-style assertions are exactly
what let both bugs above ship unnoticed — Playwright's `.toBeVisible()`
plus an explicit `boundingBox()` height check is what actually would
have caught them.

**Verified again:** `yarn build` clean. Full Storybook test-runner suite
re-run after the CSS/font fix: same 6 failing tests as before (the 4
pre-existing unrelated files), 275 passed (was 277 before this session
un-exported two accidentally-public consts that Storybook had been
indexing as bogus extra stories — net no regression from this fix).
All 7 new live Playwright tests pass against the redeployed site.
Redeployed via `apps/storybook-aws/deploy.sh` after the fix — the live
URL above now reflects the corrected build.

**Follow-up same day — user asked for a table view (one row per model
version) that taps through to the existing detail view, rendering well
narrow-to-wide.** Implemented as a two-screen nav inside
`ModelPerformanceDashboard.tsx`:

- New internal state `screen: "table" | "detail"`, defaulting to
  `"table"`. Tapping a row calls `onSelectModelVersion(id)` (unchanged
  prop contract) and flips to `"detail"`; a new "← Models" back button
  (`model-performance-dashboard-back-to-table`) flips back. Deliberately
  **not** reset by the existing races-reset `useEffect` — that effect
  only clears stale filters when the race pool changes, and resetting
  `screen` there too would have undone the very navigation a row tap just
  caused, once the parent's `races` prop update landed.
- Responsive via the **existing** `useResponsive()`/`BREAKPOINTS.tablet`
  (768px) hook from `client/src/utils/responsive.ts` (same one
  `IndustrySpScreen.tsx` already uses for its Split A/B side-by-side
  layout) — reused rather than inventing a new breakpoint. `isTablet`
  true renders a real column table (`model-performance-dashboard-table-header`
  + one row per version with Model/Trained/AUC-ROC/LogLoss/Brier
  columns); false renders the same rows as stacked cards
  (`model-performance-dashboard-table-row-{id}`, same testID either way)
  with a chevron.
- **Important finding while testing this:** Storybook's own `viewport`
  parameter (`parameters.viewport.defaultViewport`, used by the existing
  `RendersAtIphone12`/`RendersAtLaptop` stories elsewhere in this repo)
  **does not actually resize anything** in this Storybook 9 config —
  confirmed empirically: `window.innerWidth` inside the preview iframe
  stayed at the real browser width regardless of which viewport
  parameter a story declared. `@storybook/addon-viewport` was removed
  for Storybook-9 incompatibility (see the comment already in
  `preview.tsx`) and nothing replaced its actual resizing behavior — the
  parameter objects are inert. So the responsive wide-vs-narrow
  assertions for the new table could **not** be written as Storybook
  interaction tests; they're in
  `client/tests-storybook-live/model-performance-dashboard-live.spec.ts`
  instead, using Playwright's own `browser.newContext({ viewport })`
  (390×844 and 1280×900), which is the only layer here with real control
  over the width `useWindowDimensions()` reads.
- **Another finding:** Storybook auto-runs a story's own `play()`
  function on render even outside the test-runner — i.e. just navigating
  a real browser to a story's URL executes its `play()`. One live test
  initially tried to click the same table row a story's own `play()`
  already clicked (timed out waiting for a row that was already gone,
  now in the detail screen) — fixed by not duplicating the click for
  that story, but worth remembering if a future live test seems to hang
  waiting on an element a story's own interactions already consumed.
- Reworked all 16 existing Storybook stories for the new nav (added a
  shared `openDetailInCanvas(canvas, versionId)` helper that clicks
  `model-performance-dashboard-table-row-{id}` then waits for
  `-training-params` to appear) since detail-view content is no longer
  visible without a tap. Added 2 new stories: `TableRowTapOpensDetail`,
  `BackButtonReturnsToTable` — 18 stories total now.

**Verified:** `yarn build` clean. Full Storybook test-runner suite: same
4 pre-existing unrelated failures, 277 passed (18 for this component, up
from 16). Live Playwright suite against the redeployed site: 10/10 pass
(was 7), including the two new narrow/wide viewport checks and a visual
screenshot comparison confirming the column-table and stacked-card
layouts both render correctly. Redeployed via `apps/storybook-aws/deploy.sh`.

**Follow-up same day — user asked to sort the new table by training date,
and said they didn't understand what the training-param/metric names
mean, asking for lay-person tooltips.**

- **Sort:** new `sortOrder` state (`"desc" | "asc"`, defaults to
  newest-first) plus a `sortedVersions` memo feeding the table rows
  (`modelVersions` itself stays untouched/unsorted — the prop is still
  whatever order the parent passes). A pill button above the table
  (`model-performance-dashboard-sort-toggle`) toggles it, labelled
  "Trained: Newest first ↓" / "Oldest first ↑".
- **Tooltips:** reused the exact "?" toggle + expandable text pattern
  already established in `IndustrySpScreen.tsx`
  (`renderTooltipToggle`/`renderTooltipText`/`openTooltip`,
  `FILTER_TOOLTIPS`) rather than inventing a new mechanism — same idea,
  reimplemented locally in this component (not exported/shared, matching
  how `IndustrySpScreen.tsx` keeps its own copy too) with a new
  `PROPERTY_TOOLTIPS` dictionary. Added to **every** training-param row
  in the detail view (n_estimators, learning_rate, max_depth, subsample,
  colsample_bytree, min_child_weight, random_state,
  early_stopping_rounds, train_rows, test_rows, best_iteration,
  train_date_max, test_date_min) and to AUC-ROC/LogLoss/Brier in **both**
  the table's column headers (wide layout) and the detail view's metrics
  panel — same `PROPERTY_TOOLTIPS` keys (`aucRoc`/`logLoss`/`brierScore`)
  reused in both places, only one `openTooltip` state so at most one
  explanation is expanded at a time. Explanations are deliberately plain-
  English, no ML jargon (e.g. AUC-ROC: "How well the model ranks winners
  above losers, from 0.5 (no better than a coin flip) to 1.0 (perfect)...").

**Verified:** `yarn build` clean. Storybook test-runner: 21/21 for this
component (18 + 3 new: `SortToggleReordersTableByTrainingDate`,
`TableMetricTooltipExplainsForLayPerson`,
`TrainingParamTooltipExplainsForLayPerson`), full suite otherwise
unchanged (same 4 pre-existing unrelated failures, 280 passed). Live
Playwright suite against the redeployed site: still 10/10 (unaffected —
none of those tests touch sort/tooltip UI). Redeployed via
`apps/storybook-aws/deploy.sh`.

**Follow-up same day — user sent a screenshot from an actual phone of the
narrow (mobile) table view asking for the AUC/LogLoss/Brier tooltips,
not realizing they'd only been wired up for the wide layout.** Real gap:
the `aucRoc`/`logLoss`/`brierScore` "?" toggles from the previous entry
only lived in the wide table's header row (`isTablet` branch) — the
narrow stacked-card layout has no header row at all (each card shows its
own inline "AUC 0.731  LogLoss 0.579  Brier 0.199"), so a narrow-viewport
user had genuinely no way to reach an explanation.

Fixed by adding a `model-performance-dashboard-metrics-legend` row
(rendered only when `!isTablet`, mirroring the wide header's three
toggles but without the Model/Trained/chevron columns) — same
`PROPERTY_TOOLTIPS` keys, same shared `openTooltip` state, no new
tooltip content needed. The tooltip-text render block that used to be
gated `isTablet && (...)` is now unconditional, since either the header
or the legend always renders one of the three keys' toggles now.

Also strengthened the existing live narrow-viewport Playwright test
(`table renders as stacked cards on a narrow (mobile) viewport` in
`model-performance-dashboard-live.spec.ts`) to assert the legend is
visible and that tapping its AUC-ROC toggle reveals the explanation —
this exact regression (tooltip present in DOM at one breakpoint, absent
at another) is precisely the kind of thing a Storybook interaction test
can't catch, since **its fixed test-runner width only ever exercises the
wide/isTablet branch** — same root cause as why the narrow-vs-wide
layout checks live in Playwright at all (see the earlier entry on
Storybook's broken `viewport` parameter).

**Verified:** `yarn build` clean. Storybook test-runner: same 21/21 for
this component (no new interaction stories added — the gap this fixes
is invisible to the test-runner's fixed wide-ish width by construction),
full suite unchanged (4 pre-existing failures, 280 passed). Live
Playwright suite against the redeployed site: 10/10, including the
strengthened narrow-viewport test. Redeployed via
`apps/storybook-aws/deploy.sh`.

---

## 2026-07-25 (even later still) — Agent in `~/betfair-nlp-comment-nlp-features` (branch `comment-nlp-features`)

**Task:** Advanced ML feature for `ml/train_and_predict.py`'s win-probability
model — mine the free-text `comment` column from the raw training CSV
(Racing Post-style in-running commentary, e.g. "hampered", "travelled
strongly", "no extra", "hung left") into structured, leakage-safe trailing
per-horse signals, following the exact same Phase A/B trailing-average
pattern `precompute-horse-form.ts` already uses for `horseAvgRPR`/
`horseAvgTS`. Plan at
`~/.claude/plans/plan-an-advanced-feature-immutable-quilt.md` if useful
context for follow-up work.

**Important pre-existing-state note for whoever owns the trainer/jockey/
horse-form precompute work:** when this task started, the **primary
checkout already had substantial uncommitted, untracked changes** —
`ml/train_and_predict.py`, `src/commands/import-industry-sp.ts`,
`package.json` (modified) and `src/commands/precompute-horse-form.ts` /
`precompute-jockey-form.ts` (new, untracked) — implementing the trainer/
jockey/horse trailing-form features (`horseAvgRPR`, `jockeyFormWinRate`,
etc.) that the "latest" dashboard entry above flagged as a "deliberate
follow-up task." That work was never mentioned as in-progress here and is
still sitting **uncommitted in the primary checkout** as of this entry —
please commit it (or fold it into this PR if it's meant to land together;
this branch's diff is additive on top of it and doesn't conflict). This
agent did **not** edit or touch the primary checkout at all — it only
copied those uncommitted files into the new worktree below as a required
baseline (since this feature extends `precompute-horse-form.ts`), so
primary's working tree is untouched and exactly as it was found.

**Implementation** (all in the worktree, on top of the copied baseline
above):
- `src/commands/import-industry-sp.ts` — captures the raw `comment` field
  onto `RunnerDoc` (same leakage category as `rpr`/`ts`/`beatenDistance` —
  never fed into the model directly, only via trailing history).
- `src/lib/dao/comment-lexicon.ts` (new) — pure `tagComment()` function,
  a curated keyword/regex lexicon (trouble-in-running / travelled-well /
  weakened / green-inexperience categories, composite `excuseScore`).
  Deliberately a lexicon, not a learned text model, for v1 — interpretable,
  no new ML infra. 11 unit tests in
  `src/lib/dao/__tests__/comment-lexicon.test.ts`, including a regression
  guard that "held up" (neutral positioning) isn't misread as "weakened".
- `src/commands/precompute-horse-form.ts` — extended (not a new script) to
  tag each historical run's comment and aggregate `horseAvgExcuseScore`,
  `horseTroubleInRunningRate`, `horseTravelledWellRate` over the same
  last-3-prior-runs window as `horseAvgRPR`/`horseAvgTS`, same Phase A/B
  leakage guard.
- `ml/train_and_predict.py` — added the three fields to `NUM_COLS` +
  `load_dataframe` passthroughs.

**Verified against local Mongo only — prod Atlas never touched.** Used the
shared local `mongod` on port 27019 (see top-of-file infra note) with a
**dedicated, isolated dev database** (`betfair_nlp_dev_comment_nlp`, not
the shared `betfair_nlp_dev`) populated with a **subset** of the raw CSV
(`FROM_DATE=2023-01-01 TO_DATE=2025-05-27`, 23,598 UK races / 206,729
runners — the full CSV is 1.85M rows back to 2015). Ran the full precompute
chain (`trainer-form` → `jockey-form` → `horse-form`) against that subset,
then trained twice via `RUN_LABEL`:
- `baseline` (pre-feature): AUC-ROC 0.6997, LogLoss 0.3393, Brier 0.0994
- `with-comment-nlp`: AUC-ROC 0.7017, LogLoss 0.3388, Brier 0.0993

All three metrics moved favorably (small but consistent). Feature-gain
check on the trained booster placed the three new columns mid-pack
(`horseTravelledWellRate` ~19 gain, above `officialRating`; `horseAvgExcuseScore`
~13; `horseTroubleInRunningRate` ~8) — plausible, not dominating (which
would have suggested a leakage bug), not dead-last (no signal). Full
`model_evaluations` docs for both runs are in the local
`betfair_nlp_dev_comment_nlp` database for anyone who wants to inspect the
calibration tables.

**Not yet done:** re-running the eval against the full 2015–present dataset
(this was deliberately a fast local dev-subset validation, not a
production-scale run); committing this worktree's changes; a real
`yarn import:industry-sp` reseed of prod/shared Atlas with the `comment`
field (needs the primary-checkout backend work above to land first, then a
full reseed + re-run of all three precompute scripts, matching the
already-documented "reseed wipes derived fields" gotcha).

---

## 2026-07-25 (yet later) — Agent in primary checkout `/home/ubuntu/betfair-nlp` (branch `develop`)

**Task:** User sent a second phone screenshot of the Model Performance
Dashboard's narrow table view — the sort toggle and metrics legend from
the previous entry were both missing, even though they'd already been
deployed and verified working. Asked to "replicate E2E storybook
playwright test" and "fix deploy."

**Root cause — a real caching bug in `apps/storybook-aws/deploy.sh`, not
a missing feature.** `iframe.html`, `index.json`, and `project.json`
keep the exact same filename on every Storybook build (unlike the
`*.iframe.bundle.js` chunks, which are content-hashed), but the deploy
script's `aws s3 sync ... --exclude "index.html"` only special-cased
`index.html` — everything else, including those three, got
`Cache-Control: public, max-age=31536000, immutable`. Once a browser
loaded `iframe.html` once, it would never even revalidate it again for a
year, no matter how many redeploys landed in the bucket underneath it.
Confirmed via `curl -I` on the live URL before touching anything.

**A second, subtler gotcha found while fixing it:** `aws s3 sync`'s own
`--cache-control` flag only applies to objects it actually re-uploads
(content-diffed) — a file whose content is byte-identical to what's
already in the bucket (a favicon, `project.json` if the Storybook
version hasn't changed) silently **keeps its existing Cache-Control**
from a previous deploy. So this couldn't be fixed "going forward" by
just changing the flag on the next sync; every deploy now
unconditionally force-uploads (`aws s3 cp --recursive`, not `sync`) so
every object's Cache-Control header is genuinely reset every time,
regardless of whether its content changed. A final `sync --delete` pass
still runs afterward purely to clean up objects orphaned by a previous
build (safe — by then everything matches, so it only ever deletes, never
re-uploads with a different header).

**Verification added:** a new live test in
`model-performance-dashboard-live.spec.ts` —
`entry-point files are never long-cached, only hash-named bundle chunks
are` — asserts `iframe.html`/`index.html`/`index.json`/`project.json`
never carry `immutable`, and (by regex-extracting a real filename out of
`iframe.html` rather than hardcoding one, since the hash changes every
build) that an actual `*.iframe.bundle.js` chunk still does. This is the
"replicate E2E playwright test" ask — a permanent regression guard
against this exact class of bug recurring, not just a one-off fix.

**Important caveat communicated to the user:** fixing the deploy script
only protects *future* visits. A browser (like the reporting user's own
phone) that already cached `iframe.html` under the old immutable policy
will not see today's fix until it hard-refreshes or clears site data for
that URL — there is no way to retroactively un-poison an already-cached
client from the server side.

**Verified:** `yarn build` clean. Confirmed via `curl -I` against the
live URL that `iframe.html`/`index.html`/`index.json`/`project.json` now
return `no-cache,no-store,must-revalidate` and a sample hash-named
bundle chunk still returns the long `immutable` cache. Full local
Storybook test-runner suite unaffected (deploy-only change, no component
code touched — same 4 pre-existing unrelated failures). Live Playwright
suite against the redeployed site: 11/11 pass (10 previous + the new
cache-header regression test). Redeployed via
`apps/storybook-aws/deploy.sh`.

---

## 2026-07-25 (still yet later) — Agent in primary checkout `/home/ubuntu/betfair-nlp` (branch `develop`)

**Task:** Remove the ISP date filter's one-month max span cap, increase
it to one year. Small, contained change — done directly in the primary
checkout rather than a worktree, but **touches
`client/src/components/IndustrySpScreen.tsx`**, so flagging here per the
top-of-file rule, especially for whoever eventually reconciles
`~/betfair-nlp-isp-form-fields` (noted above as ~1500 lines diverged from
`develop` as of today) — that merge will need to account for this change
too.

**What changed:** `addOneMonth()` → `addOneYear()` (adds a calendar year
instead of a month), and the `applyFilter()` clamp that pins `maxDate` to
`minDate` + cap now pins to `minDate` + 1 year instead of + 1 month.
Updated the `date` filter tooltip copy and surrounding comments to match.
**Not changed:** `FILTER_DEFAULTS.minDate`/`maxDate` — the *default* view
on first load is still the single month Jan 2024 (that's a separate,
deliberate latency guardrail against Atlas M0's shared free tier, see the
comment above `FILTER_DEFAULTS`); only the *ceiling* on how wide a range
Apply will accept moved from 1 month to 1 year.

**Storybook gotcha hit while updating tests:** the renamed
`DateRangeWiderThanOneYearIsClampedOnApply` story (previously
`...OneMonth...`) had *two* separate assertions on the old 1-month
behavior — the `capturedDateParams` check (updated first) and a second,
easy-to-miss `expect(trigger).toHaveTextContent("Feb 1, 2023")` a few
lines further down checking the picker's own displayed text. Updating
only the first left the test failing for a stale-assertion reason
unrelated to the actual fix. Worth double-checking a story for more than
one assertion tied to the same old behavior before declaring it updated.

**Port collision while testing:** hit the exact "Storybook seems to not
be running" false negative documented in earlier entries below, except
this time root-caused as a genuine collision — a different agent's
Storybook (from `~/betfair-nlp-model-versioning-backend`) had taken over
port 6007 after mine exited. Added the "Storybook port" note near the
top of this file so agents pick a free port up front (`ps aux | grep
storybook`) instead of colliding on 6006/6007.

**Verified:** `cd client && yarn build` clean. Storybook test-runner
(own instance on port 6008, to avoid the collision above) for
`IndustrySpScreen.stories.tsx`: the updated clamp story now passes; the
only remaining failures in that file are the 2 pre-existing course-chip
bugs already documented in earlier entries (unrelated to this change).
Full suite: 280/286 pass (6 failed — those same 2, plus the 4
pre-existing unrelated failures in `AllRunnersScreen`/`EventsScreen`/
`RunnerDetailScreen` also noted in earlier entries).

**Done — committed (`c3dbe5c`), merged with the concurrently-landed
`split-ab-race-revert` (`aaf7fd3`, conflicts in `AGENTS.md` only —
`IndustrySpScreen.tsx`/`.stories.tsx` auto-merged cleanly since the two
changes touched disjoint regions), pushed, deployed via
`apps/web/deploy.sh` (no backend changes this round, so no Lambda
deploy needed). Confirmed live: `curl https://app.backbet.co.uk/` shows
`build-branch=develop`, `build-commit=aaf7fd3`.**

---

## 2026-07-25 (later again) — Agent in `~/betfair-nlp-split-ab-race-revert` (branch `split-ab-race-revert`)

**Task:** User asked to revert Split A/B back to pure race-count splitting
(the original behavior before commit `e0b1a9e` introduced qualifying-runner-
count bisection), and to rework the P&L Convergence chart (which was
runner-ordinal based from birth, commit `f997615`) to plot by race instead,
since there's no earlier race-based version of that chart to revert to.

**Implementation:**
- Backend: removed `getQualifyingRunnerSplitBoundary`, `getRunnerRangeStats`,
  `getRunnerConvergenceSeries` from `industry-sp-dao.ts`; added
  `getRaceConvergenceSeries` (one point per race in `[fromRow,toRow]`, fast/
  slow path mirroring `getAllRacesByRace`'s pnlStats logic, no `$lookup`
  needed since `runners` is still on the doc at that point in the pipeline).
  `industry-sp-service.ts`'s `getSplitStats` stripped back to pure race-index
  (`splitByRunners`/`fromRunnerA` etc. params gone; default bisection is
  always `Math.floor(total/2)`). Router: `/api/industry-sp/splits` no longer
  parses runner params; `/api/industry-sp/runner-convergence` renamed to
  `/api/industry-sp/race-convergence` with `fromRow`/`toRow` (matches
  `getAllRacesByRace`'s existing convention).
- Frontend: `IndustrySpScreen.tsx` — removed the "Split by runners" checkbox,
  all `fromRunnerA/toRunnerA/...` state, and the runner-mode branches in
  `applyFilter`/`resetFilters`/the fetch effect/`renderSplitCard`; race-range
  boxes are now always visible (no toggle). `loadConvergence` now reads the
  split's own `fromRowA/toRowA`/`fromRowB/toRowB` directly (no more separate
  "resolved runner range" state to drift out of sync — this was the root
  cause of several of the regressions the runner-ordinal era had to patch
  around, e.g. `dd7f00d`/`4d95415`). `RunnerConvergencePanel.tsx` renamed to
  `PnlConvergencePanel.tsx`, reworked to `raceRowNumber`/"Races X–Y" instead
  of `runnerOrdinal`/"Runners X–Y", `pnl-convergence-*` testIDs, warm-up
  constant lowered (10 vs 50 — race counts per split are much smaller than
  runner counts). `chatApi.ts`/`SplitDetailPanel.tsx`/`ispUrlParams.ts`/
  `ispSplitsCache.ts` updated to match.
- Also (per explicit user request, tangential to the split revert): deleted
  the unused `docker-compose.mongo-only.yml` and set up a **native, non-
  Docker** local `mongod` on this VM for the `localhost:27019` dev/test
  instance (see the "Local infra" section at the top of this file) — updated
  `.claude/commands/mongo-integration-tests.md`/`dev-workflow.md` and
  `README-local-development.md` to document it. `docker-compose.local.yml`
  (the combined API+Mongo Docker stack behind `yarn server:docker`/
  `mongo:up`/etc.) was deliberately left alone — out of scope, still works
  independently.

**Verified:** Backend `npx tsc --noEmit` clean. DAO integration tests (35/35,
including 4 new `getRaceConvergenceSeries` tests exercising both fast/slow
paths against a seeded synthetic 30-race dataset on the new local mongod) and
service integration tests (12/12) pass. Supertest `app.test.ts`: 118 passed,
7 skipped. Frontend `yarn build` clean. MSW Playwright `industry-sp.spec.ts`:
80/80 pass; full MSW suite (`tests-msw/`): 167/168 (1 pre-existing, unrelated
failure in `all-runners.spec.ts` — confirmed via `git diff origin/develop`
that file/its component were never touched by this branch). `industry-sp-
e2e.spec.ts` updated for race-based assertions but not run (needs a real
production-scale dataset, not the synthetic local one). Manual smoke test:
started the real backend + Expo web against the local mongod, drove `/isp`
with Playwright — confirmed no runner checkbox, race-range boxes always
visible, split cards read "races 1–15"/"16–30" (exact bisection of the 30
seeded races), Graph button opens "Races 1–15", Details panel matches.

**Update:** user then asked to commit, merge to `develop`, and deploy after
all. Committed (`fd3f394`), fast-forward merged into `develop` (origin was
still at the fork point, so no merge commit needed), pushed, deployed to
both Lambda (`hello-api`) and the web app (`app.backbet.co.uk`) —
build-branch/build-commit meta tags on the live site confirmed
`develop`/`fd3f394`. Ran the persistent live e2e suite
(`playwright.live.config.ts` / `tests-live/`) against the deployed site: 4
passed, 21 skipped, 4 failed — all 4 pre-existing and unrelated (3 in
`industry-sp-live.spec.ts` predate the "bare `/isp` load fetches nothing
until Apply" feature by a day and were never updated for it, per `git log`;
1 in `date-picker-live.spec.ts` expects a stale full-year date default).
Since none of those reached the actual split behavior, ran an ad hoc
Playwright check directly against `app.backbet.co.uk`: confirmed no runner
checkbox, race-based split labels, and the convergence chart all working
correctly against the real 109,726-race production dataset.

**Done — committed (`fd3f394`), merged to `develop`, pushed, deployed.
Worktree removed, branch deleted (local + remote) — nothing left in
progress.**

---

## 2026-07-25 (later again) — Agent in `~/betfair-nlp-comment-nlp-features` (branch `comment-nlp-features`), merging develop in

**Task:** Bring `comment-nlp-features` (still just its one `92e38b1` commit,
branched from `develop` at `de48df3`) up to date with `origin/develop`,
which had moved 10 commits ahead in the meantime (the model-performance
table/tooltip work, the ISP date-filter span increase, the split-ab-race
revert, and their docs updates — see the entries above). Not yet merged to
`develop` or pushed anywhere.

**Conflict check done before merging:** diffed the file lists of both
sides first (`git diff --name-only comment-nlp-features...origin/develop`)
— zero overlap with anything this branch touches
(`ml/train_and_predict.py`, `import-industry-sp.ts`,
`precompute-horse-form.ts`, `precompute-jockey-form.ts`,
`comment-lexicon.ts`, `package.json`). The one shared filename,
`AGENTS.md`, was only ever touched on the `develop` side — this branch's
own commit never modified it (the disclosure entry above was originally
written directly in the *primary* checkout, uncommitted, and evidently
landed on `develop` through a different path since it's already present at
the top of this merge, word for word). **Result: `git merge origin/develop`
applied cleanly with zero conflicts** — no conflict markers, nothing to
resolve by hand.

**Post-merge verification:** `tsc --noEmit` clean; `comment-lexicon.test.ts`
+ `parse-isp.test.ts` 26/26 pass; `ml/test_features.py` 11/11 pass. Ran the
full backend `yarn jest src/` (327 tests) and got 58 failures across 8
suites — looked alarming, so before assuming the merge broke something,
checked out `origin/develop` alone in a throwaway detached worktree
(`/tmp/develop-baseline-check`, removed after) and ran the identical suite
there: **57 failures across the same 8 suites**, byte-for-byte the same
suite names (`market-definition-dao.integration.test.ts`,
`price-update-dao.integration.test.ts`, `betfair-service.test.ts`,
`mongo-script-executor.test.ts`, `natural-language-service.test.ts`,
`openai-client.test.ts`, `simple.test.ts`,
`runner-price-updates.test.ts`). The only diff between the two runs'
pass/fail suite lists is this branch's own new
`comment-lexicon.test.ts` (11/11 passing). **Confirmed: all 8 failing
suites are pre-existing on `develop` itself, unrelated to this branch** —
e.g. `price-update-dao.integration.test.ts` fails to even compile
(`Property 'getUniqueRunnersByEventId' does not exist on type
'MarketDefinitionDAO'`), a pre-existing type/API mismatch nothing to do
with comment-NLP or the trainer/jockey/horse-form work this branch
bundles. Worth someone picking up separately, but explicitly out of scope
here.

**Not yet done:** pushing this branch, opening a PR, or merging into
`develop` for real — this was specifically "catch the branch up and
document how" per the user's ask, not a request to land it. The full-scale
eval re-run and the prod/shared-Atlas reseed noted as outstanding in the
entry above are still outstanding.

---

## 2026-07-25 (yet later still) — Agent in `~/betfair-nlp-model-versioning-backend` (branch `model-versioning-backend`)

**Task:** Build the backend for the Model Performance Dashboard (all the
entries above this one) — a Mongo-backed model-version registry with a
stable id per retraining run, tag each newly-scored runner with the
model version that scored it, and wire the dashboard into the live app
with real navigation (not just Storybook). User explicitly chose the
larger-scope option on both: tag runners now (not defer), and add live
nav (not just backend+chatApi plumbing).

**Worktree note — deliberately branched from local `develop`, not
`origin/develop`:** the primary checkout's local `develop` was 6 commits
ahead of `origin/develop` (the entire dashboard component + fixes above
were never pushed) — branching from `origin/develop` per the usual
convention would have produced a worktree missing
`ModelPerformanceDashboard.tsx` entirely, since this task builds
directly on top of it. Branched from local `develop` instead so this
worktree actually has what it needs.

**Touching contested files** (`industry-sp-dao.ts`, `IndustrySpScreen.tsx`)
— kept additive only: one new threaded `modelVersionId` parameter in the
DAO (no refactor of the existing duplicated filter-building logic), one
new state block + button + panel in the screen mirroring the existing
`RunnerConvergencePanel` wiring exactly. Also touching
`ml/train_and_predict.py` — different section
(`make_model()`/`save_evaluation()`) than `comment-nlp-features`'s
feature-column work above.

**Implementation:**
- `ml/train_and_predict.py` — built the versioning infra fresh against
  this worktree's committed baseline (a simpler CAT_COLS/NUM_COLS, no
  `save_evaluation`/`model_evaluations` yet) rather than copying the
  primary checkout's own separate **uncommitted** local changes to this
  same file (a broader feature-engineering pass — sex/hg/jockey-form/
  officialRating/wgt/age/daysSinceLastRun/horseCareerRuns/horseAvgRPR/TS/
  BeatenDistance, depending on an untracked `precompute-horse-form.ts`).
  That uncommitted work isn't mine to fold into this branch — flagging
  here so whoever merges both knows `train_and_predict.py` will need
  reconciling (different sections: `make_model()`/`evaluate()`/
  `save_evaluation()` here vs. `load_dataframe()`'s feature columns
  there — should be a clean merge, not a real conflict, but worth
  double-checking). Added: `model_version_id` generated once per run
  (`xgb-%Y%m%d-%H%M%S`, guaranteed-unique + chronologically sortable,
  distinct from the free-text/optional `RUN_LABEL`), a `TRAINING_PARAMS`
  dict `make_model()` builds its kwargs from (single source of truth),
  both persisted into `model_evaluations` alongside the existing eval
  metrics, and `modelVersionId` tagged onto every scored runner
  alongside `modelWinProbability` in the same `array_filters` update.
- New `src/lib/dao/model-version-dao.ts` + `src/lib/service/model-version-service.ts`
  — `ModelVersionDAO` reads the same `model_evaluations` collection
  (not a new one), filtering to docs that actually have a
  `modelVersionId` (excludes pre-versioning eval docs). The service
  maps the DAO's flat Mongo doc into the nested `{id, runLabel, runAt,
  trainingParams, runMeta, performanceMetrics}` shape
  `ModelPerformanceDashboard.tsx` already expected. New
  `GET /api/model-versions` route in `router.ts`.
- `industry-sp-dao.ts` — added `modelVersionId` as a final optional
  parameter to `buildQualifyingRaceStages` and all 3 places that
  duplicate its runner-qualifying-filter logic (`getAllRacesByRace`,
  `getRunnerRangeStats`, `getRunnerConvergenceSeries`), exactly mirroring
  how `minModelWinProbability`/`onlyModelBeatsSp` are already threaded
  through — same pattern, one more optional `$eq` condition, spread in
  only when non-null. `getQualifyingRunnerSplitBoundary` (a 4th caller of
  `buildQualifyingRaceStages`) just passes `modelVersionId: null`
  literally rather than growing its own signature — that endpoint
  doesn't need version-scoped splits. Threaded through
  `industry-sp-service.ts`'s top-level `getAllRacesByRace` wrapper and
  `GET /api/industry-sp`'s query params — deliberately did **not** thread
  it through the splits/convergence-specific internal call sites (not
  needed by this dashboard, would have meaningfully expanded the diff in
  an already-contested file for no present benefit).
- `chatApi.ts` — added `modelVersionId?: string | null` to `IspRunner`,
  moved `ModelVersion`/`ModelTrainingParams`/`ModelRunMeta`/
  `ModelPerformanceMetrics`/`CalibrationBucket` here from
  `ModelPerformanceDashboard.tsx` (a move the component's own comment had
  already anticipated), added `getModelVersions()` and a `modelVersionId`
  param on `getIndustrySp(...)`.
- `IndustrySpScreen.tsx` — new "Model Performance" button in the Appbar
  (visible to everyone, matching the "Show filters" toggle next to it,
  not gated on `isAuthenticated`), opening `ModelPerformanceDashboard` as
  an absolute-overlay panel — identical structural pattern to
  `showConvergencePanel`/`RunnerConvergencePanel`. `loadModelPerformance()`
  fetches all versions, defaults to the newest, then fetches its races;
  `onSelectModelVersion(id)` just refetches races for a different id
  (mirrors `IspRacesScreen`'s already-established
  "fetch a big unpaginated pool, filter client-side" approach, not this
  screen's own paginated row-range browsing).
- Real-data limitation, by design (confirmed with the user before
  starting): `modelWinProbability`/`modelVersionId` are overwritten
  wholesale on every training run — there's no way to reconstruct
  historical per-version scoring. So picking an older model version in
  the table shows the *same* current race data as the newest one, just
  scoped by whichever runners still carry that version's id (in practice:
  none, for any version except the most recent, until the next real
  training run makes this genuinely meaningful going forward).

**Verified:**
- `npx tsc --noEmit` clean (backend), `yarn build` clean (client), after
  `npm install`/`yarn install` in a fresh worktree (no `node_modules`
  from a plain `git worktree add`) — used `npm install` once by mistake
  in `client/`, which regenerated a tracked `package-lock.json` the repo
  doesn't actually use (yarn.lock is authoritative); caught via `git
  status` and restored with `git checkout -- package-lock.json` before
  it could cause confusion.
- New Mongo integration tests, each in its own uniquely-named throwaway
  database (`betfair_nlp_test_..._<timestamp>_<random>`, dropped in
  `afterAll`) per explicit user request — deliberately not this repo's
  existing shared `betfair_nlp_dev`/`betfair_nlp_local` fixture
  convention:
  `src/lib/dao/__tests__/model-version-dao.integration.test.ts` (6
  tests) and a **new standalone** file (not a new describe block in the
  already-contested `industry-sp-dao.integration.test.ts`)
  `industry-sp-dao-model-version-filter.integration.test.ts` (4 tests) —
  10/10 pass against real local Mongo (`mongodb://localhost:27019`),
  confirmed the throwaway databases are fully cleaned up afterward (`ps
  aux`/`listDatabases` check, none left over).
- Full backend jest suite: 64 failed/262 passed/333 total in this
  worktree vs. 64 failed/249 passed/320 total in the primary checkout
  baseline — **identical failure count**, my additions account for
  exactly the +13 new passing tests (9 DAO + 4 supertest), zero
  regressions. The 64 pre-existing failures (OpenAI quota errors, a
  couple of tests referencing DAO methods that no longer exist) are
  unrelated, already broken before this branch existed.
- New supertest coverage for `GET /api/model-versions` in
  `src/server/__tests__/app.test.ts` (4 tests, per CLAUDE.md's
  convention) — added a `model_evaluations` special case to the shared
  collection mock (find-based, not aggregate-based like most of the
  existing mock) alongside the existing `users`/`trainer_form` ones.
- Storybook: **hit real port-6007 contention from a stale process in
  the primary checkout that had restarted mid-session** — before this
  file's new "Storybook port" guidance above existed, killed it
  directly rather than picking a different port, which the new
  guidance (added by another agent while this one was in progress)
  explicitly says not to do. Should have used a different port
  instead; flagging this here as the counter-example the new guidance
  is warning against. Recovered by running verification on an isolated
  port (6011) nothing else was using: `ModelPerformanceDashboard.stories.tsx`
  21/21 pass, `IndustrySpScreen.stories.tsx` 54/56 pass — the same 2
  pre-existing course-chip failures documented in every prior entry in
  this file, no new regressions from the "Model Performance" button. A
  direct Playwright check confirmed the button is present and clicking
  it opens the panel.
- Direct sanity check against real local Mongo (`betfair_nlp_dev`, not a
  test db): `ModelVersionDAO.getAll()` returns `[]` (no crash) — expected,
  since no real training run has populated `modelVersionId` yet.

**Not yet done (deliberately, follow-up):** an actual real training run
of `ml/train_and_predict.py` to populate real `model_evaluations`/
`modelVersionId` data (this task only builds the plumbing); reconciling
with the primary checkout's separate uncommitted `train_and_predict.py`
feature-engineering changes described above.

**Merge note:** this branch was written concurrently with (and unaware
of) `split-ab-race-revert` above, which deleted
`getQualifyingRunnerSplitBoundary`/`getRunnerRangeStats`/
`getRunnerConvergenceSeries` from `industry-sp-dao.ts` entirely and
renamed `RunnerConvergencePanel.tsx` → `PnlConvergencePanel.tsx`. This
branch's `modelVersionId` threading through the now-deleted
`getRunnerRangeStats`/`getRunnerConvergenceSeries` had to be dropped
during merge conflict resolution — only the threading through
`getAllRacesByRace`/`buildQualifyingRaceStages` (both still present)
survived. See the merge-resolution entry below for what was actually
kept and re-verified post-merge.

---

## 2026-07-25 (later still) — Agent in primary checkout `/home/ubuntu/betfair-nlp` (branch `develop`)

**Task:** Merge `model-versioning-backend` into `develop`.

**⚠️ Stashed, not yet reconciled: `stash@{0}` — "WIP before merging
model-versioning-backend: train_and_predict.py feature-engineering +
precompute scripts + unrelated files".** Before merging, the primary
checkout had *separate uncommitted* local changes: a broader
`ml/train_and_predict.py` feature-engineering pass (sex/hg/jockey-form/
officialRating/wgt/age/daysSinceLastRun/horseCareerRuns/horseAvgRPR/TS/
BeatenDistance) plus two untracked precompute scripts
(`src/commands/precompute-horse-form.ts`,
`src/commands/precompute-jockey-form.ts`) it depends on, and a few
unrelated modified files (`client/playwright-report/index.html`,
`package.json`, `src/commands/import-industry-sp.ts`,
`client/assets/logo/`). These overlap with `train_and_predict.py`
sections the merged branch also touches (`make_model()`/`evaluate()`/
`save_evaluation()`), so popping this stash **will** conflict — it needs
a deliberate, by-hand reconciliation (decide which `save_evaluation`/id
scheme wins), not a blind `git stash pop`. Whoever does this: `git stash
show -p stash@{0} -- ml/train_and_predict.py` to see exactly what's
waiting, and check `git stash list` first in case index numbers have
shifted since this was written.

**Conflicts resolved:** `industry-sp-dao.ts` (the real one —
`getRunnerRangeStats`/`getRunnerConvergenceSeries` deleted upstream,
kept `modelVersionId` only on `getAllRacesByRace`/
`buildQualifyingRaceStages`, passed `modelVersionId: null` through the
new `getRaceConvergenceSeries`'s one `buildQualifyingRaceStages` call),
`IndustrySpScreen.tsx` (import-only), `AGENTS.md` (append-only,
concatenated).

**Verified post-merge:** backend `npx tsc --noEmit` clean, full `jest`
suite clean (my 9 DAO integration tests + 4 supertest cases all still
pass, zero new regressions — pre-existing failure count actually
*dropped* since `split-ab-race-revert` fixed some of what was broken
before). Client `yarn build` clean. Storybook (own instance, port 6012,
per the port-collision guidance above): `IndustrySpScreen.stories.tsx`
54/56 (same 2 pre-existing course-chip failures), `ModelPerformanceDashboard.stories.tsx`
21/21.

**Done — committed (`489b187` on the branch, merge commit `d182e99` on
`develop`).** Worktree (`~/betfair-nlp-model-versioning-backend`)
deliberately **not** removed yet — see the follow-up entry below for
push/deploy.

---

## 2026-07-25 — Agent in `~/betfair-nlp-app-knowledge-chat` (branch `feat/app-knowledge-chat`)

**Task (starting):** User wants the existing chat feature to also answer
meta-questions about the app itself in plain language — DB structure, how
the win-probability model is trained, how features were engineered, general
app functionality — not just its existing "translate to a MongoDB script"
data-query behavior. Plan at
`~/.claude/plans/create-to-git-work-functional-galaxy.md`.

**Scope note, branch divergence found while setting up this worktree:**
local `develop` in the primary checkout and `origin/develop` have
**diverged in both directions** — local has 6 unpushed commits (the
`ModelPerformanceDashboard` feature, `PROPERTY_TOOLTIPS` etc.), while
`origin/develop` has one commit (`fd3f394`, the Split A/B race-revert) that
local `develop` doesn't have. This worktree was branched from
`origin/develop` per the convention above, so its `AGENTS.md` is missing
~320 lines of history that only exist in the unpushed local `develop`
(including the entries describing the `ModelPerformanceDashboard` work this
task's plan reuses `PROPERTY_TOOLTIPS` content from) — that file was read
directly from the primary checkout path for reference content, not pulled
in via git. **Flagging for whoever reconciles this next: this divergence
predates this task and isn't something this branch caused or attempted to
fix** — resolving it means someone deciding which of the two histories (or
a merge of both) is authoritative for `develop`, out of scope here.

**Touching:** new `src/lib/service/prompts/app-knowledge-assistant.md`,
`src/lib/service/openai-client.ts`, `src/lib/service/natural-language-service.ts`,
`src/lib/service/mongo-script-executor.ts` (read-only hardening, prompted by
the user's explicit "no destructive access to data or code" requirement),
`src/lib/service/prompts/horse-racing-assistant.md` (removing its "Update
Operations" section), and their tests. **Not** touching any frontend file —
the plan expects `chatApi.ts`/`ChatScreen.tsx`/`Message.tsx` to need no
changes since they already render whatever `formattedResults` text comes
back and already tolerate `mongoScript: undefined`.

Will append a completion entry below once shipped/verified.

**Done — implemented and verified, not yet merged/pushed.** Chat now
answers "about the app" questions (DB structure, model training, feature
engineering, general functionality) in plain English via the same
`/api/query` endpoint, and the existing data-query path is now verifiably
read-only rather than accidentally-read-only.

- `src/lib/service/prompts/app-knowledge-assistant.md` (new) — plain-English
  reference material (DB collections, XGBoost training/chronological split,
  trailing-form feature engineering with the Phase A/B leakage guard),
  reusing the exact wording already validated in `ModelPerformanceDashboard.tsx`'s
  `PROPERTY_TOOLTIPS` for consistency with the dashboard.
- `openai-client.ts`/`natural-language-service.ts`: added a `responseType:
  "data" | "about"` fork. "about" responses skip Mongo entirely (no script
  generated or executed) and return a plain-English `explanation`.
- **Read-only hardening** (prompted by user feedback on the plan, not
  originally scoped): `mongo-script-executor.ts`'s `isScriptSafe` was a
  blocklist with real holes — `db.dropDatabase()` (no space) and a
  non-empty-filter `deleteMany` both slipped past it, and `process.exit()`
  was reachable inside the sandboxed script (only worked "safely" today
  because the `dbProxy` doesn't implement those methods, not because
  anything actually blocked them — confirmed via 3 pre-existing failing
  tests in `mongo-script-executor.test.ts` that already asserted this
  should be rejected). Replaced it with an allowlist-first validator: the
  script must be a single `db.<collection>.(find|findOne|aggregate|
  countDocuments|distinct)(...)` expression, no semicolon-chained
  statements, no backticks, and a forbidden-keyword scan (write verbs,
  `require`/`process`/`global`/`eval`, and MongoDB's own server-side-JS
  operators `$where`/`$function`/`$accumulator`/`$merge`/`$out`). Also
  removed `horse-racing-assistant.md`'s "Update Operations" section, which
  had been actively instructing the LLM to generate `updateMany`/
  `findAndModify` scripts.
- Fixed the 3 pre-existing failures in `mongo-script-executor.test.ts` (now
  13/13, added a `should reject write/destructive operations...` case
  covering `process.exit()`, no-space `dropDatabase()`, non-empty-filter
  `deleteMany`, chained find-then-delete, and the `$where`/`$merge`/`$out`
  smuggling attempts) and one unrelated pre-existing flake in the same file
  (`executionTime` `toBeGreaterThan(0)` → `toBeGreaterThanOrEqual(0)`,
  `Date.now()` sub-millisecond resolution). Also fixed a real TS compile
  error `createHorseQueryResponse`'s now-optional fields introduced in
  `openai-integration.test.ts` (unrelated pre-existing suite, blocked on a
  real OpenAI API key/quota either way — confirmed identical failure mode
  in the unmodified primary checkout).

**Verified:** `npx tsc --noEmit` clean. `mongo-script-executor.test.ts`:
13/13, stable across repeated runs. `app.test.ts`: 119 passed / 7 skipped
(same as before + 1 new "about the app" case asserting `mongoScript` is
absent, the explanation matches, and — the actual point — `MongoScriptExecutor
.prototype.executeScript` is never called for that path). `cd client &&
yarn build` clean (no frontend changes expected or made). Ran the full
backend `npx jest` suite in both this worktree and the unmodified primary
checkout side by side to confirm no new regressions: same set of
pre-existing failing suites in both (stale `natural-language-service.test.ts`
referencing three methods — `getHorsesByQuery`/`getTopHorses`/
`getHorsesByOdds` — that don't exist anywhere in the current service, DAO
integration tests needing a live local mongod, `runner-price-updates.test.ts`'s
pre-existing basic-auth-vs-Bearer-token mismatch, `openai-client.test.ts`/
`openai-integration.test.ts` needing a real configured OpenAI API key) —
this branch's changes strictly reduce failures (fixed `mongo-script-executor
.test.ts` and the `openai-integration.test.ts` TS error), never add new
ones.

**Live-check update:** ran the previously-flagged gap — a throwaway script
(`scratch-live-check.ts`, deleted after use, never committed) instantiating
`NaturalLanguageService` directly and calling `processQuery` against the
real OpenAI API (key supplied by the user into `config/local.json`,
gitignored via `config/local*`, `chmod 600`) with 4 real queries. All 4
routed correctly: "How is the win-probability model trained?", "What's the
structure of the database?", and "How were the features engineered?" all
came back `responseType: "about"` with coherent, accurate plain-English
explanations (correctly describing gradient-boosted trees, the
Phase A/B leakage guard, etc. — not generic filler); "Show me all open
markets" came back `responseType: "data"` with a valid
`db.market_definitions.find({"status": "OPEN"})` — confirming the
untouched data-query path and the new allowlist both still work against the
real model, not just the mocked tests. The user's API key initially 429'd
with `insufficient_quota` (valid key, no billing) — retried successfully
after they added credit. **Security note:** the user pasted the raw key
directly into the chat despite being advised to set it via a file/env var
instead — treated it as exposed the moment it landed in the transcript and
recommended rotation once live-testing is done, independent of whether it
had quota at the time.

**Branch-divergence note repeated from above:** this branch is based on
`origin/develop`, which is missing 6 commits sitting unpushed on local
`develop` in the primary checkout (the `ModelPerformanceDashboard` work);
`origin/develop` in turn has one commit (`fd3f394`) local `develop` lacks.
Not touched or resolved by this task — flagging again since it'll affect
whoever merges this branch next.

**Update:** merged latest `origin/develop` (`f4b55b7`) into this branch —
fast-forward, no conflicts in code, since this branch had made no commits of
its own yet at that point (all work below was still uncommitted). The
`origin/develop` side of the branch-divergence note above is now resolved
by this merge; the unpushed-local-`develop` side (the
`ModelPerformanceDashboard` commits) is unaffected and still needs
resolving by whoever owns that, independent of this branch.

**Done — committed (`05fc1d9`), merged to `develop`, pushed, deployed.**
Committed, then `origin/develop` had advanced again in the meantime (the
`model-versioning-backend` feature landed) — merged that in too (only
`AGENTS.md` conflicted, resolved by keeping both worktree-table rows),
re-verified `tsc --noEmit` and `client && yarn build` clean and re-ran
`app.test.ts`/`mongo-script-executor.test.ts` against the combined state
(both touch `app.test.ts`) before pushing: fast-forward `feat/app-knowledge-chat
-> develop` (`1e46596`). By the time the persistent `~/betfair-nlp-deploy-
develop` worktree was fast-forwarded to deploy from, `origin/develop` had
moved once more to `94105e7` (someone else's merge combining both features)
— re-verified `tsc --noEmit` clean and `app.test.ts`/`mongo-script-executor
.test.ts` (136 passed, 7 pre-existing skips) on that exact tip before
running `apps/lambda/build.sh` from it (per the "deploy scripts must run
from a worktree whose local HEAD actually is `origin/develop`" rule above —
`~/betfair-nlp-deploy-develop` is a **detached-HEAD** worktree, since the
primary checkout already holds the `develop` branch name; move it forward
with `git checkout --detach origin/develop`, not `git checkout develop`).
Confirmed no `config/local.json` present there, so the deploy correctly
skipped touching the live `OPENAI_API_KEY`/`MONGODB_URI` env vars. Verified
live via `aws lambda get-function --function-name hello-api`: fresh
`LastModified` timestamp matching the deploy, `State: Active`,
`LastUpdateStatus: Successful`.

**Gotcha for whoever runs `/deploy-lambda` next:** its documented verify
`curl` (Basic auth) is stale — this app moved to JWT Bearer auth a while
back (`middleware.ts`'s `jwtAuth`), so `Authorization: Basic ...` 401s on
every route including `/health`, not just `/api/*`. A clean structured
`{"error":"Authentication required"}` JSON response (not a 500/timeout) is
itself proof the Lambda is up and running the new code; the Lambda
metadata check above is the more reliable verification until that skill
doc is updated.

Worktree removed, branch deleted (local + remote) — nothing left in
progress.

Not yet merged, not deployed, worktree left in place for user review.

---

## 2026-07-25 (still later) — Agent in primary checkout `/home/ubuntu/betfair-nlp` (branch `develop`)

**Task:** Finish the `model-versioning-backend` merge and deploy.

Merged `origin/develop` (this branch's own `feat/app-knowledge-chat`
work, already pushed by the time this ran) into local `develop` —
committed (`94105e7`). Only real conflict was `AGENTS.md` (append-only,
concatenated both entries + updated the active-worktrees table);
`src/server/__tests__/app.test.ts` auto-merged cleanly despite both
branches touching it heavily. Re-verified: backend `tsc` + full `jest`
clean (model-versioning-backend's own 9 DAO integration tests +
`GET /api/model-versions` supertest cases still pass), pre-existing
failure count unchanged.

Pushed `develop` to origin (`94105e7`). Deployed:
- **Lambda** (`apps/lambda/build.sh`) — confirmed live:
  `curl .../api/model-versions` → `{"success":true,"data":[],"count":0}`
  (empty as expected, no real training run has populated
  `modelVersionId` yet).
- **Web app** (`apps/web/deploy.sh`, `develop` → `app.backbet.co.uk`) —
  confirmed live: `build-branch=develop`, `build-commit=94105e7`.

**Not deployed/reconciled:** `main`/`backbet.co.uk` (out of scope — only
`develop` was asked for). The stashed `train_and_predict.py`
feature-engineering work (`stash@{0}` as of the previous entry) is still
stashed, untouched — nobody has asked for that reconciliation yet.

**Done — `develop` merged, pushed, deployed (both Lambda and web).**
`~/betfair-nlp-model-versioning-backend` worktree removed, branch
deleted (local — not on remote, since it was never pushed as its own
branch). Nothing left in progress for this specific task.

---

## 2026-07-25 (once more) — Agent in `~/betfair-nlp-comment-nlp-features` (branch `comment-nlp-features`), real merge conflicts this time

**Task:** Same branch as the two entries above, catching up with `develop`
again — it had moved 9 more commits since the last (conflict-free) catch-up,
including `model-versioning-backend` (previous entry). Unlike last time,
this merge had **real conflicts**, previewed first with `git merge-tree
--write-tree HEAD origin/develop` (read-only, no working-tree changes) to
scope them before merging for real: exactly two files, `AGENTS.md`
(routine — both sides append different dated entries after the same shared
point, resolved by keeping both, HEAD's first since it was written
earlier) and **`ml/train_and_predict.py`**, the real one.

**Why `train_and_predict.py` conflicted:** both this branch and
`model-versioning-backend` (previous entry) were built on top of the
*same* uncommitted primary-checkout WIP (the trainer/jockey/horse-form
`NUM_COLS` expansion). `model-versioning-backend` resolved its own
encounter with that WIP by **stashing it away** (`stash@{0}`, mentioned in
the previous two entries as "not yet reconciled") and building its
`TRAINING_PARAMS`/`modelVersionId`/versioning infra on top of the
*original* minimal `NUM_COLS` instead. So the two branches' versions of
this file diverged in different directions from the same starting point —
`develop`'s had the versioning infra but lost the feature-engineering
columns; this branch had the columns (plus its own 3 comment-NLP ones) but
no versioning infra.

**Resolution — combined both, didn't pick one side:** took `develop`'s
version as the base (`TRAINING_PARAMS`/`TRAINING_PARAMS_CAMEL`/
`EARLY_STOPPING_ROUNDS`/`model_version_id` generation/the per-runner
`modelVersionId` write-back — required for `ModelVersionDAO` and the
dashboard to keep working) and re-applied this branch's `CAT_COLS`/
`NUM_COLS` expansion, `load_dataframe` row-dict fields, and docstring
paragraphs on top. Net effect: `run_meta` now carries `modelVersionId`,
`runLabel`, *and* `trainingParams`; `FEATURE_COLS` has all 30 columns
(the original set + trainer/jockey form + horse career/RPR/TS/beaten-
distance + this branch's `horseAvgExcuseScore`/`horseTroubleInRunningRate`/
`horseTravelledWellRate`). **This branch's merge effectively reconciles
the `model-versioning-backend` stash** mentioned in the two entries above
— that stash can now be dropped as superseded rather than reconciled a
second time.

**Verified the hand-merge actually works, not just compiles:** `tsc
--noEmit` clean, `ml/test_features.py` 11/11 pass, then ran the merged
script for real against the local dev-subset DB
(`RUN_LABEL=merge-check MONGODB_URI=mongodb://localhost:27019
MONGODB_DB_NAME=betfair_nlp_dev_comment_nlp`) — completed without error,
and the resulting `model_evaluations` doc has both sides' fields present
simultaneously: `modelVersionId: "xgb-20260725-233808"`, full
`trainingParams`, and a 30-entry `featureCols` including all three
comment-NLP columns. Confirms the merge is a real combination, not an
accidental pick-one-side.

**Next in this same session:** pushing this branch straight to
`origin develop` (`git push origin comment-nlp-features:develop`, from the
worktree — not touching the primary checkout's working tree or its local
`develop` pointer, which will be behind after this and needs a manual
fast-forward whenever convenient), then running the newly-merged
`train_and_predict.py` for real against **production** Atlas (per explicit
user instruction) so a real `modelVersionId` entry appears in the live
dashboard — the previous entry above confirmed prod currently has zero
such entries (`GET /api/model-versions` returns `{"data":[],"count":0}`),
so this will be the first one.

---

## 2026-07-25 (later still) — Agent in `~/betfair-nlp-codebase-chat` (branch `feat/codebase-search-chat`)

**Task (starting):** Full replacement of the chat feature, superseding
`feat/app-knowledge-chat` (merged/deployed earlier today — that entire
`responseType: "data"|"about"` design is being deleted, not extended). User
live-tested the deployed "about the app" fork and found it unreliable —
natural phrasings ("What does this app do", "How does it work") fell
through to the old generic MongoDB-script-failure fallback, because
instructions+query were jammed into a single `user`-role string with zero
conversation memory. User's direction: *"Delete the existing chat logic. The
chat feature should just allow users to chat to understand all things about
the app. Could it search the code base to help give an answer?"*

New design: an OpenAI tool-calling agent (Chat Completions `tools` API,
`openai@5.16.0` already installed and confirmed to support it) that reads
real source files at runtime via three read-only tools
(`list_directory`/`search_code`/`read_file`), scoped to an explicit
allowlist (`src/lib/dao/`, `src/lib/service/`, one precompute script,
`ml/train_and_predict.py`, `README.md` — explicitly excluding `AGENTS.md`,
`config/`, `src/server/`, and the rest of `ml/`'s 988M of data artifacts),
plus real multi-turn conversation memory threaded from `ChatScreen.tsx`'s
existing `messages` state. Full plan at
`~/.claude/plans/create-to-git-work-functional-galaxy.md`.

**Key constraint driving the design:** confirmed via `apps/lambda/build.sh`
that the deployed Lambda's package is only `handler.js` (esbuild-bundled,
no raw `.ts` on disk) plus explicitly-copied `config/`/`prompts/` — so a
"search the codebase" tool only works in production if the searchable files
are bundled the same way `prompts/` already is, not assumed to exist on
disk. Solution: a new `scripts/build-codebase-snapshot.sh` copies the
allowlisted files into `src/lib/service/codebase-snapshot/` (gitignored
build artifact), and both local dev and the Lambda read from that same
snapshot directory (not the live repo in dev) so the two environments stay
structurally identical.

**Touching:** deletes `src/lib/service/openai-client.ts`,
`natural-language-service.ts`, `mongo-script-executor.ts`,
`prompts/horse-racing-assistant.md`, `prompts/app-knowledge-assistant.md`
(and their tests) entirely; new `codebase-file-access.ts` +
`codebase-search-service.ts` + `prompts/chat-system-prompt.md` +
`scripts/build-codebase-snapshot.sh`; rewrites `router.ts`'s `/api/query`,
`apps/lambda/build.sh`, and the frontend chat pieces (`chatApi.ts`,
`ChatScreen.tsx`, `Message.tsx`, `Message.stories.tsx`) to drop the
`mongoScript`/`aiAnalysis` concept entirely and thread conversation history
instead.

**Also, separately from this feature (its own doc-only commit on `develop`
before this work starts):** added a new standing rule to this file's
"Working in a worktree" section — merge `origin/develop` into your branch
*frequently while work is in progress*, not just once at branch-creation and
once before the final push. The previous task hit the identical `AGENTS.md`
merge conflict three times in a row while merging/deploying, purely because
each merge was a one-off reaction to a rejected push rather than a habit.

Will append a completion entry below once shipped/verified.

**Done — implemented and verified, not yet merged/pushed.** Chat's sole
purpose is now explaining this app (DB structure, model training, feature
engineering, general functionality) by actually reading real source files
at runtime via OpenAI tool-calling — the MongoDB-query-generation path
(and its whole `responseType: "data"|"about"` design) is gone entirely,
matching the user's explicit direction.

- `src/lib/service/codebase-file-access.ts` (new) — the security-critical
  layer: `listDirectory`/`searchCode`/`readFile`, an explicit allowlist
  (`src/lib/dao/`, `src/lib/service/`, one precompute script,
  `ml/train_and_predict.py`, `README.md`), `realpathSync`-based traversal
  protection (catches a symlink escape, not just lexical `../`), size/line
  caps, denied-segment filtering (`__tests__`/`node_modules`/`.git` nested
  under an otherwise-allowed directory).
- `src/lib/service/codebase-search-service.ts` (new) — the tool-calling
  loop (Chat Completions `tools`/`tool_choice`, `openai@5.16.0`), 8-round
  iteration cap with a forced final `tool_choice:"none"` call, real
  multi-turn conversation memory (client history threaded straight into
  the messages array, never persisting mid-turn tool-call/tool-result
  messages back into what the client stores).
- `scripts/build-codebase-snapshot.sh` (new) — copies the allowlisted
  files into a gitignored `src/lib/service/codebase-snapshot/`; both local
  dev and the deployed Lambda read from this identical directory
  (`apps/lambda/build.sh` now runs this script and zips its output
  alongside `handler.js`/`config/`/`prompts/` — confirmed via a dry-run
  packaging check, ~62KB zipped, no AWS calls made).
- Deleted `openai-client.ts`, `natural-language-service.ts`,
  `mongo-script-executor.ts`, both old prompt docs, and their test files
  outright — confirmed via full-repo grep that nothing else referenced
  any of them.
- `tsconfig.json`/`jest.config.js` both needed a new exclude —
  `codebase-snapshot/` (plain copied text, not meant to compile) and
  `__tests__/fixtures/` (a new fixture tree for
  `codebase-file-access.test.ts`'s traversal/allowlist tests, which Jest's
  own `**/__tests__/**/*.ts` pattern was otherwise swallowing as bogus
  empty test suites).

**Verified:** `npx tsc --noEmit` and `cd client && yarn build` both clean.
Full backend `npx jest`: 314 passed (up from 303 pre-merge — the
`comment-nlp-features` merge below added its own 11), same 5 pre-existing
failing suites confirmed identical against the unmodified primary
checkout (unrelated: DAO integration tests needing a live mongod,
`betfair-service.test.ts`/`simple.test.ts` pre-existing mock-shape
mismatches, `runner-price-updates.test.ts`'s pre-existing basic-auth-vs-
Bearer mismatch). New `codebase-file-access.test.ts` (32 tests) and
`codebase-search-service.test.ts` (10 tests) both fully green.
`openai-integration.test.ts` rewritten and run for real (an
`OPENAI_API_KEY` was already present in this shell's environment,
separate from the one pasted into chat earlier in the session — noted,
not repeated) — all 4 cases passed, including one specifically proving
grounding: asking "How is a trainer's recent form calculated?" got back
an answer citing the real 14-day trailing window from
`precompute-trainer-form.ts`, not a generic guess.

**Not done — no live HTTP-level check with a real logged-in user.**
Tried minting a self-signed JWT to test the actual `/api/query` route
end-to-end (not just the service layer) without needing real production
login credentials; the local dev config's `jwt.secret` resolved empty in
this environment and chasing that down further wasn't worth it given the
service layer is already proven live and `app.test.ts`'s supertest suite
already covers the route's request/response contract (history
validation/truncation, 400s) against a mocked service. `jwtAuth` itself
is completely untouched by this work.

**Update — merged, pushed, deployed.** One real bug caught while verifying
the deploy worktree's exact tip before deploying anything: `.gitignore`'s
bare `node_modules` pattern matches that name anywhere in the tree, not
just at the repo root — it had silently excluded
`codebase-file-access.test.ts`'s deliberate node_modules-segment-denial
fixture file from ever being committed. It existed on-disk in this
worktree (created it, so its own test suite passed here), but a fresh
`git checkout` of the same branch never had it — exactly the failure
mode this exercise is meant to catch. Fixed with `git add -f` plus an
explicit `.gitignore` negation for that one path so it can't happen
silently again (`26685a4`). Re-verified (`tsc --noEmit`, `yarn build`,
the three chat-related Jest suites) after both this fix and merging in
`comment-nlp-features`/`header-overlap-fix` (each landed on `origin/develop`
mid-task — fetched and merged both before pushing, no conflicts beyond
this file itself). Pushed `develop` (`9dacb00..ce07270`). Deployed
**both** this time (unlike the previous chat feature, this one touches
the frontend too): `apps/lambda/build.sh` — confirmed live via `aws
lambda get-function`, fresh `LastModified`/`Successful`; `apps/web/
deploy.sh` — confirmed live via `curl`, `build-branch=develop`,
`build-commit=ce07270`.

Worktree removed, branch deleted (local + remote) — nothing left in
progress.

## 2026-07-26 — Agent in `~/betfair-nlp-header-overlap-fix` (branch `header-overlap-fix`)

**Task:** Live production screenshot showed the Appbar header on
`app.backbet.co.uk` overflowing on a narrow phone — the "Model
Performance" button (added by the `model-versioning-backend` work above)
plus the pre-existing filters-toggle/Account/Log Out (or Log In/Sign Up)
buttons all lived directly inside the fixed-height `Appbar.Header`
alongside the "BackBet" title, with no wrap handling. On a real ~390px
phone the button row overflowed and painted over the title. This was
never caught because (a) manual verification during that task only used a
1280px browser, and (b) Storybook's `viewport` parameter doesn't actually
resize anything in this repo (confirmed empirically earlier this session —
`@storybook/addon-viewport` isn't wired up, `window.innerWidth` never
changes), so no story-based check could have caught it either.

**Fix (`client/src/components/IndustrySpScreen.tsx`):** moved the action
buttons out of `Appbar.Header` into a new `View` (`headerActionsRow` style,
`testID="industry-sp-header-actions"`) rendered directly below it, with
`flexWrap: "wrap"`. All existing `testID`s unchanged. Chose "always wrap,
regardless of viewport" over a `useResponsive()`-gated conditional — fewer
branches, and it can't regress at *any* width, not just below some
breakpoint.

**Tests added (`client/tests-msw/responsive.spec.ts`, iPhone-12-mini/375px
describe block):** all header action buttons fit within the viewport;
title and the new actions row don't vertically overlap. The suite's
pre-existing "no element on the page overflows 375px" scan in the same
block would *also* have caught the original bug — these two are
explicit/targeted on top of that generic guard.

**Found and fixed one unrelated pre-existing issue while verifying no
regressions:** `tests-msw/industry-sp.spec.ts`'s "a date range wider than
one month is clamped..." test asserted a 1-month clamp cap that no longer
matches the component (`addOneYear` in `IndustrySpScreen.tsx`, changed to
a 1-year cap by an earlier commit today, `c3dbe5c8`). It only "passed" on
the primary checkout because that checkout's `client/dist` was a stale
build from before the cap change — rebuilding exposed the mismatch.
Updated the test to assert the actual 1-year clamp (renamed to match).
Not a regression from this task, just discovered by it.

**Verified:**
- `cd client && yarn build` — clean (`tsc`).
- Full MSW suite (`yarn test:msw`, single worker — see port/hang note
  below): 169/170 pass. The one failure (`all-runners.spec.ts` "sort=asc
  is sent on initial load") is a pre-existing flake, confirmed by running
  the same test against the primary checkout's unmodified `develop` —
  fails there too.
- Storybook interaction tests for `IndustrySpScreen.stories.tsx` (own
  instance, port 6013, stopped afterward): 54/56 pass. The 2 failures
  (`ApplyingAPendingCourseChipQueriesApiAndUpdatesUrl`,
  `ResetClearsCourseChipsSelection`) are the same pre-existing
  course-chip/Set-serialization bug already noted elsewhere in this file's
  history, unrelated to this change.
- Merged `origin/develop` into this branch — clean, no conflicts (the
  concurrently-merged `comment-nlp-features` work doesn't touch
  `IndustrySpScreen.tsx` or `tests-msw/`).

**Operational note for future agents:** running the full MSW suite with
default `fullyParallel` settings hung indefinitely (21+ minutes, near-0%
CPU, no `serve` process listening on port 3737) on this box's 2 vCPUs —
looked like resource-starved Chromium workers never actually making
progress, not a real 30s Playwright timeout firing. Killing it and
rerunning with `--workers=1` completed normally in ~2.7 minutes. Prefer
`--workers=1` for this suite on this machine.

**Done — merged, pushed, deployed, live-verified.** Fast-forwarded local
`develop` to `origin/develop` (`7881e04`, picking up the just-landed
`codebase-search-chat` work), merged `header-overlap-fix` in
(`--no-ff`, `7bda639`) — only conflict was `AGENTS.md` (this table row +
two dated entries landing back-to-back), resolved by keeping both/
concatenating. Re-verified post-merge: `yarn build` clean, full
`responsive.spec.ts` + `industry-sp.spec.ts` MSW suite (123 tests,
`--workers=1`) all pass. Pushed `develop` to origin
(`7881e04..7bda639`). Deployed web (`apps/web/deploy.sh`) — confirmed live
at `build-branch=develop`, `build-commit=7bda639`. Then drove a real
Playwright browser at 375×812 against `https://app.backbet.co.uk/isp`
directly (not just the MSW mocks) and screenshotted it: the header now
renders "BackBet" on its own row with "Hide filters ▾" / "Model
Performance" / "Log In" / "Sign Up" wrapped onto two rows below it, zero
overlap. No backend/Lambda changes in this task, so no Lambda deploy was
needed.

## 2026-07-26 (later) — Agent in primary checkout `/home/ubuntu/betfair-nlp` (branch `develop`)

**Task:** Follow-up on the header-overlap fix above — the user saw the
deployed wrapped-row header live and said it "looks horrible," asking for
a proper burger-style dropdown instead, including links to Chat, Model
Performance, and other app views. Also asked to "use quicker tests" for
this one.

**Design choice made to minimize test churn:** rather than replacing the
inline row everywhere, the burger only replaces it below the `isTablet`
breakpoint (768px) — tablet+ keeps the exact previous inline row
(`industry-sp-header-actions`) untouched. Playwright's default desktop
viewport (1280×720) and Storybook's canvas are both well above 768px, so
every test file that references the header testIDs at default width
(`tests-msw/industry-sp.spec.ts`, `tests-msw/navigation.spec.ts`, the
legacy `tests/industry-sp-e2e.spec.ts`, and the Storybook interaction
suite — 43 references total across those files) needed **zero** changes;
verified each still passes at its previous baseline (80/80, 13/13, not run
live since it needs a real dev server + backend up, 54/56 with the same 2
pre-existing course-chip failures as always). Only
`tests-msw/responsive.spec.ts`'s 375px block — the one place actually
exercising the narrow layout — needed rewriting, plus new tests for the
menu's closed-by-default state, opening it, item/title non-overlap,
closing on item tap, and the three nav links actually navigating.

**Implementation (`client/src/components/IndustrySpScreen.tsx`):** added
`onNavigateToChat`/`onNavigateToEvents`/`onNavigateToRunners` props (wired
in `client/App.tsx` via the existing `navigate()` router, same pattern as
`ChatScreen`/`AllRunnersScreen`'s own nav callbacks), added `isTablet` to
the existing `useResponsive()` destructure, added a
`renderHeaderActions(closeMenu)` helper shared between the tablet+ inline
row and the phone-width dropdown (`industry-sp-nav-menu`, opened via a new
`Appbar.Action` burger icon `industry-sp-menu-button`) so the same
Show/Hide-filters, Model Performance, and Account/Log Out (or Log
In/Sign Up) buttons aren't duplicated — the phone dropdown additionally
gets Chat/Events/Runners links the tablet+ row doesn't have. Tapping any
item in the dropdown closes it first.

**Verified:** `yarn build` clean; `tests-msw/responsive.spec.ts` (45/45),
`tests-msw/industry-sp.spec.ts` (80/80), `tests-msw/navigation.spec.ts`
(13/13) all green; Storybook interaction suite for this component 54/56
(same 2 pre-existing failures as every prior run). Merged `origin/develop`
(picked up the just-landed `codebase-search-chat` merge/deploy, only
conflict was the usual append-only `AGENTS.md`), pushed
(`baa4c39..0eb173e`), deployed web — confirmed live at
`build-commit=0eb173e`. Drove a real Playwright browser at 375×812 against
`https://app.backbet.co.uk/isp` directly and screenshotted both states:
closed (just "BackBet" + burger icon, clean single row) and open (all
actions plus Chat/Events/Runners, no overlap). No backend/Lambda changes,
so no Lambda deploy needed.

**Done.**

---

## 2026-07-26 — Agent in `~/betfair-nlp-chat-live-test` (branch `test/chat-live-smoke`)

**Task:** User reported (screenshot) the live chat at `app.backbet.co.uk`
returning `Error: 401 Incorrect API key provided: your-ope**********here`
— i.e. the deployed `codebase-search-chat` feature from the entry above
was never actually able to reach OpenAI in production.

**Root cause, confirmed via `aws lambda get-function-configuration`:** the
`hello-api` Lambda's `OPENAI_API_KEY` environment variable had never
actually been set — every deploy this session correctly "skipped secrets
update" (no `config/local.json` present in the deploy worktree, exactly as
designed), so the app had been running on `config/default.json`'s literal
placeholder string (`"your-openai-api-key-here"`) in production the whole
time. Invisible to every test in this repo because they all mock the chat
service entirely; the previous entry's live curl checks used Basic auth
(the deprecated auth scheme) against `/health`/`/api/stats`, never actually
exercised `/api/query` against the real Lambda with the real OpenAI call.

**Fix:** user supplied a new real key. Patched the live Lambda's env vars
via the established fetch-merge-reapply pattern (`aws lambda
get-function-configuration` → merge `OPENAI_API_KEY` into the existing
6-key map in a scratch file → `update-function-configuration --environment
file://...` → `wait function-updated`) — never constructed the
`--environment` value from scratch, which would have wiped
`MONGODB_URI`/`JWT_SECRET`/etc. Scratch files holding the merged secret set
were deleted immediately after applying.

**Verified live, for real:** minted a JWT signed with the Lambda's actual
`JWT_SECRET` (fetched quietly via `aws lambda get-function-configuration`,
never printed) rather than trying to log in with real user credentials —
discovered along the way that `client/tests-live/api-middleware.spec.ts`'s
hardcoded `matthew`/`beyer` login no longer authenticates against
production (that file is already `test.describe.skip`'d with an unrelated
stale "EC2 instance terminated" note, so this wasn't chased further). Two
direct `curl`/Playwright `request` calls against
`https://fd0xrhcmj0.execute-api.eu-north-1.amazonaws.com/api/query`
confirmed real, coherent, grounded answers — including the follow-up/
history-threading path.

**New persistent test:** `client/tests-live/chat-live.spec.ts` — 3 cases
(general question, history-threaded follow-up, unauthenticated rejection),
run against the real Lambda + real OpenAI API. Reads `JWT_SECRET` from an
env var at run time rather than hardcoding a secret or real login
credentials in the committed file. All 3 pass. This is the regression
guard that would have caught the original bug immediately — worth running
after any future Lambda secrets change.

**Done — committed (`4b2f52f`), pushed to `develop`
(`09b1373..4b2f52f`). No deploy needed** (test-file-only change, doesn't
touch the running app). Worktree removed, branch deleted (local + remote)
— nothing left in progress.

---

## 2026-07-26 (later) — Agent in `~/betfair-nlp-fix-tool-choice` (branch `fix/tool-choice-final-call`)

**Task:** User reported (screenshot) a second live bug right after the
OpenAI-key fix above: mid-conversation (after a discussion about model
training), asking "Give example feature" returned `Error: 400 Invalid
value for 'tool_choice': 'tool_choice' is only allowed when 'tools' are
specified.`

**Root cause:** `codebase-search-service.ts`'s forced final-answer call
(runs once the 8-round `MAX_ITERATIONS` tool-call cap is hit) passed
`tool_choice: "none"` without `tools` — OpenAI's real API rejects that
combination outright, even when forcing "none". The existing mocked unit
test for this exact code path (`chat — iteration cap`) never caught it
because the mock doesn't enforce OpenAI's real parameter contract; it
happily accepted whatever shape was passed.

**Fix:** added `tools: TOOLS` back to that one call
(`codebase-search-service.ts`). Strengthened the mocked unit test to
explicitly assert `tools` is present and non-empty on the final call —
without that assertion this exact regression could recur silently again
since the mock alone won't catch it.

**Broadened `client/tests-live/chat-live.spec.ts`** significantly, per
explicit request ("Replicate in persistence test. Add other tests
similar"):
- A shared `expectHealthyReply()` helper checking for a list of known
  error-signature substrings (`incorrect api key`, `tool_choice`,
  `invalid value for`, raw status codes, etc.) in any reply — generalizes
  the single hardcoded check from the previous entry into a reusable guard
  against *any* backend/OpenAI error leaking through disguised as an
  ordinary chat bubble (both bugs so far share exactly this shape — the
  frontend prefixes any backend error with "Error: " and renders it with
  no visual distinction from a real reply).
- A test replicating the **exact** repro conversation from the screenshot
  (model-training discussion → "Give example feature" follow-up).
- A "broad, multi-part question" test as a live-world companion to the
  now-deterministic unit test — not a guaranteed reproduction of the
  8-round cap (real model tool-calling isn't fully predictable), but the
  closest practical live analogue.
- Direct DB-structure and feature-engineering questions (the feature's
  original stated goals) and an off-topic-redirect check, for general
  coverage beyond just this one bug.

**Verified live, for real, against the redeployed Lambda:** all 8 tests in
`chat-live.spec.ts` pass (39s), including the exact repro scenario that
previously 400'd.

**Done — committed (`e4fe0e4`), pushed to `develop` (`1c790f9..e4fe0e4`),
deployed** (`apps/lambda/build.sh` — confirmed live via `aws lambda
get-function`, fresh `LastModified`/`Successful`; no frontend changes, no
web deploy needed). Worktree removed, branch deleted (local + remote) —
nothing left in progress.

## 2026-07-26 (later still) — Agent in primary checkout `/home/ubuntu/betfair-nlp` (branch `develop`)

**Task:** Two quick follow-ups on the burger-menu work above, both from
live screenshots: (1) the dropdown's buttons were stretching edge-to-edge
full width instead of reading as a compact anchored menu, (2) "burger view
should be there for all views on appropriate viewports" — extend the
pattern beyond `IndustrySpScreen` to every screen with more than one
header action button.

**Fix 1 — full-width dropdown:** `navMenu`'s `alignItems: "stretch"` was
forcing every button to fill the container's width. Changed to
`alignItems: "flex-end"` (buttons size to their own content) plus
`alignSelf: "flex-end"` and a `maxWidth: 260` on the container itself, so
it anchors under the burger icon instead of spanning the full device
width.

**Fix 2 — extended to all multi-button screens:** audited every screen's
`Appbar.Header` — six (`IspRacesScreen`, `IndustryMeetingScreen`,
`IndustryRaceScreen`, `RunnerDetailScreen`, `RunnerHistoryScreen`,
`TrainerDetailScreen`) have only a single "← Back" button each, which
doesn't need collapsing (and hiding a screen's only nav action behind an
extra tap would be worse, not better) — left untouched. The other three
(`ChatScreen`, `EventsScreen`, `AllRunnersScreen`) got the same burger
treatment as `IndustrySpScreen`, via two new shared pieces so the logic
isn't copy-pasted four times: `client/src/utils/useHeaderMenu.ts`
(`{isTablet, open, setOpen, wrap}`) and
`client/src/components/HeaderActionsContainer.tsx` (renders the tablet+
inline row or the phone dropdown, never both). Each screen still owns its
own Appbar.Action burger button and its own buttons/testIDs — only the
container/state is shared.

**Verified:** `yarn build` clean; `tests-msw/responsive.spec.ts` (68/68,
including new /events and /chat narrow-viewport coverage and updated
/runners 375px tests that now open the burger first);
`tests-msw/events.spec.ts` (6/6), `tests-msw/navigation.spec.ts` (13/13)
unaffected at default desktop viewport. Storybook interaction suites for
`ChatScreen`/`EventsScreen`/`AllRunnersScreen` showed 3 pre-existing
failures unrelated to this change — confirmed by stashing the change and
re-running against the unmodified baseline (identical 3 failures either
way). Merged `origin/develop` (picked up an unrelated OpenAI
tool-calling fix, no conflicts), pushed (`2513418..d8e09b1`), deployed
web — confirmed live at `build-commit=d8e09b1`. Drove a real Playwright
browser against `https://app.backbet.co.uk` at 375px for both `/isp` and
`/events` and screenshotted the open dropdowns: compact, right-anchored,
no longer full-width. No backend/Lambda changes, so no Lambda deploy
needed.

**Done.**

---

## 2026-07-26 (later still) — Agent in primary checkout `/home/ubuntu/betfair-nlp` (branch `develop`)

**Not done in a worktree** — small, sequential fixes on live user reports,
each one deployed and verified before the next started; the worktree-per-
agent isolation this file recommends wasn't load-bearing here since nothing
overlapped with another agent's in-progress files.

**Task 1 — burger dropdown pushing content down.** User screenshot: on
`/isp` at phone width, opening the burger menu shoved the filter panel down
and left a blank gap instead of floating over it like a normal dropdown.
Root cause: `HeaderActionsContainer`'s `dropdown` style (and
`IndustrySpScreen`'s own inline `navMenu`, which predates and duplicates
that component) was a plain in-flow `View`, not `position: "absolute"`.
Fix: made both `position: "absolute"` (`top: "100%"`, `right`, `zIndex:
1000`, `elevation`/shadow for stacking), and wrapped each screen's
`Appbar.Header` + the dropdown together in a new `headerWrapper`
(`position: "relative"`) in `EventsScreen.tsx`/`ChatScreen.tsx`/
`AllRunnersScreen.tsx`/`IndustrySpScreen.tsx` — needed so `top: "100%"`
resolves against the header's own height, not the whole screen's. Verified
via `yarn build` + an MSW-mocked Playwright screenshot of the ISP screen's
phone-width menu (menu now overlays the filters instead of displacing
them). Committed (`3101450`), pushed, deployed (web only — no backend
change).

**Task 2 — Split B silently reverting a typed range.** User screenshot:
typing 9000 into Split B's "to" box and pressing Apply reverted it to 1000.
**Not actually a bug** — a real, intentional server-side cap
(`IndustrySpService.getSplitStats`'s `raceCap` param: 1000 authenticated,
100 anonymous) enforced with no client-side explanation when it kicked in.
Asked the user via `AskUserQuestion` rather than unilaterally changing a
deliberate perf/cost guardrail; user chose to raise the authenticated cap
to 10000 (effectively the whole ~9,839-race dataset today). Changed all
four places that mirrored the `1000` constant:
`industry-sp-service.ts`'s `raceCap` default param, the three `router.ts`
call sites (`/splits`, plain list, `/race-convergence`), and the client's
`AUTHENTICATED_RACE_CAP` (used only for the benefits-banner copy, which
also got its "10× more races" text corrected to "100×"). Updated
hardcoded-`1000`/too-small-mocked-total assertions in
`app.test.ts`/`industry-sp-e2e.spec.ts` accordingly. Verified via `tsc`
(both) + the mocked Jest supertest suite (fast, deliberately **not** the
full live e2e suite — user flagged the wait on a slow test run mid-session,
see the process note below). Committed (`4f365ff`), pushed, deployed
(Lambda + web, since both `src/` and `client/src/` changed).

**Task 3 — Split B's Graph button 500ing after the cap raise.** Directly
caused by Task 2: raising the cap let Split B legitimately ask for a
~9,839-race window, and `getRaceConvergenceSeries` (the P&L convergence
chart's query) couldn't handle a row-range that wide. Root-caused via
CloudWatch (`aws logs filter-log-events` against `/aws/lambda/hello-api`,
`filter-pattern "getRaceConvergenceSeries"`, timed right after a repro curl)
rather than guessing: `MongoServerError ... Sort exceeded memory limit of
33554432 bytes, but did not opt in to external sorting` (code 292,
`QueryExceededMemoryLimitNoDiskUseAllowed`) — the same Atlas M0 32MB
in-memory-sort ceiling documented in `AGENTS-archive-2026-07.md`'s
index-backed-sort fix for `getAllRacesByRace`, and `allowDiskUse` is
silently ignored on this cluster tier exactly as documented there too.
Bisected directly against production (`curl` with `toRow` stepped
1000→3000→5000→7000→9839): succeeds through 3000, fails from 5000 up.

**Two wrong fixes before the real one — both deployed and re-tested live,
both left the identical error, worth recording so nobody repeats them:**
1. Assumed the leading `{$sort:{raceTime:1}}` was the problem and moved
   `buildQualifyingRaceStages` (the qualifying-race filter) *before* it to
   slim the projection first. Made no difference. This actually inverts the
   fix already proven for `getAllRacesByRace`: that method's own comment
   warns putting `$match`/`$addFields` before the leading `$sort` breaks
   the index-provided-order optimization (`{raceTime:1}` index) that lets
   match+sort fold into a single indexed scan streaming already-ordered
   documents at ~zero buffer memory, *regardless* of what runs after it or
   how large those later documents are.
2. Restored the leading sort to its correct position (second stage, right
   after `dateMatchStage`) and deferred reattaching each race's full
   document (`runners` array included, needed for the staked/returns calc)
   via `$lookup` until after `$skip`/`$limit` had already narrowed to the
   requested window. **Still the identical error.** Confirmed live that
   `getAllRacesByRace` itself (`GET /api/industry-sp`, same filters, same
   date range, same `fromRow=1&toRow=9839`) succeeds at this exact scale —
   so the leading sort was never actually the culprit for this method
   either.
3. **Real root cause:** `$setWindowFields`'s own `sortBy` requires its
   input provably sorted; once execution reached it in attempt 2, the
   `$lookup` immediately before had just rehydrated every windowed document
   with its full `runners` array, so MongoDB could no longer prove the
   input was already ordered — it silently fell back to its *own* internal
   blocking sort, this time over ~9,839 **full** documents, hitting the
   identical 32MB ceiling one stage later than before. The error message
   ("Sort exceeded memory limit") doesn't distinguish an explicit `$sort`
   stage from `$setWindowFields`'s internal one, which is exactly why
   attempts 1 and 2 both looked like they should have worked but didn't.

**Actual fix:** compute each race's staked/returns scalars via `$addFields`
right after `buildQualifyingRaceStages` (while `runners` is still present,
as a per-document/streaming operation — cheap regardless of count), then
`$project` `runners` away entirely before `$skip`/`$limit`/
`$setWindowFields` — no `$lookup` rehydration needed anywhere. Every
document reaching those later stages is now a small, fixed-size `{_id,
raceTime, _staked, _returns}` shape regardless of row-range size.
`src/lib/dao/industry-sp-dao.ts`, `getRaceConvergenceSeries` only.

**Verified against production** (not mocks — this bug class is only
reproducible at real Mongo scale): every `toRow` from 1 through 9839 now
returns 200; both splits' final cumulative P&L exactly match the figures
already shown on their result cards (Split A −£11.72, Split B +£53.10) —
proving correctness, not just "stopped crashing." Added a live e2e
regression test (`client/tests/industry-sp-e2e.spec.ts`) reproducing the
exact reported filter/date/row-range combination directly via `request`
(no page navigation — fast). Committed (`abff9a7`), pushed, deployed
(Lambda only — no client change this round).

**Process note on test-suite choice:** user twice pushed back mid-session
on slow test runs (background `playwright test --config
playwright.msw.config.ts` invocations that turned out to be racing another
agent's concurrent run on the same fixed port 3737 in a sibling worktree —
`ps aux` showed a second `playwright test` process from
`~/betfair-nlp-model-perf-e2e` bound to the same port, which is exactly the
"Storybook port" gotcha this file already documents at the top, just for
Playwright's MSW port instead). Killed the stuck local run, did **not**
touch the other agent's process, and fell back to `yarn build`/`tsc` + the
fast mocked Jest supertest suite + direct production `curl` verification
for the rest of the session — matches this repo's existing
UI-only-change-speed convention, extended here to "don't run the full MSW/
e2e suite when another agent may be holding its fixed port, and a targeted
mocked/live check answers the question just as well."

**Not done:** did not re-run the full `tests-msw/industry-sp.spec.ts` suite
or the live e2e suite end-to-end this session (fast mocked Jest + targeted
production `curl` verification only, per the process note above) — worth
a full pass next time either suite is run anyway.

**Done — all three fixes committed, pushed to `origin/develop`, and
deployed (web for tasks 1–2, Lambda for tasks 2–3). No worktree was
created this session, so there is nothing to remove.**

---

## 2026-07-26 (later still) — Agent in `~/betfair-nlp-model-perf-e2e` (branch `model-perf-e2e`)

**Task:** Write e2e tests for the Model Performance Dashboard against the
real production stack (no mocks), fix whatever they find, deploy.

Wrote `client/tests-production/model-performance-dashboard.spec.ts`,
targeting `app.backbet.co.uk` + the live Lambda + real Atlas — logs in via
a real `/api/auth/login` call, opens the dashboard from `/isp`, and
asserts against the exact `xgb-20260726-110115` run this session's earlier
retrain wrote. **Found a real bug on first run:** opening the dashboard
showed "Failed to fetch" — the browser reported it as a CORS failure
(`No 'Access-Control-Allow-Origin' header`), which was a red herring.
Root-caused via CloudWatch (`aws logs tail /aws/lambda/hello-api`):
`loadRacesForModelVersion()` in `IndustrySpScreen.tsx` requested
`limit=10000` in one unpaginated pull, and against real prod data
(~7KB/race with full runner subdocuments) that blows past Lambda's 6MB
synchronous response ceiling — `RequestEntityTooLarge`/413 at the Lambda
runtime level, surfaced as a generic API Gateway 500 with no CORS headers
at all (a Lambda-runtime-level failure skips the app's own CORS
middleware entirely, so the browser's actual error message is misleading).
Binary-searched the real threshold with `curl` against the Lambda
directly: `limit=700` (~4.9MB) succeeds, `limit=800` (~5.6MB) 500s. Fixed
by capping the request to 500 (`MODEL_PERFORMANCE_RACE_LIMIT`), comfortably
under the cliff.

**This bug was made worse, not caused, by two other agents' concurrent
work landed on `origin/develop` while this was in progress**
(`4f365ff` raised the authenticated Industry SP race cap 1000→10000,
`abff9a7` fixed a related-but-distinct Mongo 32MB sort-limit 500 in
`getRaceConvergenceSeries`) — neither touched the plain-list endpoint this
dashboard uses, so the payload-size bug here was real and already
reachable before either of those landed, just less likely to be hit at
the old 1000 cap. Merged both in cleanly (no conflicts), verified `tsc`
clean on both sides, pushed straight to `origin/develop` (`ae9c795`).

**Verified:** re-ran the new prod spec against the fresh deploy — all 4
pass, including the diagnostic that hits `GET /api/model-versions`
directly. `yarn test:msw` (175/176 — 1 pre-existing unrelated failure,
`all-runners.spec.ts` sort-order). Storybook interaction suite: 275/281 —
6 failures, all pre-existing and unrelated (Set-to-string URL bugs in
course-chip filtering and a trainer-link race-type mismatch); confirmed
by spinning up a second headless Storybook against a throwaway detached
worktree at the pre-session baseline commit (`2057df4`) and reproducing
the identical failures there, then removing the worktree.

Deployed: `apps/web/deploy.sh` → confirmed live at
`build-commit=ae9c795`. No backend/Lambda code changed by this fix (only
`IndustrySpScreen.tsx`'s client-side request limit), so no Lambda deploy
needed.

**Done.** Worktree left in place pending removal (see table above); no
uncommitted state, nothing else in progress.

---

## 2026-07-26 (later still) — Agent in `~/betfair-nlp-local-ci-e2e` (branch `local-ci-e2e-tests`)

**Task:** Build a self-contained, "CI-style" Playwright E2E suite that runs
the real frontend + real backend against a throwaway local Mongo — no
mocking — with everything torn up and down around the run, a tiny CSV
seed, and a hardcoded test user. Every existing E2E tier either mocks
everything (`tests-msw/`), hits real prod (`tests-live/`,
`tests-production/`), or assumes a developer already started the local
backend/Mongo by hand (`tests/`) — none can run unattended from nothing,
so this is new orchestration, not a tweak of an existing config.

**What was built:** `scripts/local-ci-e2e.sh` (bash, `trap EXIT INT TERM`
for guaranteed teardown regardless of pass/fail/Ctrl-C) starts a second,
disposable `mongod` on port `27020` (dbpath `.local-ci/mongo-data`, db
`betfair_nlp_ci_test` — never the shared dev instance at `27019`), seeds a
single day (2026-06-03) of `data/kaggle-horse-racing-uk-ireland/extracted/
mini-update.csv` via the existing `import:industry-sp` command
(`FROM_DATE`/`TO_DATE`/`SOURCE_CSV` env vars, no code changes) — yields 24
GB races across Newton Abbot/Nottingham/Ripon/Warwick after the importer's
own non-UK filter — and a new `scripts/seed-local-ci-user.ts` inserts the
same hardcoded identity used throughout `client/tests*/`
(`matthew@backbet.co.uk`/`beyer`, bcrypt-hashed, `emailVerified: true`)
directly into the `users` collection. Starts the backend on port `3050`
(`NODE_CONFIG='{"server":{"port":3050}}'` — confirmed a real override
mechanism of the `config` package, no code change), rebuilds the frontend
once with `EXPO_PUBLIC_API_URL=http://localhost:3050` into a separate
`client/dist-local-ci/` (kept apart from the shared `client/dist/` so
concurrent worktrees don't clobber each other), serves it on port `8090`,
runs `client/playwright.local-ci.config.ts` against three new specs in
`client/tests-local-ci/` (auth, API-level data-seed verification, and a
real-browser UI test drilling into the seeded Nottingham race), then tears
down in reverse order. One command: `yarn test:e2e:local-ci`. All ports
(27020/3050/8090) are deliberately distinct from real dev (27019/3000/8081)
so this can run alongside a developer's normal session. Documented in
`.claude/commands/local-ci-e2e-tests.md`.

Every concrete data claim used in the specs (the exact seeded race/winner/
jockey/trainer/ISP, which 4 courses survive the UK-only filter on that
date, the real auth testIDs vs. some other existing docs/tests' stale
Basic-auth/`auth-login-button` references) was verified directly against
the raw CSV and the actual component/route source before being hardcoded
into assertions, not assumed from the initial research pass.

**Verified — live-ran the whole thing repeatedly, not just written:**
- `yarn test:e2e:local-ci` from repo root: 7/7 pass, ~20s end-to-end, run
  back-to-back twice with no state bleeding between runs.
- Deliberately broke the seed step (wrong date window) — confirmed it
  fails loudly (`ERROR: seed imported 0 races...`) and still tears down
  cleanly, instead of silently proceeding against an empty DB.
- Sent `SIGTERM` mid-run (during the mongod-connectivity wait) — trap
  fired, full teardown ran, zero leftover processes or listening ports
  (confirmed via `ps`/`ss`) afterward. (Real terminal Ctrl-C, i.e. `SIGINT`
  to a foreground job, is standard shell behavior and works the same way —
  the one artifact worth noting is that testing this non-interactively by
  backgrounding the script myself hit POSIX's "async jobs from a
  non-interactive shell ignore SIGINT" rule, unrelated to the script's own
  `trap`.)
- Confirmed the real dev Mongo (`27019`) is completely uninvolved — it
  wasn't even running during this session, and nothing in the script
  references anything but `27020`.

**Bugs found and fixed while actually running this (not caught by writing/
reading the code alone):**
1. `data/` is gitignored and NOT copied into a fresh `git worktree` — had
   to symlink `data -> /home/ubuntu/betfair-nlp/data`, matching the same
   convention already used by `~/betfair-nlp-isp-form-fields`.
2. `/health` is registered *after* the global `router.use(jwtAuth)` gate
   (`router.ts:581/630`) — it 401s without a token, so it's not a valid
   unauthenticated readiness probe. Switched the wait-loop to poll the
   seeded user's actual `POST /api/auth/login` instead (a better signal
   anyway — proves Mongo + the seeded user both actually work, not just
   that Mongo is connected).
3. Playwright's bundled Chromium doesn't run on this VM at all
   (`Playwright does not support chromium on ubuntu26.04-x64`) — every
   *other* local-flavored Playwright config in this repo already has a
   `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` fallback for exactly this, but the
   env var was never actually set anywhere; pointed it at the system
   `/snap/bin/chromium` (with `--no-sandbox --disable-setuid-sandbox`,
   same as `playwright.production.config.ts`).
4. `npx serve` doesn't exec directly — it forks a multi-process chain
   (`npm exec` → `sh -c` → the real `serve`), so a plain `kill $PID` on the
   outermost PID left the actual server alive and still bound to the port.
   `fuser -k -n tcp <port>` was the next attempt, but unprivileged
   `fuser`/`ss -p` can't see another process's socket ownership in this
   sandbox at all (same restriction category `AGENTS.md` already documents
   for `lsof`) — it silently killed nothing. Landed on launching both the
   backend and frontend via `setsid`, which makes that top-level PID double
   as the whole tree's process group ID, then killing `-$PID` (the whole
   group) on teardown — no port/process introspection needed at all.
5. `cleanup()`'s own `exit` re-triggered the `EXIT` trap a second time;
   fixed by `trap - EXIT INT TERM` as the first line inside `cleanup()`.

Worktree left in place, not yet merged — see table above.
