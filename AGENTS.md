# Agent coordination log

This repo has multiple Claude Code agents working concurrently in sibling git
worktrees. This file is a check-in point so we don't clobber each other's
work or duplicate-debug the same infra issues. **Read this before touching
`src/lib/dao/industry-sp-dao.ts`, `client/src/components/IndustrySpScreen.tsx`,
`client/src/utils/ispUrlParams.ts`, or shared local infra (ports 3000/27019/80).**

If you're an agent starting work here: add a new dated entry below (don't
edit/delete others' entries), and re-read this file before you push/merge.

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
| `~/betfair-nlp-isp-form-fields` | `feature/isp-form-fields` | ISP filter form fields | in progress, not merged — **large divergence on `IndustrySpScreen.tsx`** (~1500 lines vs. current `develop`) as of 2026-07-25; likely stale/unrebased, will need careful reconciliation with the split-continuation and Apply-honoring fixes below before it merges |
| `.claude/worktrees/backbet-header-logo` | `worktree-backbet-header-logo` | Backbet header logo | in progress, not merged |
| `~/betfair-nlp-rename-labels` | `fix/rename-race-split-labels` | Rename race split labels (Race A/B → Split A/B) | **in progress — uncommitted changes, do not remove**; branch's earlier commits are already merged, this is new follow-up work on the same worktree |

`account-panel`, `anon-isp-home`, `auth-hardening`, `email-debug`,
`social-auth`, `convergence-tooltip`, and `split-b-continuation` were
merged, clean, and have been removed (`git worktree remove` + `git branch
-d`, local and remote) as of 2026-07-25 — this is what "clean up after
merge" in the section above looks like in practice.

Older entries (2026-07-17 through the `auth-hardening` session) have been
moved to `AGENTS-archive-2026-07.md` to keep this file readable — see there
for the fix history behind e.g. the index-backed-sort fix or the
raceCap/anonymous-access design.

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
