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

## MSW Playwright suite (`yarn test:msw`): was hanging, now fixed (2026-07-26)

If you ever see an *old* `playwright test --config playwright.msw.config.ts`
process sitting there for a long time with zero output, **it wasn't running
slow tests — it had already finished and hung**. Root cause:
`client/playwright.msw.config.ts`'s `reporter: "html"` defaulted to
`open: "on-failure"`, and Playwright's own HTML reporter, when it opens,
does `await new Promise(() => {})` — the process never exited on its own
if *any* test failed. Real execution time for the whole 176-test suite is
only ~3 minutes on this VM's 2 CPU cores (Playwright's own default caps it
at 1 worker here regardless of `fullyParallel`) — everything after that
was just the report server sitting on port 9323 waiting for a `Ctrl-C`
that never came.

**Fixed**: `reporter` is now `[["list"], ["html", { open: "never" }]]` —
streams live progress and always exits on its own, pass or fail.
`test:msw` is also now wrapped in `timeout 300` as a permanent safety net
in case anything ever hangs again for a different reason. The one test
that was actually failing (`all-runners.spec.ts`'s "sort=asc is sent on
initial load") had a real bug: it did a second `page.goto()` mid-test
(re-bootstrapping the whole app — fonts, auth-restore, etc.) but only
asserted `all-runners-loading` was `not.toBeVisible()`, which passes
instantly for an element that doesn't exist *yet* — so the assertion
raced ahead of the real fetch. Fixed by waiting for `all-runners-screen`
to be visible first, matching the same sequencing `beforeEach` already
used correctly. (Also fixed a related `route.continue()`/`route.fallback()`
mixup in the same test, needed to let the request reach `fixtures.ts`'s
mock at all instead of hitting the real network.)

**Confirmed CPU-contention finding, not fixed (an environment fact, not a
bug)**: this VM has only 2 CPU cores. Running the MSW suite while another
agent's Playwright/Chromium run is *also* active concurrently (confirmed:
load average hit 7+ on this 2-core box during an overlap with
`~/betfair-nlp-convergence-filters` also running `tests-msw/
industry-sp.spec.ts`) causes real, non-flaky-looking test failures
(timeouts) purely from starvation — a full clean re-run immediately after
the other process finished passed 176/176 with no code changes in
between. If your `test:msw` run has unexpected failures, check
`ps aux | grep playwright` for another agent's concurrent run before
assuming your own changes broke something.

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
| `~/betfair-nlp-daily-races-filters` | `feat/daily-races-filters` | ISP-style filters on `DailyRacesScreen.tsx` (model win%, trainer form, field size, course/going/class/type/region chips, trainer/jockey search) + a new "Today's Picks" list. **Odds-badge history, resolved:** this branch originally added its own "minimum value odds" badge/utility (`dailyRaceFormat.ts`), duplicating a concurrent, unrelated worktree (`~/betfair-nlp-daily-race-fair-odds`) that was building the same idea on `DailyRaceScreen.tsx`. That other worktree ended up merging+deploying its version to `develop` first (`b01cacf`/`c1a4421` "Add fair-odds pill", `client/src/utils/oddsFormat.ts` — `fairDecimalOdds`/`toFractionalOdds`, snaps to the real UK bookmaker fractional-odds ladder) while this branch was still in progress — on merging `origin/develop` into this branch, kept their already-shipped `DailyRaceScreen.tsx`/`oddsFormat.ts` as-is (real conflict, resolved via `git checkout --theirs`) and switched Today's Picks' own odds badge to reuse `oddsFormat.ts` instead of the now-deleted `dailyRaceFormat.ts` odds functions — one consistent "Fair {fraction} ({decimal})" format app-wide, no duplicate math. **Also found+fixed while re-testing post-merge:** the newly-live 3rd pill (form+model+fair-odds) shifts the runner row's geometric center in a way that a coordinate-based click (Playwright's default `.click()` on the row's own testID) can land on the fair-odds pill's own `stopPropagation()` handler instead of the row — not a real production bug (a user tapping the horse name, the actual content, still navigates fine; only a literal-bounding-box-center click is affected), but it broke two **pre-existing** local-ci/MSW drill-down tests that used the row's testID as their click target. Fixed by retargeting those clicks to the horse-name testID (`daily-race-item-horse-{id}`) instead — no production code changed for this. **Gotcha for whoever runs `test:e2e:local-ci` from a freshly-created worktree:** `data/` and `ml/venv` are both gitignored and not brought over by `git worktree add` — symlink both from the primary checkout (`ln -s /home/ubuntu/betfair-nlp/data ./data`, same for `ml/venv`) before running, then remove the symlinks again before committing (they're untracked but not gitignore-matched as symlinks, so `git add -A` would pick them up). | **done** — merged `origin/develop`, resolved the odds-badge conflict, re-verified everything post-merge: build clean, Storybook (34/34 across the three touched story files), MSW (4/4), local-ci (29/29). Ready to merge to `develop` + deploy. |
| `/home/ubuntu/betfair-nlp` | `develop` | primary checkout | — |
| `~/betfair-nlp-deploy-develop` | `develop` (detached) | persistent — `/deploy-web` builds from here | keep |
| `~/betfair-nlp-deploy-main` | `main` (detached) | persistent — `/deploy-backbet` builds from here | keep |
| `~/betfair-nlp-isp-form-fields` | `feature/isp-form-fields` | ISP filter form fields | in progress, not merged — **large divergence on `IndustrySpScreen.tsx`** (~1500 lines vs. current `develop`) as of 2026-07-25; **`develop` just moved significantly (`fd3f394`) — Split A/B's runner-index machinery (`splitByRunners`, `fromRunnerA/toRunnerA/...`) was entirely removed and `IndustrySpScreen.tsx` heavily rewritten, see the dated entry below** — expect this branch's divergence to be much worse now, plan for a careful manual reconciliation, not a plain rebase |
| `.claude/worktrees/backbet-header-logo` | `worktree-backbet-header-logo` | Backbet header logo | **stale, do not merge as-is** — checked 2026-07-27: this branch diverges from `origin/develop` by ~29k deleted lines (missing saved-results, model-performance dashboard, social-auth, and more — branched from a very old point, not intentional deletions). Its only real uncommitted work is small (`LogoMark.tsx` + 2 SVG assets under `client/assets/logo/`, a FontAwesome-based logo mark, plus an `App.tsx` diff wiring it in) — worth salvaging by hand into a fresh worktree if the FontAwesome-icon logo direction is still wanted, but do not merge/rebase this branch wholesale. Superseded for the "consistent header" goal by `feat/unified-header` below (plain-text "BackBet" + sync-icon wordmark, not a FontAweome logo image) — pick this up only if the user wants the logo image, not the burger-menu-consistency problem, which is now solved. |
| `~/betfair-nlp-rename-labels` | `fix/rename-race-split-labels` | Rename race split labels (Race A/B → Split A/B) | **in progress — uncommitted changes, do not remove**; branch's earlier commits are already merged, this is new follow-up work on the same worktree; **also affected by the `fd3f394` rewrite of `IndustrySpScreen.tsx` above** — check for conflicts before merging |
| `~/betfair-nlp-saved-results` | `feat/saved-results` | New feature: save the current Industry SP filter set (name + filters + a static PnL/graph snapshot computed once via `IndustrySpService.getRaceConvergenceSeries`) as a persisted "Result", reachable via a new "Results" burger-menu item on every screen; list/sort/detail/restore-into-Filters/delete. First user-owned MongoDB resource in this codebase (new `saved_filter_sets` collection, scoped by JWT `sub`). New backend files (`saved-filter-set-dao.ts`/`-service.ts`, 4 routes in `router.ts`) plus new frontend screens (`SavedResultsListScreen.tsx`, `SavedResultDetailScreen.tsx`, `SaveResultDialog.tsx`) that reuse `SplitDetailPanel`/`PnlConvergencePanel` unmodified. **Touching `IndustrySpScreen.tsx`** (new Save button + nav-menu entry) — watch for conflicts with `isp-form-fields`/`rename-labels`/`convergence-filters` above (`model-perf-filters`, also listed here previously, has since merged+deployed and is no longer live). Full plan: `/home/ubuntu/.claude/plans/plan-an-advanced-feature-immutable-quilt.md`. | **done** — merged to `develop`, deployed (Lambda + web), live-verified on prod; worktree can be removed |
| `~/betfair-nlp-ai-training-battery` | `feat/ai-training-battery` | **Recovered from a session that died mid-task** (killed process, no `AGENTS.md` entry ever written — found via a Claude memory/session search, not a live agent). Task: after each XGBoost retrain, run the new model against a fixed, curated battery of filter combinations (not a replay of user data) and persist each as a `saved_filter_sets` result flagged `createdBy: "agent"` (an "AI Training" badge, no delete button) — extends `feat/saved-results` above rather than `model_evaluations`/`ModelPerformanceDashboard`. Plan: `/home/ubuntu/.claude/plans/sequential-cuddling-cerf.md`. **Done** — the recovered work already matched the plan file-for-file; audited, verified (full test suite + a real Python→HTTP→Mongo smoke test), merged (real conflict in `SavedResultsListScreen.stories.tsx` against `results-white-screen` below — both added new stories after the same point, kept both), pushed to `origin/develop` (`bc1be02`). See dated entry below. | **done** — merged, deployed (Lambda + web), live-verified; feature is inert until the user sets a real `TRAINING_PIPELINE_API_KEY`, see dated entry below; worktree can be removed |
| `~/betfair-nlp-results-white-screen` | `fix/results-white-screen` | Prod bug: clicking Results showed a blank white screen for a legacy (pre-Split-A/B) saved result — see dated entry below | done, verified, committing/deploying now |
| `~/betfair-nlp-results-filter-sort` | `feat/results-filter-sort` | Results screen (`SavedResultsListScreen.tsx`): add an icon to the existing "AI Training" badge, add a User/Agent source filter (All / Mine / AI Training), confirm date+PnL sort already works via the existing sort toggle. **Touches `SavedResultsListScreen.tsx`/`.stories.tsx`, `tests-msw/saved-results.spec.ts`, `tests-local-ci/saved-results-ui.spec.ts`** — watch for conflicts with any other worktree still touching that screen. | in progress |
| `~/betfair-nlp-live-perf-styling` | `fix/live-perf-styling` | UI polish follow-up to `feat/live-filter-performance-drilldown`/`fix/live-perf-return-nav` (see rows above): user asked for the Live Performance section's meeting-link tappable affordance to be less "horrible underlined" and more obvious another way, plus more row/grid divider lines so PnL numbers are easier to scan left-to-right — matching existing conventions elsewhere in the app rather than inventing new styling. Pure visual/styling change, `SavedResultDetailScreen.tsx` only. | **done — merged (`d55adfa`), deployed (web only), live-verified**: meeting label now bold `colors.accent`, no underline (same as `IspRacesScreen.tsx`'s `eventName` link style); `borderBottomWidth: 1, borderBottomColor: colors.border` added to every row level (year/month/day/meeting/race), same divider convention as `IspRacesScreen`/`IndustryMeetingScreen`/`IndustryRaceScreen`. Verified visually via a Storybook screenshot (`LivePerformancePopulated` story) before shipping — per the "skip full e2e for UI-only changes" convention, verification was build + screenshot + Storybook interaction tests only (20/20 pass), no full MSW/local-ci run needed for a pure style change. Worktree removed. |
| `~/betfair-nlp-result-detail-wide-cap` | `fix/result-detail-wide-cap` | User reported (screenshot at a wide desktop viewport) an issue on `SavedResultDetailScreen.tsx` (`/results/detail`); investigation found the reported "tooltip" is just the browser's own native back-button hover text (`Click to go back, hold to see history` — verified this string exists nowhere in the codebase or its history), not an app bug. The **real** wide-viewport bug: this screen never wraps its content in `PageContainer` (unlike every other screen — `/isp`, `/events`, `/runners`, etc.), so the Split A/B cards, Live Performance section, and the bottom Restore/Delete action bar all stretch edge-to-edge at wide widths instead of capping/centering (confirmed via a local MSW repro: `saved-result-split-card-a` measured 1975px wide at a 1999px viewport). Fix: wrap the `ScrollView` content and the `actionsRow` bottom bar each in their own `PageContainer`. **Also touched `SavedResultDetailScreen.tsx`** concurrently with `~/betfair-nlp-live-perf-styling` (row above) — merged cleanly (auto-merge, no conflict on this file; only this table's own row landed as a conflict, both entries kept), since that change only touched `liveMeetingLabel`/divider styles and this one only the outer wrapper/container level. **Also caught a pre-existing bug of my own while merging**: the legacy-result (pre-Split-A/B) branch's action bar still referenced the old full-bleed `styles.actionsRow` directly (position:absolute/background/border, which the fix moved onto a new `actionsBar` wrapper) — would have rendered inline with no background/border/fixed position for that one path. Fixed to use the same `actionsBar`+`PageContainer` wrapping as the main path. | **done — merged (`0ce536f`), deployed (web only). Not live-verified against the real, authenticated `/results/detail` page** — this route sits behind the login wall and this agent has no real account credentials; verified instead via the full local MSW suite (`saved-results.spec.ts`, 14/14 incl. 2 new wide-viewport tests) against the same built bundle that shipped, plus a real-browser screenshot of that bundle at 1999px showing Split A/B cards and the action bar both capped/centered exactly as intended. Worktree removed. |
| `~/betfair-nlp-live-perf-return-nav` | `fix/live-perf-return-nav` | Real prod bug, reported with screenshots: from `SavedResultDetailScreen.tsx`'s Live Performance section (see `feat/live-filter-performance-drilldown` above), tapping a meeting navigates to `IndustryMeetingScreen` (`/isp/meeting`), but pressing back there does not return to the Result page — went to a hardcoded fallback instead. Root cause: `onNavigateToMeeting`/`onNavigateToRace` never attached `buildReturnParams(route)` (unlike `onNavigateToRunner`, which already did), and `/isp/meeting`/`/isp/race`'s own `onBack` never consulted `resolveReturn`. **Second, subtler layer found while testing the fix**: `IndustryRaceScreen`'s own back button always jumps "up" to its meeting (unrelated, pre-existing, deliberate behavior — not something to change) — that hop must *forward* the race's own already-resolved return pointer rather than create a fresh one pointing back at the race itself, or one "back" tap from a race turns into a Race⇄Meeting loop that never reaches the Result page; caught by the second local-ci/MSW test case, not the first. | **done — merged (`af77c17`), deployed (web only, no backend changes), live-verified** — the prod-repro script (`live-perf-meeting-return-nav-2026-07-28.spec.ts`) failed against real prod before the fix (confirmed root cause: back landed on the Races list, "20/100 races" header, not the Result page) and passes against it after. New `tests-local-ci/live-performance-return-nav.spec.ts` (2 cases, real backend/DB — needed a new `src/commands/seed-live-filter-result-fixture.ts` since Live Performance rows are normally cron-written and local-ci doesn't run the cron) and `tests-msw/live-performance-return-nav.spec.ts` (2 cases) both pass, 28-29/29 `test:e2e:local-ci`, MSW suite unaffected in the areas this touches (full-suite runs show a few unrelated flakes under heavy concurrent-agent CPU contention this session — same documented pattern as the entry above and elsewhere in this file, confirmed by re-running the specific navigation/drill-down specs cleanly on their own). Worktree removed. |
| `~/betfair-nlp-header-wide-single-line` | `fix/header-wide-single-line` | User reported (screenshot of `app.backbet.co.uk/isp` at a wide browser window) that the header renders as two visual lines — "BackBet" brand row, then the nav/action buttons row below it (this is `AppHeader.tsx`'s always-two-rows design from `feat/unified-header`, chosen deliberately there for narrow phones — see that dated entry). At wide desktop widths there's ample room to fit brand + buttons on one line instead. **Touches `client/src/components/AppHeader.tsx`/`useHeaderMenu.ts`/`HeaderActionsContainer.tsx`** (the shared header every screen uses) — watch for conflicts with any other worktree touching those files. Plan: gate on the existing-but-previously-unused `BREAKPOINTS.wide` (1440px) — render the actions row inline inside `Appbar.Header` (same line as the brand) at `isWide`, keep the current stacked-below layout unchanged below that. Add MSW regression coverage at a wide viewport. | **done** — merged to `develop` (`ae3a27b`), deployed, live-verified; worktree can be removed |
| `~/betfair-nlp-live-filter-performance-drilldown` | `feat/live-filter-performance-drilldown` | Follow-up to the now-merged `feat/live-filter-performance` (see row above/history): user asked for the Live Performance section's meeting rows to be tappable, drilling into per-race breakdown the same way `IspRacesScreen.tsx`'s Races view already does. Changed `saved_filter_set_live_results` from one doc per (filter set, meeting, day) to one doc per (filter set, race) — `IndustrySpDAO.getQualifyingResultsByMeetingForDate` renamed to `getQualifyingRacesForDate`, grouping by race instead of meeting; meeting-level P&L is now a client-side sum over its races (same pattern `IspRacesScreen.tsx` already used). New `onNavigateToMeeting`/`onNavigateToRace` props on `SavedResultDetailScreen.tsx`, wired in `App.tsx` to the same `/isp/meeting`/`/isp/race` routes the Races view uses — runner-level drill-down from the race screen needed no changes at all. **Real production data question, asked and confirmed with the user**: 14 old-shape docs existed from this same feature's own first live run minutes earlier — user chose to delete them (low-stakes, would repopulate correctly the next cron run regardless) over a defensive frontend filter. **Touches `industry-sp-dao.ts` again** (still flagged hot). | **done — merged to `develop` (`123b529`, plus a tiny follow-up log-wording fix `41b38d1`), deployed (Lambda + web), live-verified**: backend/frontend build clean, Supertest 163/163, mongo integration test rewritten for per-race grouping (renamed to `industry-sp-dao-live-race-results.integration.test.ts`, 5/5 pass, added a same-meeting-two-races case the old per-meeting test never covered), Storybook 20/20 (3 new: meeting-link/race-row navigation, meeting-only collapse), `yarn test:e2e:local-ci` 28/29 (same single pre-existing unrelated failure). Deleted the 14 stale docs from production (user-approved) before deploying — self-healing `dropIndex`/`createIndex` in `LiveFilterResultDAO.createIndexes()` also handles the unique-key change for any future deploy. Live-verified via a synthetic `aws lambda invoke` post-deploy: real per-race docs confirmed in Mongo with `raceId`/`raceTime`/`raceName` populated (e.g. "Hkjc World Pool Lennox Stakes (Group 2)", Goodwood 28 July 2026). `app.backbet.co.uk`'s `build-commit` meta tag confirmed `41b38d1`. Worktree removed. |
| `~/betfair-nlp-live-filter-performance` | `feat/live-filter-performance` | New feature: live (not backtest) day-by-day/meeting P&L tracking for every saved filter, using RacingAPI's already-live `captureTodayResults()` results feed. Attaches `modelWinProbability`/`modelVersionId` onto live-captured `industry_starting_prices` runners (joined from `daily_racecards` by raw RacingAPI `race_id`/`horse_id` — currently missing, so "beats SP"/confidence filters can't match live-captured races today), computes per-day/per-meeting qualifying P&L via `IndustrySpDAO`'s existing `buildQualifyingRaceStages`, and persists it to a new `saved_filter_set_live_results` collection, chained onto the existing 21:30 UTC `capture-results` cron (no new EventBridge rule). New `GET /api/saved-filter-sets/:id/live-performance` + a "Live Performance" section on `SavedResultDetailScreen.tsx` (Year→Month→Day→Meeting rollup, reusing hierarchy logic extracted from `IspRacesScreen.tsx` into a new `client/src/utils/raceHierarchy.ts`). **Touches `industry-sp-dao.ts` and `IspRacesScreen.tsx`** — both flagged hot at the top of this file; watch for conflicts with any other worktree touching either. Full plan: `/home/ubuntu/.claude/plans/home-ubuntu-claude-uploads-6c1606e9-090-vectorized-toucan.md`. **Also moved `computeSnapshotParamsFromFilters` out of `router.ts`** (was private there) into `saved-filter-set-service.ts` (now exported) so both the route and the new live-capture service share one filters-map parser — `parseDateRangeParams`/`parseCsvListParam` extracted alongside it into a new `filter-params-util.ts`. **Real infra check before building**: confirmed via direct Mongo query that `industry_starting_prices` has zero live-captured rows for any date after the 2026-05-27 historical cutoff, and via `aws events`/`aws logs` (region `eu-north-1`, not the account's default `ap-southeast-2` — worth remembering next time) that the `industry-sp-results-capture-schedule` EventBridge rule is genuinely `ENABLED` with the correct target/permission, it just hadn't reached its first real 21:30 UTC firing yet since deploy — not a bug, no `source`/cutover-date field needed to distinguish live from historical data. | **done — merged `origin/develop` cleanly (fast-forward, no conflicts) mid-task, all verification re-run clean after**: backend `tsc --noEmit` clean, Supertest 163/163 (up from 159 — 4 new: 200+auth+two 404 cases for the new endpoint), 2 new mongo integration test files (8 new cases: `industry-sp-dao-live-meeting-results.integration.test.ts` for the new grouped-by-meeting query, extended `industry-sp-results-capture-service.test.ts` for the prediction-join), full `yarn build` clean, Storybook 17/17 on `SavedResultDetailScreen.stories.tsx` (5 new Live Performance stories — had to fix an MSW handler-ordering bug where a spread `...defaultHandlers` placed before an override handler silently won since MSW resolves first-match, not last), IspRacesScreen 29/30 (the 1 failure is pre-existing/unrelated — confirmed by running the identical spec against unmodified `develop` and seeing the same failure). `yarn test:e2e:local-ci` 28/29 both before and after this branch's changes (same single pre-existing `isp-races-ui.spec.ts` failure, confirmed not a regression) — needed a real `ml/venv` (not symlinked, the script explicitly rejects that) plus a `data/` symlink to run in this worktree at all. **Merged to `develop` (`796b1e1`), deployed (Lambda + web), live-verified with real production data** — `apps/lambda/build.sh`'s function-code deploy succeeded (bundle/upload/runtime-config/throttling all completed); its *optional* secrets-refresh sub-step then crashed on a pre-existing bug (`config/local.json` here is missing `openai`/`jwt` sections — the same "found wiped/partially-overwritten" issue the `email-debug` entry flagged earlier), but `set -e` aborted **before** the `aws lambda update-function-configuration` call, so the live Lambda's real env vars (including `JWT_SECRET`/`OPENAI_API_KEY`) were never touched/wiped — confirmed via a synthetic `aws lambda invoke` with `{"source":"aws.events","action":"capture-results"}` completing cleanly (200) right after. That synthetic invoke was the real end-to-end proof: CloudWatch logs showed `upserted 9 races (72 runners)` (today's first-ever non-zero live capture, 2026-07-28) immediately followed by `5 filter sets processed, 14 meeting rows upserted` — confirmed directly in Mongo, real `saved_filter_set_live_results` docs for real meetings (Beverley/Goodwood/Yarmouth, 28 July 2026) with real `pnlStats` and the real live `modelVersionId` (`xgb-20260727-171521`) attached. `apps/web/deploy.sh` completed cleanly; `app.backbet.co.uk`'s `build-commit` meta tag confirmed `796b1e1`. **Anyone hitting the same `config/local.json` crash again**: don't reconstruct `openai.apiKey`/`jwt.secret` from scratch into that file — fetch-merge-reapply from the live Lambda's actual config first (same rule as the email-debug entry), or just accept the code-only deploy like this one did, since the secrets step is separable and non-destructive when it fails via `set -e`. Worktree removed. |
| `.claude/worktrees/ml-prediction-api` | `worktree-ml-prediction-api` | Serve the win-probability model over an internal API instead of requiring a manual retrain/script run for predictions — new container-image Python Lambda (`apps/ml-api/`, no web framework, reuses `CAT_COLS`/`NUM_COLS`/`normalize_within_race` from `ml/train_and_predict.py` + the row-shaping logic from `ml/predict_daily_races.py`'s `load_daily_dataframe`), invoked via IAM `lambda:InvokeFunction` from the existing `hello-api` Node Lambda (no public Function URL), model artifact durable in a new S3 bucket + baked into the image at build time. New `src/lib/service/prediction-api-client.ts` (mirrors `racing-api-client.ts`), new `POST /api/daily-races/predict` route. **v1 was on-demand/manually-triggered only — since wired into the daily EventBridge cron, see the `wire-predictions-cron` row below.** Full plan: `/home/ubuntu/.claude/plans/go-to-racingapi-website-zesty-stearns.md`. See dated entry below for what was verified. | **done — merged (`d84ce7f`), pushed, deployed, live-verified**; worktree removed |
| `.claude/worktrees/wire-predictions-cron` | `worktree-wire-predictions-cron` | Chains feature-compute + predict onto the existing 06:00 UTC daily-races-ingest EventBridge rule (`handler.ts`'s default scheduled branch, no new rule) — closes the automation gap `ml-prediction-api` above was built to unblock. Predict/feature-compute failures are logged, not thrown (ingest already committed by that point; don't want EventBridge retrying the whole invocation). **Hit and fixed a real production timeout** — see dated entry below: `fetchTrainerOrJockeyHistory` fetched a trainer/jockey's entire career history (one real trainer had 4,220 historical race docs) instead of just the 14-day window it needed, and both feature-compute's historical lookups and predict's per-race Lambda invokes ran fully sequential. Fixed by pushing the date-window bound into the query and running both in concurrency-8 chunks with incremental writes (a timeout partway through no longer discards already-completed chunks). `apps/lambda/build.sh` timeout/memory bumped 30s/512MB → 300s/1536MB (only affects the scheduled/direct-invoke path, not API Gateway's own ~29s HTTP timeout). | **done — merged, deployed, live-verified**: a clean production run after the fix completed in ~16.5s total (down from timing out at the full 300s) — 42/42 races, 477/477 runners, 0 errors, confirmed in Mongo. Worktree removed. |
| `~/betfair-nlp-daily-races-model` | `daily-races-model` | Score today's Daily Races runners with the existing XGBoost win-probability model — new read-only feature-computation step (`daily-race-feature-service.ts`, queries `industry_starting_prices` but never writes to it) + new predict-only `ml/predict_daily_races.py` + a `Model {x}%` badge/detail row in the UI. Full plan: `/home/ubuntu/.claude/plans/go-to-racingapi-website-zesty-stearns.md` (file has since been overwritten with the follow-up `ml-prediction-api` plan below — see git history if you need the original). See dated entry below for what was verified. | **done — merged, deployed (Lambda `apps/lambda/build.sh` + web `apps/web/deploy.sh`, `develop@25a6aff` live on `app.backbet.co.uk`), live-verified**: retrained the model for real on the full 109,775-race prod dataset (AUC 0.707, `modelVersionId=xgb-20260727-171521` — the historical `industry_starting_prices` data itself is stale, stops 2026-05-27, so trailing trainer/jockey/horse form is near-empty for current dates; user explicitly chose to ship anyway, caveated), ran `compute-daily-race-features.ts` + `predict_daily_races.py` against real prod Mongo, confirmed all 52 of today's (2026-07-27) races have `modelWinProbability` summing to ~100% per race. Worktree removed. |
| `~/betfair-nlp-industry-sp-results-capture` | `feat/industry-sp-results-capture` | Closes the recency gap noted in the `daily-races-model` row above: `industry_starting_prices` stops at 2026-05-27, so today's runners have near-empty trailing form. Live-tested RacingAPI's Basic plan (now upgraded and confirmed live) — `/results/today` works with a fully verified real schema, but historical/dated `/results` queries 401 "Standard Plan required" (Basic can't backfill the past). User chose: capture forward daily instead of paying for another tier upgrade — new `IndustrySpResultsCaptureService.captureTodayResults()` (`src/lib/service/industry-sp-results-capture-service.ts`) pulls `/results/today` and upserts real, finished GB races into `industry_starting_prices` (never an unresolved race — same read-only invariant, now correctly complemented rather than violated). Shared row-mapping helpers extracted from `import-industry-sp.ts` into new `src/lib/dao/industry-sp-row-mapping.ts` so the CSV and RacingAPI paths can't drift. New second EventBridge rule (`scripts/setup-industry-sp-results-schedule.sh`, `.claude/commands/industry-sp-results-cron.md`) at **21:30 UTC** — not 23:00, see the dated entry below for why. 14-day trainer/jockey trailing window fully catches up ~2 weeks after this first runs; horse form improves incrementally from day one. Full plan: `/home/ubuntu/.claude/plans/cuddly-nibbling-quasar.md`. | **done — merged, deployed (2026-07-28, by a different concurrent agent session at the user's request), live-verified.** `apps/lambda/build.sh` + `scripts/setup-industry-sp-results-schedule.sh` both run for real — EventBridge rule `industry-sp-results-capture-schedule` confirmed `ENABLED` at `cron(30 21 * * ? *)` targeting `hello-api` with `{"action":"capture-results"}`. A synthetic `aws lambda invoke` with that exact payload at 08:33 UTC completed cleanly end-to-end (real Mongo, real RacingAPI call, no errors) — `upserted 0 races`, correctly expected since no UK races had finished yet at that hour; the schedule fires for real at 21:30 UTC, after racing finishes. **Not yet confirmed non-zero** — check `industry_starting_prices` for today's date after 21:30 UTC (or tomorrow) to close the loop on the one thing this row's earlier note flagged as unverified. **Heads up for whoever picks this worktree back up:** `config/local.json` in the primary checkout (`/home/ubuntu/betfair-nlp`) was found wiped/partially-overwritten mid-session while this deploy was happening — if that was this worktree's doing, note that `config/local.json` is per-checkout/gitignored, not something to copy or sync between worktrees; if it wasn't, something else touched it and is worth a look. Worktree removed (2026-07-28) — was left over after deploy, fully merged, nothing uncommitted. |
| `~/betfair-nlp-daily-race-pill-tooltips` | `feat/daily-race-pill-tooltips` | User asked what the green form-figures pill and Model % pill on `DailyRaceScreen.tsx` mean, then asked for tooltips on both. Tapping either pill now toggles a short inline explanation below it; the pill's own `TouchableOpacity` calls `stopPropagation` so tapping it doesn't also fire the row's navigate-to-runner-detail press. Left the (gray, not green) Draw badge alone — out of scope, wasn't one of the two pills asked about. | **done — merged, deployed (web only, `apps/web/deploy.sh`), live-verified**: `yarn build` clean, 10/10 Storybook interaction tests pass (2 new: `FormTooltipToggle`/`ModelTooltipToggle`, covering toggle-open/toggle-close and confirming `onNavigateToRunner` is NOT called when tapping a pill). Worktree removed. |
| `~/betfair-nlp-daily-race-tooltip-icon` | `feat/daily-race-tooltip-icon` | Follow-up to `daily-race-pill-tooltips` above — user asked for a small icon next to the form/model pills signalling a tooltip is available. Reused the exact existing "?" circular-badge pattern (`renderTooltipToggle`) already used identically in `ModelPerformanceDashboard.tsx`/`IndustrySpScreen.tsx`, rather than inventing a new affordance. Same `stopPropagation` treatment as the pills themselves, since this icon also lives inside the row's outer `TouchableOpacity`. | **done — merged, deployed (web only), live-verified**: `yarn build` clean, 12/12 Storybook stories pass (2 new: `FormTooltipToggleIcon`/`ModelTooltipToggleIcon`), visually confirmed via a Storybook screenshot before shipping. `develop@99b90db` live on `app.backbet.co.uk` (build-commit meta tag confirmed). Worktree removed. |
| `~/betfair-nlp-daily-race-fair-odds` | `feat/daily-race-fair-odds` | Follow-up to the two rows above — user asked to convert the Model % pill into implied fractional/decimal bookmaker odds so a punter can spot value (bet has positive expected value if a real bookmaker's price beats this). New `client/src/utils/oddsFormat.ts`: `fairDecimalOdds(pct) = 100/pct` (inverse of `ispFormat.ts`'s `impliedProbabilityPct`), `toFractionalOdds(decimalOdds)` snaps to the real UK fractional-odds ladder (Evens, 4/1, 9/4, etc.) rather than a bare GCD-reduced fraction — **caught during manual verification**: the first pass (brute-force min-error denominator search) produced unrecognizable fractions like "64/17" for 21% that no bookmaker would ever quote; fixed before committing. Confirmed `daily-race-dao.ts` has no live odds/price field on Daily Races runners at all, so this only ever shows the model's own implied price for the punter to compare against their actual bookmaker — not a live market comparison this app can make itself. New "Fair {fraction} ({decimal})" pill, same tap-to-reveal tooltip + "?" icon pattern as the other two pills. | **done — merged, deployed (web only), live-verified**: `yarn build` clean, 15/15 Storybook stories pass (5 new), visually confirmed via a Storybook screenshot before shipping. `develop@b01cacf` live on `app.backbet.co.uk` (build-commit meta tag confirmed). Worktree removed. |
| `~/betfair-nlp-daily-race-pill-wrap-fix` | `fix/daily-race-pill-wrap` | Real prod bug, reported with a phone screenshot: each pill (form/model/fair-odds) and its "?" tooltip icon were separate flex children of the same `flexWrap` row, so the icon could wrap onto its own orphaned line, split from the pill it belonged to. Fixed by wrapping each pill+icon pair in a single `View` (`styles.pillGroup`) instead of a bare Fragment, so `flexWrap` only ever breaks between groups now, never inside one. Pure layout refactor, no behavior change. | **done — merged, deployed (web only), live-verified**: `yarn build` clean, all 15 pre-existing Storybook stories still pass unchanged, confirmed the fix visually via a narrow-viewport screenshot (pill+icon now wrap together). `develop@c92f66d` live on `app.backbet.co.uk` (build-commit meta tag confirmed). Worktree removed. |
| `~/betfair-nlp-daily-race-model-factors` | `daily-race-model-factors` | User asked whether the Model % pill can "explain itself" — follow-up to the three rows above. Adds a plain-language "top factors" list (top 3, e.g. "Strong recent form", "In-form trainer") to the existing Model % tooltip on `DailyRaceScreen.tsx`, computed via XGBoost's native `pred_contribs=True` (exact SHAP values, no new Python dependency) in `apps/ml-api/handler.py`, restricted to the 22 `NUM_COLS` (skips the 8 `CAT_COLS` identity columns — no clean "helped/hurt" phrasing for those). Threads a new `topFactors`/`modelTopFactors` field through `prediction-api-client.ts` → `daily-race-service.ts` → `daily-race-dao.ts` → `chatApi.ts` → the tooltip. Scoped to the live Daily Race pipeline only — historical ISP screens (`RunnerDetailScreen`, `IndustryRaceScreen`, `IndustrySpScreen`, `IndustryMeetingScreen`) use a separate write path and are out of scope. Plan: `/home/ubuntu/.claude/plans/atomic-purring-puffin.md`. | **done — merged (`85d203b`), deployed (ml-api Lambda + `hello-api` + web), live-verified**: prototyped `pred_contribs` against the CI-fixture model first (contributions reconstruct the exact margin score, diff ~2e-7); `apps/ml-api/test_handler.py` 13/13 pass; backend `tsc --noEmit` clean, Supertest `app.test.ts` daily-races block 14/14 pass; `yarn build` clean; Storybook 16/16 pass; MSW suite 195/195 pass after 3 successive `origin/develop` merges (this repo is very active — several concurrent branches landed mid-task). **Merging `fix/daily-race-pill-wrap`'s `pillGroup` change surfaced a real regression**: giving `hrs_1` (the runner the shared drill-down test clicks by its whole-row testID) Model/Fair-odds badges shifted the row's real-browser click point onto a nested pill (`onPress` calls `stopPropagation`), silently breaking navigation 3/3 on repeat — Storybook's `NavigationTriggered` story still passed throughout since Testing Library's `userEvent.click` doesn't do real coordinate hit-testing, confirming this is specific to genuine browser clicks. A later concurrent merge (`daily-races-filters`, adding the Today's Picks feature) independently fixed the same collision by clicking the horse-name testID instead of the row — adopted that version and moved the model/factors fixture data onto `hrs_1` (which that branch already gives a `modelWinProbability`) rather than inventing a second fix. **Heads-up for anyone touching `DailyRaceScreen.tsx`'s row tap target**: worth double-checking the horse-name click fix if this file changes again — a runner with all three badges can still have its row-tap swallowed if the click lands elsewhere. Reverted an unrelated, unexplained root `yarn.lock` rewrite `npm install` produced in this fresh worktree. `ml-prediction-api` rebuilt with the existing model (`xgb-20260727-171521`, no retraining needed — `topFactors` is computed from the already-trained booster) and live-invoked directly post-deploy, confirming real `topFactors` output; `hello-api` verified healthy (401 on unauthenticated `/api/stats`, not a crash); web verified live at `develop@85d203b` (`build-commit` meta tag). **Not yet re-verified in the actual app UI against fresh prod data** — today's `daily_racecards` were scored by the old handler before this deploy, so they won't carry `modelTopFactors` until the next 06:00 UTC cron run (or a manual trigger, see `.claude/commands/daily-races-cron.md`) refreshes them. Worktree can be removed. |
`account-panel`, `anon-isp-home`, `auth-hardening`, `email-debug`,
`social-auth`, `convergence-tooltip`, `split-b-continuation`,
`split-ab-race-revert`, `header-overlap-fix`, `codebase-search-chat`,
`local-ci-e2e-tests`, `model-perf-filters`, `convergence-filters-summary`,
`saved-results-splits`, `daily-races`, and `daily-races-cron` were merged,
clean, and have been removed (`git worktree remove` + `git branch -d`,
local and remote where applicable) as of 2026-07-25/27 — this is what
"clean up after merge" in the section above looks like in practice.
`codebase-search-chat` was merged, pushed, and deployed (both Lambda and
web). `local-ci-e2e-tests` was docs/test-infra only (no
`src/`/`client/src/` changes), so no deploy was needed — merged to
`develop` and pushed straight through. `daily-races` (new RacingAPI-backed
Daily Races feature + general-purpose worktree port-allocation skill, full
plan: `/home/ubuntu/.claude/plans/go-to-racingapi-website-zesty-stearns.md`)
was merged, deployed (Lambda `b215c78`-era code + web `develop@ca87d75`),
and live-verified against production
(`client/tests-live/daily-races-live.spec.ts` passes against the real
deployed app — burger menu → Daily Races screen loads with no error
state). `daily-races-cron` (AWS EventBridge → the existing `hello-api`
Lambda, daily at 06:00 UTC, not a VM crontab — user's explicit choice; see
`.claude/commands/daily-races-cron.md`) was merged, and the Lambda code +
EventBridge rule/target/permission were deployed via `build.sh` +
`scripts/setup-daily-races-schedule.sh`. The `RACINGAPI_USERNAME`/`PASSWORD`
Lambda secrets needed a manual fetch-merge-reapply (auto-mode classifier
blocked the agent from reading/writing the Lambda's existing secrets even
after the user said "grant permission this once" in-conversation — that
approval doesn't change the actual permission-system gate; the user ran
the `aws lambda update-function-configuration` merge themselves via `!`).
Live-verified: manual `aws lambda invoke` with a synthetic
`{"source":"aws.events"}` payload succeeded, `GET /api/daily-races`
against prod returned 52 real races, and the live Playwright spec passed
against the real deployed app afterward.

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

---

## 2026-07-26 (later still) — Agent in `~/betfair-nlp-saved-results` (branch `feat/saved-results`)

**Task:** New feature — save the current Industry SP filter set as a named,
persisted "Result" (filters + a static PnL/graph snapshot, computed once at
save time and never recomputed), a new "Results" burger-menu item on every
screen opening a sortable list, a detail view with tap-through to the full
graph, and restore-into-Filters + delete. First real use of the new
`local-ci-e2e-tests` skill for a brand-new feature (as opposed to a bug fix)
— followed its "run repeatedly as you go" guidance throughout.

**Backend** (`src/lib/dao/saved-filter-set-dao.ts`, `src/lib/service/
saved-filter-set-service.ts`, 4 new routes in `router.ts` after
`router.use(jwtAuth)`): new `saved_filter_sets` collection — the **first
user-owned MongoDB resource in this codebase**; every DAO method takes and
filters by `userId` (JWT `sub`), with no "get any doc by id" method at all,
so cross-user leakage can't happen even if a route forgot an ownership
check. Save-time snapshot reuses `IndustrySpService.getRaceConvergenceSeries`
directly (already returns exactly the `{raceRowNumber, cumulativeStaked,
cumulativeReturns, cumulativePnl, roiPercent}[]` shape needed) rather than
adding new DAO aggregation — `pnlStats` is just its last point.

**Frontend**: `SaveResultDialog.tsx` (name prompt, wired into
`IndustrySpScreen`'s Apply flow — Save re-applies the draft filters first,
then reads `window.location.search` once `syncUrl` has written it, same
technique `App.tsx`'s `onViewRaces` already uses), `SavedResultsListScreen.
tsx` (responsive card grid, sort toggle, inline delete-confirm, SVG
sparkline per card), `SavedResultDetailScreen.tsx` (reuses `SplitDetailPanel`
and `PnlConvergencePanel` **unmodified** — the latter already takes `points`
as a plain prop rather than fetching internally, so a static saved snapshot
and the live convergence chart are just two different callers of the same
component). New `/results` and `/results/detail` routes; `onNavigateToResults`
threaded through all 4 screens (`EventsScreen`/`ChatScreen`/
`AllRunnersScreen`/`IndustrySpScreen`).

**Gotcha hit and fixed:** `SplitDetailPanel` is a full-screen `position:
"absolute"` overlay by design (zIndex 100) — reusing it directly inside a
plain scroll view buried the detail screen's own Restore/Delete/Graph
buttons behind it. Fixed with a second, higher-zIndex absolutely-positioned
bottom action bar rather than modifying the shared component.

**Testing — new primary tier used as intended:** wrote `client/tests-local-ci/
saved-results-{ui,api}.spec.ts` (11 tests) and ran `yarn test:e2e:local-ci`
repeatedly while building each piece, exactly as the skill recommends. The
API tier cross-checks a saved snapshot's `pnlStats`/`graphPoints` against a
**live** `GET /api/industry-sp/race-convergence` call with the same filters
(both routes share identical param-clamping logic) rather than hardcoding
magic numbers — more robust than guessing exact PnL figures for the seeded
slice. Final run: **18/18 passed** (7 pre-existing + 11 new), clean
teardown. Also added the Supertest block (`app.test.ts`, 14 tests incl.
cross-user 404 checks), the DAO integration test (6 tests, throwaway DB),
Storybook stories for all 3 new components plus nav-click stories on the 4
wired screens, `client/tests/saved-results-e2e.spec.ts` (traditional tier),
and MSW mocks/spec (`tests-msw/fixtures.ts` + `saved-results.spec.ts` +
a 375px `responsive.spec.ts` addition).

**Two tiers deliberately not exercised, both for reasons unrelated to this
feature:**
- `client/tests/saved-results-e2e.spec.ts` — the shared dev Mongo on this
  VM (`localhost:27019`, db `betfair_nlp_dev`) currently has 30 seeded races
  but **zero seeded users** — `matthew@backbet.co.uk` (the standing test
  identity every `client/tests/*` spec assumes exists) is missing. Not
  something this session caused or fixed; noted here for whoever next needs
  that tier working. The spec file itself is written and ready.
- `client/tests-msw/` — hit a live port collision on 3737 with a concurrent
  agent's own MSW run (`~/betfair-nlp-convergence-filters`), exactly the
  failure mode `AGENTS.md` already warns about for fixed test ports. User
  explicitly said to bail rather than fight for the port. Mocks/spec file
  are written (`tests-msw/fixtures.ts`'s `setupApiMocks` now backs
  `/api/saved-filter-sets` with a stateful in-memory fixture); just never
  run this session.

**Also discovered:** the shared local `mongod` on port 27019 was down
twice during this session (once before starting, once mid-session — likely
killed as a side effect of `local-ci-e2e.sh`'s stale-pid-kill step, though
not confirmed) — restarted both times with the standard `--port 27019
--bind_ip 127.0.0.1 --dbpath /home/ubuntu/mongo-data-27019 --fork` command
from the top-of-file infra note. Worth another agent investigating whether
`local-ci-e2e.sh`'s cleanup is somehow too broad.

**Gitignore gotcha:** `data/` in `.gitignore` (trailing slash) does **not**
match a `data` symlink pointing at a directory — only a real directory.
`git check-ignore data` confirmed it's untracked-but-not-ignored in this
worktree, so `git add -A`/`git add .` would have tried to commit the
symlink itself (a broken, non-portable path on any other machine). Staged
files explicitly instead. Worth fixing properly (e.g. `data` without the
trailing slash, or excluding symlinks some other way) if this keeps biting
every new worktree that symlinks it in for `local-ci-e2e-tests`.

**Verified:** `yarn build` (client) clean; full backend `npx jest` — same 6
pre-existing failing suites/42 failures as the pre-session baseline (all
unrelated to this feature — no `saved-filter-set`/`router.ts`/`IndustrySpScreen`
involvement in any of them); `app.test.ts` + the new DAO integration test
145/152 (7 skipped, unrelated) and 6/6 respectively, both fully green;
`yarn storybook:test-runner` — 303 passed, 6 pre-existing failures
(confirmed identical to the ones already root-caused and baseline-verified
earlier this session in the `model-perf-e2e` entry above — Set-to-string
URL bugs in course-chip filtering, `AllRunnersScreen`, `EventBadgesVisible`,
a `RunnerDetailScreen` trainer-link race-type mismatch — none touch this
feature's files); final `yarn test:e2e:local-ci` — 18/18.

**Merged and pushed to `origin/develop`** (`git push origin
feat/saved-results:develop`, landed as `b1696f9`) — one real conflict along
the way, in `IndustrySpScreen.tsx`'s import block against the concurrently-
merged `model-perf-filters` (both added a new import line; combined, kept
both). Re-verified after the merge: `yarn build` clean, backend Supertest +
DAO test still green, `yarn test:e2e:local-ci` 18/18.

**Deployed** — `apps/lambda/build.sh` (new `/api/saved-filter-sets` routes
confirmed live via a direct authenticated `curl`) and `apps/web/deploy.sh`
(confirmed live at `build-commit=a7d185b` on `app.backbet.co.uk`, one
commit past this feature — an unrelated docs-only chore that landed on
`develop` in between). Live smoke test against production: `POST` a real
result (Ascot, 2026-01-01, real ISP-derived PnL), `GET` list showed
`count: 1`, `DELETE` cleaned it up — full cycle against real prod data and
prod Mongo, then removed so no test noise is left in the live account.
Worktree left in place.

---

## 2026-07-26 (later still) — Agent in `~/betfair-nlp-model-perf-filters` (branch `model-perf-filters`)

**Task:** User (non-technical, reading the Model Performance dashboard on
their phone at app.backbet.co.uk) noticed the "Without model"/"With model"
P&L cards didn't seem to respond to the filter panel (Race Class, Race
Type, date range, trainer, jockey), and separately that the date range
picker defaulted to Jan 2015 even though this model's real held-out test
period (`runMeta.testDateMin`) is 2024+. Confirmed real bug via an Explore
subagent read of the code (not user report alone).

**Root cause:** `loadRacesForModelVersion()` in `IndustrySpScreen.tsx`
fetched a single, hardcoded batch — `fromRow=1, sort=asc,
limit=MODEL_PERFORMANCE_RACE_LIMIT(500)`, no date bound — scoped only by
`modelVersionId`. That's the *earliest* 500 races that version ever scored
(back near the start of the whole dataset), never refetched on
Apply/Reset. `ModelPerformanceDashboard.tsx`'s Apply/date-range/Reset
controls then only re-filtered that same static, wrongly-scoped batch
client-side — so no filter combination could ever reach the model's real
2024+ test period, and the date picker's own default range (derived from
`computeDateBounds(races)`) was silently describing that accidental slice
rather than genuine dataset bounds.

**Fix:**
- `ModelPerformanceDashboard` now takes an `onApplyFilters(filters)` prop
  and a `defaultMinDate` prop (the selected version's own
  `runMeta.testDateMin`). Apply, the date-range picker's own confirm step,
  and Reset all call `onApplyFilters` instead of re-filtering `races`
  client-side.
- `IndustrySpScreen.loadRacesForModelVersion()` now accepts a
  `ModelPerformanceFilters` object and passes `minDate/maxDate/countries/
  courses/goings/raceClasses/raceTypes/trainer/jockey` straight through to
  `chatApi.getIndustrySp` (all already-supported query params —
  `MODEL_PERFORMANCE_RACE_LIMIT` itself untouched, still 500, see the
  `model-perf-e2e` entry above for why). Initial load and version-switch
  both default `minDate` to that version's `runMeta.testDateMin`.
- Chip filter menus (Country/Course/Going/Race Class/Race Type) now source
  their option lists from the same whole-dataset `available*` arrays the
  main Industry SP filter panel already fetches, instead of being derived
  from `races` — since `races` is now server-filtered, deriving chip
  options from it would make picking one value in a category silently
  erase the sibling values from that same category's menu.
- `minModelWinProbability` deliberately stayed client-side-only (not sent
  to the server) — "without model" and "with model" need the *same*
  underlying race pool to compare against, so narrowing server-side would
  break the comparison. Trainer/jockey substring trimming also stayed
  client-side (`pnlRaces`), since the server's `$elemMatch` only confirms
  a race *has* a matching runner without dropping its other runners.
- Calendar bounds (`CALENDAR_MIN_DATE`/`todayYmd()`) are now fixed
  constants instead of derived from the currently-loaded (now filtered)
  `races` — previously the picker's own min/max silently shrank to
  whatever was already loaded, which would have made picking a *wider*
  date range impossible once server-side filtering landed.

**Storybook fixture gotcha:** the mock race generator originally anchored
all races to a fixed `2026-01-01 + up to 200 days`. Once the calendar's
real upper bound became `todayYmd()` (actual wall-clock date), and
`LATEST`'s fixture `testDateMin` (2026-07-06) was only ~20 days before
today at the time this ran, the wide 200-day spread let generated races
land past "today" and get silently excluded the instant Apply/Reset
re-sent `today` as `maxDate` — breaking
`RaisingMinModelWinProbabilityChangesWithModelPnlOnly` and
`ResetClearsFiltersAndRestoresBaselinePnl` (both expect the "without
model" baseline to stay stable across an unrelated filter change). Fixed
by anchoring each version's mock races to *its own* `runMeta.testDateMin`
(14-day spread, comfortably inside the gap to real "today" both now and
increasingly so as real time moves forward) instead of a fixed calendar
date — also more realistic, since a model's real scored races should all
fall at-or-after its own test period start anyway.

**Verified:** `yarn build` clean (only pre-existing, unrelated
`jsonwebtoken` type-decl error in `tests-live/chat-live.spec.ts` — confirmed
present on baseline `develop` too, via `git stash`). Full Storybook
interaction suite: 275/281 pass — the 6 failures are the same pre-existing,
unrelated ones already documented above (AllRunnersScreen/EventsScreen
Set-to-string course-chip bugs, RunnerDetailScreen trainer-link race-type
mismatch); all 39 `ModelPerformanceDashboard` stories pass, including the
two fixed by the fixture change above. Ran Storybook on port 6011 (6007
was already held by a stray `betfair-nlp-model-perf-e2e` process — didn't
touch it, per the port-collision guidance at the top of this file).

**Done — committed (`307f105`), merged `origin/develop` in twice along the
way (once pre-push for a `local-ci-e2e-tests` merge, once more for a
rejected non-fast-forward push after a `saved-results` AGENTS.md commit
landed in between), pushed straight to `origin/develop`
(`git push origin model-perf-filters:develop`, landed as `7f71568`), and
deployed via `apps/web/deploy.sh` — confirmed live at
`build-commit=7f71568` on app.backbet.co.uk. No backend/Lambda change (the
fix only changes what query params the existing client-side call sends),
so no Lambda deploy needed. Worktree removed (`git worktree remove` +
`git branch -d`, local and remote branch — see table above).**

---

## 2026-07-26 — Agent in `~/betfair-nlp-convergence-filters` (branch `feat/convergence-filters-summary`)

**Task:** User reported (screenshot of `app.backbet.co.uk`'s P&L
Convergence graph) that there was no way to tell which filters (date
range, course, model thresholds, etc.) produced the result set being
viewed — the graph screen only ever showed race counts and ROI%, with the
actual filter state living implicitly in `IndustrySpScreen.tsx`'s own
component state and never passed down.

**Fix:** `IndustrySpScreen.tsx` gained a `buildConvergenceFilterSummary()`
helper (mirrors the existing "only include what differs from
`FILTER_DEFAULTS`" convention already used for URL query params) and a new
`convergenceFilters` state, captured at the moment `loadConvergence` is
called — so it can't drift out of sync with a filter the user edits after
opening the graph but hasn't re-Applied yet. `PnlConvergencePanel.tsx`
gained a `filters: {key,label}[]` prop, rendered as a chip row right below
the header (visible in every state — loading/error/empty/data) —
`pnl-convergence-filters-summary` container,
`pnl-convergence-filter-chip-{key}` per chip, or
`pnl-convergence-no-filters` when the array is empty (the default range,
nothing narrowed).

**Node_modules note for whoever creates a worktree next:** this worktree
had no `node_modules` at all on creation (no shared symlink existed here,
unlike what the `social-auth` entry's aside implied) — symlinked both
`node_modules` (root) and `client/node_modules` from the primary checkout
rather than a full `yarn install`, since no dependency changed. Fine for a
docs/frontend-only change; don't do this if you're adding a new package
(see the `social-auth` entry's `yarn.lock` warning).

**MSW test-writing gotcha:** the new MSW Playwright test initially clicked
`industry-sp-course-Cheltenham` before ever pressing Apply once — failed
with the chip simply not existing yet ("Apply to load options" placeholder
still showing). Course/going/class/type chip *options* only populate from
a `/splits` response's own arrays, so a fresh `/isp` load needs one
filter-less Apply first to load the chip list before a chip can be
clicked, then a second Apply to actually commit the selection — same
two-step shape already used by the existing "Apply commits a pending
course chip..." test elsewhere in this file, just not obvious from a fresh
`page.goto` in a different `describe` block without that block's own
`beforeEach`.

**MSW suite hang note:** hit the `playwright.msw.config.ts` HTML-reporter
hang-on-failure documented earlier in this file firsthand (a run with a
real failing test just sat there with zero output for 5 minutes).
Worked around it with `--reporter=line` on the CLI rather than waiting for
the fix in progress elsewhere — sidesteps the hang without needing that
fix to land first, and doesn't touch the config file itself so there's
nothing to conflict with.

**`saved-results` merge integration fix:** `origin/develop` moved again
mid-task and brought in the `feat/saved-results` merge (`b1696f9`), whose
`SavedResultDetailScreen.tsx` also renders `PnlConvergencePanel` — with no
`filters` prop, now required. Rather than papering over it with
`filters={[]}` (which would have shown a false "No filters applied" on a
screen whose entire point is a saved, filtered result), added
`buildFilterSummaryFromParams()` to `client/src/utils/ispFormat.ts` — same
chip-label output as `IndustrySpScreen`'s own
`buildConvergenceFilterSummary()`, but built from `SavedFilterSet.filters`
(the raw `ISP_FILTER_PARAM_NAMES` URL-param string map already stored per
saved result) instead of live component state. Wired into
`SavedResultDetailScreen.tsx` and covered by a new assertion on
`ViewGraphOpensPnlConvergencePanel` in its Storybook stories.

**MSW suite hang note:** hit the `playwright.msw.config.ts` HTML-reporter
hang-on-failure documented earlier in this file firsthand (a run with a
real failing test just sat there with zero output for 5 minutes). Worked
around it with `--reporter=line` on the CLI while the real fix (`af88d46`)
was still in progress elsewhere; once it landed and was merged in here,
switched back to the plain `yarn test:msw` for the final verification pass
below — confirmed it now exits cleanly instead of hanging.

**Verified (final, after merging `origin/develop` three times across the
task — `local-ci-e2e-tests`/`model-perf-filters`, then `feat/saved-results`,
then the `af88d46` MSW-hang fix — all clean merges, no conflicts outside
`AGENTS.md` itself):** `yarn build` clean. Storybook full suite: same 4
pre-existing failing files documented throughout this file
(`IndustrySpScreen`/`AllRunnersScreen`/`EventsScreen`/`RunnerDetailScreen`,
6 individual failures) — `PnlConvergencePanel.stories.tsx` 18/18 and
`SavedResultDetailScreen.stories.tsx` all pass, including the new/extended
assertions. `yarn test:msw` (the now-fixed official script): 185/186 —
the 1 failure (`responsive.spec.ts` "result cards stack in a single column
... at iPhone 12 mini") is **pre-existing and unrelated**, confirmed by
running the identical test against a throwaway worktree on a clean
`origin/develop` (before this branch's changes) and getting the exact same
failure (`box2.y` received `76`, expected `>=355`) — a `feat/saved-results`
responsive-layout bug, not touched by anything in this task.

**Done — committed (`8f882ce`, `fd7cd22`), merged to `develop` (pushed
directly as `48dbf84`), deployed via `apps/web/deploy.sh` — confirmed live
at `build-commit=48dbf84` on app.backbet.co.uk. No backend/Lambda change
(frontend-only). Worktree removed (`git worktree remove` + `git branch
-d`) — nothing left in progress.**

---

## 2026-07-27 — Agent in `~/betfair-nlp-unified-header` (branch `feat/unified-header`)

**Task:** User asked that every view use exactly the same burger menu (same
items) and the same "BackBet" logo/icon/header bar. Audited all 13 screens
first (see below) — found real inconsistency: 5 screens had their own
copy of the burger-menu logic instead of sharing `useHeaderMenu`/
`HeaderActionsContainer`, `IndustrySpScreen` had a fully hand-rolled
duplicate (`navMenuOpen`), 6 "back-only" detail screens had zero burger
menu at all, and `SavedResultDetailScreen` had no header whatsoever.
Titles varied screen to screen ("Events", "Chat Assistant", a race/
runner/trainer name) instead of the BackBet brand.

**Also found and abandoned:** `.claude/worktrees/backbet-header-logo`
(listed above as "in progress") turned out to be badly stale — diverges
from `origin/develop` by ~29k deleted lines (missing `feat/saved-results`,
the model-performance dashboard, social-auth, and more — branched from a
very old point, not intentional deletions). Did not touch or merge it;
flagged in the Active Worktrees row above for whoever wants to salvage
its actual new work (a `LogoMark.tsx` FontAwesome-icon logo, uncommitted)
by hand into a fresh branch.

**Fix:** new `client/src/components/AppHeader.tsx` — one component every
screen now renders, owning the "BackBet" + sync-icon title, the burger
menu (still built on the existing `useHeaderMenu`/`HeaderActionsContainer`
pair, not reinvented), a self-contained Account panel
(`chatApi.getMe()`), and an `extraActions` render-prop slot for each
screen's own buttons (Filters/Model Performance toggle, sort toggles,
Export, etc — these kept their original testIDs). The menu's item set is
now identical everywhere: Industry SP / Chat / Events / Runners, then
Account + Results + Log Out (authenticated) or Log In + Sign Up
(anonymous, `/isp` family only). Screens now take `navigate` directly
instead of individual `onNavigateToX` callback props, which shrank
`App.tsx`'s per-route wiring substantially. `AuthScreen.tsx` deliberately
left untouched — it's a pre-login form, not a navigable view, and already
shows the same "BackBet" text.

**Real bug found and fixed along the way, affecting every screen already
in production before this task:** `Appbar.Content`'s `subtitle` prop is
MD2-only in react-native-paper (`{!isV3 && subtitle ? ... : null}` in
`AppbarContent.tsx`) — silently no-ops under this app's `MD3LightTheme`.
Every screen's runner/race counts, meeting names, etc. passed via
`subtitle` had **never actually rendered**, before or after this task's
changes (confirmed by inspecting the rendered DOM directly — the
subtitle `<Text>` was never in the tree at all). `AppHeader` now renders
the subtitle as a second line inside its own custom `title` node instead
of relying on that dead prop — this is a real, if minor, visible fix, not
a side effect of the refactor.

**Two real regressions found and fixed during verification (not
pre-existing):**
1. Two Storybook mobile-viewport stories (`AllRunnersScreen`/
   `EventsScreen` `MobileHeaderButtonsVisible`, `MobileExportModalFitsViewport`,
   `RendersAtIphone12`) had been "fixed" by a test-updating pass to open the
   burger menu first — but Storybook's `viewport` parameter only resizes
   the iframe's CSS box, not the real window `useResponsive()` reads
   from, so `isTablet` stays true regardless and the burger button never
   renders at any Storybook viewport. Reverted those steps back to
   asserting the buttons are inline (matching every other viewport story
   in these files, and matching `origin/develop`'s original versions).
2. `AllRunnersScreen.stories.tsx`'s `ScreenLoaded` still asserted on two
   separate texts ("All Runners" and the counts) that used to come from
   separate Appbar title/subtitle props — now one combined subtitle
   string. Updated the assertion.

**Confirmed pre-existing, unrelated, left alone (already documented
multiple times earlier in this file):** `IndustrySpScreen`'s 2 course-chip
Set-to-string URL bugs, `EventsScreen`'s `EventBadgesVisible` (asserts a
`event-price-updates-badge` testID that doesn't exist in the component at
all), `RunnerDetailScreen`'s `TrainerLinkCallsOnNavigateToTrainer`
(mock race type "Chase" → "Jumps", but the test still asserts "Flat" —
present verbatim, unchanged, on `origin/develop` too). One test —
`responsive.spec.ts`'s "result cards stack in a single column" — was
independently fixed by another session (`d097314`, landed on `develop`
mid-task) for the exact same root cause I'd separately diagnosed
(fixture sort-order assumption, not a real layout bug); merged cleanly,
kept both fixes' intent.

**Worktree gotchas hit, matching this file's existing warnings:** this
worktree needed its own `node_modules`/`client/node_modules` symlinks
(`ln -s` to the primary checkout, same as every worktree here) *and* a
`data` symlink too — `yarn test:e2e:local-ci`'s CSV-seed step failed with
`ENOENT` on `data/kaggle-horse-racing-uk-ireland/...` until that was
added. `data` shows as untracked in `git status` despite being gitignored
(`data/` pattern doesn't match a symlink named `data` without a trailing
slash) — same already-documented gotcha as `node_modules`; used `git add
-u` plus explicitly naming new files rather than `git add -A`/`.` to
avoid ever staging it.

**Verified:** `yarn build` clean. Storybook full suite: 308/313 (5
pre-existing failures above, confirmed unrelated). `yarn test:msw`:
186/186. Backend Supertest (`app.test.ts`, unaffected — no backend files
touched): 139/146 (7 skipped, pre-existing). `yarn test:e2e:local-ci`:
18/18, including a dedicated "Results is reachable from every screen's
nav" check.

**Done — committed (`96549ba`), merged `origin/develop` (`d49238f`,
one trivial comment-only conflict in `responsive.spec.ts` against the
independent `d097314` fix), pushed directly to `develop`, deployed via
`apps/web/deploy.sh` — confirmed live at `build-commit=d49238f` on
app.backbet.co.uk, and spot-checked with a real headless-browser hit
against `/isp` showing the full BackBet header + burger menu rendering
correctly in production. No backend/Lambda change (frontend-only).**

---

## 2026-07-27 (later) — Agent in `~/betfair-nlp-remove-stats-bar` (branch `fix/remove-redundant-stats-bar`)

**Task:** User screenshotted `app.backbet.co.uk`'s live `/events` view and
pointed out a thin "N runners · N races · Industry SP →" bar sitting
above the new `AppHeader` — asked to remove it and check every other
screen for the same issue. Checked all 13 screens' JSX directly
(everything before the first `<AppHeader` in each `return`) —
`EventsScreen.tsx` was the only one with anything stacked above it; a
leftover from before the header-unification task above, never cleaned up
since its two links (Runners, Industry SP →) duplicate items already in
`AppHeader`'s burger menu.

**Fix:** removed the bar's JSX, the `stats`/`setStats` state and its
`chatApi.getStats()` call (only consumer), the now-redundant
`onNavigateToIsp` prop, and the dead `statsBar`/`statText`/
`statLinkText`/`statDot` styles. Updated the one Storybook story and 6
MSW/e2e test files that referenced the removed testIDs
(`events-stats-bar`/`events-total-runners`/`events-total-races`/
`events-nav-isp`) to use the burger-menu equivalents
(`events-menu-runners-link`/`events-menu-isp-link`) instead — same nav
outcome, just through the shared menu now. Left `EventGroupsPanel.tsx`
alone despite it having an *identical* stats-bar implementation with the
same testIDs — confirmed via grep it's not imported/rendered anywhere in
the app, dead code unrelated to what the user saw live.

**Verified:** `yarn build` clean. Storybook: 308/313 (same 5
pre-existing failures as every entry above, confirmed unaffected).
`yarn test:msw`: 185/185 (186 minus the one test that covered the
now-removed feature). `yarn test:e2e:local-ci`: 18/18.

**Done — committed (`3455866`), pushed directly to `develop`, deployed
via `apps/web/deploy.sh` — confirmed live at `build-commit=3455866` on
app.backbet.co.uk. Could not live-verify the actual `/events` DOM itself
(it's behind the login wall and this session has no real credentials) —
relied on Storybook + MSW instead, both of which exercise this exact
component's real code with mocked auth, which is the same code now
deployed. Worktree removed, branch deleted (local + remote via the
`push origin ...:develop` above) — nothing left in progress.**

---

## 2026-07-27 — Agent in `~/betfair-nlp-saved-results-splits` (branch `fix/saved-results-splits`)

**Task:** User reported (three screenshots) that a saved Result's detail
view showed one combined "All races" card (10000 races, +£349.62), while
the live `/isp` Filters screen it was saved from always shows two
independent Split A/Split B cards (races 1–337: -£74.93; races 338–675:
-£78.99) — genuinely different numbers, not just a different label. The
saved snapshot was silently discarding the split entirely.

**Root cause:** `SavedFilterSetService.saveResult` never read
`fromRowA/toRowA/fromRowB/toRowB` from the saved filters at all — it called
`IndustrySpService.getRaceConvergenceSeries` exactly once, hardcoded to
`fromRow=1, toRow=10000` (`SAVE_SNAPSHOT_MAX_ROWS`), i.e. always "every
matched race, combined." `computeSnapshotParamsFromFilters` in
`router.ts` didn't even parse the split params out of the filters map.

**Fix — full split-aware snapshot, threaded end to end:**
- `saved-filter-set-dao.ts`: `SavedFilterSetDocument` now stores `splitA`/
  `splitB` (each `{fromRow, toRow, total, totalRunners, pnlStats,
  graphPoints}`), replacing the flat top-level `pnlStats`/`graphPoints`.
- `saved-filter-set-service.ts`: `saveResult` now calls
  `IndustrySpService.getSplitStats` first (the *exact* resolver the live
  `/api/industry-sp/splits` route already uses — explicit boundaries if the
  user had edited the split boxes, the default half/half divide otherwise),
  then `getRaceConvergenceSeries` twice, once per resolved split's own
  range, in parallel.
- `router.ts`: `computeSnapshotParamsFromFilters` now parses
  `fromRowA/toRowA/fromRowB/toRowB` the same way `/api/industry-sp/splits`
  already does (omitted → `null` → default divide).
- `chatApi.ts`: `SavedFilterSet.splitA`/`splitB` replace `pnlStats`/
  `graphPoints`.
- `SavedResultDetailScreen.tsx`: completely rebuilt — two `SplitCard`s
  (mirroring `IndustrySpScreen`'s own `renderSplitCard` styling/labels
  exactly, "as close as possible to the live Filters view" per the ask),
  each with its own **Details** button (opens the existing
  `SplitDetailPanel`, unmodified) and **Graph** button (opens
  `PnlConvergencePanel` with that split's own `graphPoints`). Removed the
  old single always-visible `SplitDetailPanel` + one "View full graph"
  button.
- `SavedResultsListScreen.tsx`: the list card still shows one headline
  number (a list of many results has no room for two cards each) — now an
  explicit `combinedPnlStats()` sum of both splits, not a stray leftover
  field. Sparkline preview uses Split A's own `graphPoints` only — Split
  A/B are two *independent* cumulative series each restarting at their own
  first race; concatenating them would show a discontinuous jump right at
  the boundary, which reads as a rendering bug.

**Test-writing gotchas worth recording:**
- The new MSW test initially clicked a course chip before ever pressing
  Apply once — failed because chip *options* only populate from a
  `/splits` response's own arrays (see the `pnl-convergence-filters-summary`
  entry above for the identical gotcha) — needed one filter-less Apply
  first to load the chip list, then a second Apply to commit it.
- The new `saved-results-api.spec.ts` (real backend + seeded Mongo)
  assertion `expect(data.splitA.pnlStats.count).toBe(referenceA.length)`
  failed for real (`Expected: 3, Received: 32`) — turned out to be a test
  bug, not a service bug: `pnlStats.count` is **horses backed** (a runner
  sum, `$sum: "$inRangeRunnersCount"` in `industry-sp-dao.ts`), the same
  field `SplitDetailPanel`'s "Horses backed" row already shows — not the
  race count, which is `graphPoints.length` instead. Fixed the assertion
  rather than the service; **anyone touching split `pnlStats.count` again,
  it's runners, not races.**
- `saved-results-ui.spec.ts` (same real-backend suite) still asserted
  `split-detail-panel-a`/`saved-result-detail-view-graph` — the old
  always-visible-panel testIDs, gone now that Details/Graph are per-split
  buttons behind a tap. Updated to the new flow.
- Ran the real `yarn test:e2e:local-ci` suite twice from this worktree —
  first pass caught both bugs above; **do not double-background a
  long-running suite** (`cmd > log 2>&1 & ; echo done` inside a single
  `run_in_background: true` Bash call detaches the real process from the
  tool's own completion tracking — the tool reports "done" immediately
  while the suite keeps running unmonitored). Second run used a plain
  foregrounded `timeout 240 yarn test:e2e:local-ci` inside one
  `run_in_background` call instead, which tracked correctly.
- This worktree had neither `node_modules` (symlinked from the primary
  checkout, no dependency changes) nor the gitignored `data/` seed CSV
  needed by `yarn test:e2e:local-ci` — symlinked
  `data/kaggle-horse-racing-uk-ireland` from the primary checkout too.
  Needed for anyone else running that suite from a fresh worktree.

**Verified:** `yarn build` (both `src/` and `client/`) clean throughout.
Supertest `app.test.ts`: 139/146 (7 pre-existing skips, unaffected).
`saved-filter-set-dao.integration.test.ts` (real local Mongo): 6/6.
Storybook: `SavedResultDetailScreen.stories.tsx` and
`SavedResultsListScreen.stories.tsx` both fully pass; full suite otherwise
309/314 — same 5 pre-existing failures documented throughout this file.
`yarn test:msw`: 187/187, including all 9 `saved-results.spec.ts` tests
(3 new/rewritten for the split UI). `yarn test:e2e:local-ci` (real
backend + real throwaway Mongo, no mocking): 18/18 on the second run,
after fixing the two real bugs the first run caught.

**Done — committed (`ff8d867`), pushed directly to `develop`, deployed both
web (`apps/web/deploy.sh`, confirmed live at `build-commit=ff8d867` on
app.backbet.co.uk) and Lambda (`apps/lambda/build.sh` from
`~/betfair-nlp-deploy-develop`, confirmed responding post-deploy via the
public `/api/industry-sp/filter-bounds` endpoint) — no gap where frontend
and backend disagreed on the API shape.**

**Data-migration note, flagged to the user rather than acted on
unilaterally:** this is a breaking schema change for any `saved_filter_sets`
document saved *before* this fix (old shape: flat `pnlStats`/`graphPoints`;
new shape: `splitA`/`splitB`) — the user's own screenshots showed 2
pre-existing saved results ("All races", "Foo") that would now fail to
render (`result.splitA` undefined) until migrated or replaced. Attempted to
check the real production `saved_filter_sets` collection directly (via
`aws lambda get-function-configuration` to read `MONGODB_URI`, read-only,
to connect) — **blocked by this session's auto-mode permission
classifier**, which explicitly instructs stopping and asking rather than
finding a workaround. Asked the user directly rather than routing around
it or deploying a silent migration; **user chose to just delete both old
results from the Results list and re-save fresh ones** (they looked like
throwaway test saves) rather than a migration script. No migration code
was written — nothing to pick up here unless the user reports it wasn't
enough.

Worktree removed, branch deleted (local + remote via the
`push origin ...:develop` above) — nothing left in progress.

---

## 2026-07-27 (later) — Agent in `~/betfair-nlp-results-white-screen` (branch `fix/results-white-screen`)

**Task:** User reported clicking "Results" on prod showed a blank white
screen — the exact production-data risk flagged (but left to the user to
resolve manually) at the end of the `saved-results-splits` entry above.

**Root cause, confirmed twice — locally via MSW, then against the real
deployed bundle:** `SavedResultsListScreen.combinedPnlStats()` read
`result.splitA.pnlStats`/`result.splitB.pnlStats` with no guard. Any
`saved_filter_sets` document created before the Split A/B schema change has
neither field at all (the old shape stored one flat `pnlStats`/
`graphPoints` instead) — nothing migrates old documents on deploy, and the
user's own 2 pre-existing saved results were exactly this shape. Reading
`.pnlStats` off `undefined` threw mid-render; **this app has no error
boundary anywhere** (confirmed via grep), so React unmounted the entire
tree instead of just the one bad card — a blank white screen, not a caught
error, exactly as reported.

**New skill added: `.claude/commands/prod-repro-scripts.md`** — a new
category of test script, distinct from every existing one (`tests-msw`/
Storybook = repeatable CI-style regression, `tests-live` = repeatable
live-environment regression, `tests-local-ci` = repeatable throwaway-stack
regression). A prod-repro script is **run once**, points at the real
deployed `app.backbet.co.uk` (never localhost, never a fresh local build),
and exists purely to prove a specific reported bug is present in the
bundle that's live *right now* — kept afterward as a historical record,
not maintained or re-run routinely. New
`client/playwright.prod-repro.config.ts` (baseURL = prod, no `webServer`
block — nothing to start, the target is already live) and
`client/scripts/prod-repro/results-white-screen-2026-07-27.spec.ts`, which
reproduced this exact bug against production via `page.route()`
interception (no real credentials or data touched — a locally-set fake
JWT plus a mocked `/api/saved-filter-sets` response was enough to prove
the *deployed* code crashes on a legacy-shaped doc). Ran before any fix
landed and failed exactly as expected
(`getByTestId('saved-results-screen')` → `<element(s) not found>` after
loading resolved) — that failure is the confirmation this bug is real in
prod, not just in theory.

**Fix:** `chatApi.ts`'s `SavedFilterSet.splitA`/`splitB` are now optional
(honestly reflecting that a real API response can lack them, not a
"just in case" guard). `SavedResultsListScreen.tsx` gained
`isLegacyResult()` — a legacy doc now renders a degraded, delete-only card
("Saved before this app's Split A/B update — delete and re-save to see it
here") instead of crashing, and normal results next to it are unaffected.
`SavedResultDetailScreen.tsx` got the equivalent guard for direct
navigation to a legacy result's URL. No backend touched at all — this was
purely a frontend robustness gap.

**Test-writing gotcha:** the first version of the permanent MSW regression
test asserted `saved-results-screen` visible immediately after `page.goto()`
— trivially passed on the loading spinner, before the fetch resolves and
the crash (or, post-fix, the degraded card) would actually render. Had to
wait for `saved-results-loading` to clear first, **then** re-check the
screen was still there — same lesson as the temp repro script, worth
remembering for any test asserting "the page didn't crash."

**Verified:** `yarn build` clean. Storybook:
`SavedResultsListScreen.stories.tsx`/`SavedResultDetailScreen.stories.tsx`
both fully pass (2 new legacy-doc stories); full suite otherwise 311/316 —
same 5 pre-existing failures documented throughout this file. `yarn
test:msw`: 190/190, including 3 new regression tests in
`saved-results.spec.ts` (degraded card + delete, mixed legacy/normal
results, direct-navigation to a legacy detail URL).

**Done — committed (`c7e91c6`), pushed directly to `develop`, deployed via
`apps/web/deploy.sh` (frontend-only, no Lambda change) — confirmed live at
`build-commit=c7e91c6` on app.backbet.co.uk. Re-ran
`client/scripts/prod-repro/results-white-screen-2026-07-27.spec.ts`
against the now-live site (`playwright.prod-repro.config.ts`, real
`app.backbet.co.uk`, same interception as before) — passes, closing the
loop the skill describes: the same script that proved the bug was live
now proves the fix is live too. Worktree removed, branch deleted (local +
remote via the `push origin ...:develop` above) — nothing left in
progress.**

---

## 2026-07-27 (later) — Agent in `~/betfair-nlp-ai-training-battery` (branch `feat/ai-training-battery`), recovering a dead session's work

**Task:** the user reported losing an agent mid-task and asked me to find
it. Searched `AGENTS.md` (no entry — the session died before it could
write one) and `git worktree list`, found this worktree already existed
on branch `feat/ai-training-battery` with substantial uncommitted changes
but no feature commit yet. Found the actual plan via a memory/session
search — grepped `~/.claude/plans/*.md` for related keywords and matched
`sequential-cuddling-cerf.md` ("AI Training Battery Results"), then
identified the source session itself (`3f832020-b93a-4c4d-9d18-a3d32764e8b1`,
named "training results" via `custom-title`/`agent-name` records in its
own transcript) by grepping `~/.claude/projects/-home-ubuntu-betfair-nlp/*.jsonl`
for the plan filename — its transcript ends on a bare `Exit code 144` tool
result with no further turns, confirming a hard kill, not a normal
completion.

**Task, per the recovered plan:** after each XGBoost retrain, run the new
model against a fixed, curated battery of filter combinations (not a
replay of any user's own saved filters) and persist each as a
`saved_filter_sets` result flagged `createdBy: "agent"`, extending
`feat/saved-results` (merged/deployed earlier — see above) rather than
`model_evaluations`/`ModelPerformanceDashboard`.

**Audit before touching anything:** read every file in the existing diff
against the plan section-by-section (DAO, service, router, config,
`chatApi.ts`, `SavedResultsListScreen.tsx`, `ml/train_and_predict.py`, and
all 4 planned test tiers — DAO integration, Supertest, Storybook, ML
`unittest`). Found it already matched the plan closely and correctly,
including already being built on top of `feat/saved-results-splits`'s
Split A/B schema (merged after the session died, so the recovered work
correctly used `splitA`/`splitB`, not the older flat `pnlStats`/
`graphPoints` shape) — nothing needed rewriting, only verifying.

**Verified, nothing missing:**
- `yarn build` (client) clean.
- Full backend `npx jest`: same 6 pre-existing failing suites / 42
  failures as this session's established baseline (`runner-price-updates`,
  `market-definition-dao`, `betfair-service`, `simple`,
  `openai-integration`, `price-update-dao` — none touch this feature).
  New coverage (DAO cross-userId listing/back-compat/hit-miss, Supertest
  401/400/201/cross-user-visibility/non-deletability) all green.
- `ml/venv/bin/python -m unittest test_features` (run from `ml/`, not via
  `pytest` — this venv has no `pytest` module installed) — 14/14,
  including the 3 new `build_agent_result_name`/`FILTER_BATTERY` tests.
- `yarn storybook:test-runner` (port 6009, checked `ps aux | grep
  storybook` first, nothing running): same pre-existing failures as this
  session's own earlier baseline (course-chip Set-serialization,
  `AllRunnersScreen`, `EventBadgesVisible`, `RunnerDetailScreen`
  trainer-link) — `AgentBadgeShown`/`AgentResultHasNoDeleteButton` both
  pass.
- **Real manual smoke test** (plan's step 6): stood up a fully throwaway
  stack — `mongod` on port 27021, seeded the standard one-day CSV slice
  (25 races) via `import:industry-sp`, started the real Node server on
  port 3060 with `TRAINING_PIPELINE_API_KEY` set via env, then called the
  **actual Python `run_filter_battery()`** (not a re-implementation)
  against it with `API_BASE_URL` pointed at that server. All 6 battery
  entries POSTed successfully; queried Mongo directly and confirmed 7
  agent docs (6 from the real run + 1 from an earlier direct-`curl` check)
  with correctly *different* Split A/B counts per filter (e.g. "All races"
  99/94 runners vs. "Favourites" 10/9 vs. "Small fields" 49/50) — proving
  real filter application end-to-end, not identical/cached results. Tore
  down the throwaway `mongod`/server afterward; left an unrelated orphaned
  `ts-node` process (pid 63003, started 09:58:55 — almost certainly a
  leftover from the dead session itself) untouched rather than guessing at
  its state.

**Merge:** `origin/develop` had moved 9 commits (notably
`fix/results-white-screen`, landed after the session died — fixed a real
prod bug where a legacy pre-Split-A/B saved result crashed the whole
Results list). One real conflict, in
`SavedResultsListScreen.stories.tsx` — both branches added new stories
right after the same `DeleteButtonRemovesItemAfterConfirm` story (mine:
`AgentBadgeShown`/`AgentResultHasNoDeleteButton`; theirs:
`LegacyResultWithoutSplitsShowsDegradedCard`), resolved by keeping both.
`SavedResultsListScreen.tsx` itself auto-merged cleanly — the agent-badge
logic and the legacy-card guard don't touch the same lines. Re-verified
after merging: `yarn build` clean, full `jest` still the same 42
pre-existing failures (now 349 passed, up from 339 — the 10 new tests
from `results-white-screen` merging in cleanly alongside this feature's
own).

**Gitignore gotcha (same one hit in the `saved-results` session above):**
`ml/venv/` and `data/` in `.gitignore` don't match the symlinks this
worktree already had for both (`ml/venv -> .../betfair-nlp/ml/venv`,
`data -> .../betfair-nlp/data`) — `git add -A` would have tried to commit
both. Staged files explicitly instead.

**Merged and pushed to `origin/develop`** (`git push origin
feat/ai-training-battery:develop`, landed as `bc1be02`, on top of the
`daily-races`/`results-white-screen`/`prod-repro-scripts`/`worktree-ports`
work that landed mid-session) — re-verified after the final merge: `yarn
build` clean, full backend `jest` still the same 42 pre-existing failures.

**Deployed** — merged one more incoming commit first (`daily-races-cron`,
clean, no conflicts), then `apps/lambda/build.sh` (confirmed live: `POST
/api/saved-filter-sets/agent` with no key → `401`, correctly failing
closed) and `apps/web/deploy.sh` (confirmed live at
`build-commit=436be59` on `app.backbet.co.uk`). Regression check against
real prod: `GET /api/saved-filter-sets` for the real logged-in user still
returns `200`/`success:true` (0 results, as expected — nothing to break).

**`TRAINING_PIPELINE_API_KEY` now set on the live Lambda** — per the
user's explicit request, generated a random 32-byte hex key
(`openssl rand -hex 32`), set it via `aws lambda
update-function-configuration` directly (**not** `apps/lambda/build.sh`'s
`config/local.json` path — that script's secrets branch replaces the
*entire* `Environment.Variables` map from a hardcoded list that doesn't
even include this key, so using it here would have silently dropped it
right back to empty on the next deploy that went through it; worth fixing
in `build.sh` itself at some point). Instead: fetched the Lambda's current
full env-var map read-only via `get-function-configuration`, merged in
just the new key locally, wrote the merged map back — every existing
secret (Mongo/JWT/OpenAI/Resend/RacingAPI) preserved untouched, confirmed
via a real login (`200`) immediately after. Verified the new key
authenticates (`201`), a wrong key still 401s, cleaned up the verification
doc directly from prod Mongo by `_id` (agent results aren't deletable via
the API by design, per the plan). Deleted the local temp files holding the
full merged env-var map (all secrets) right after the AWS call.

**Not recorded in this file or anywhere in git** — the raw key value was
only ever shown to the user directly in chat and briefly held in this
session's scratchpad (`/tmp/claude-.../scratchpad/`, not part of the
repo). Whoever runs `ml/train_and_predict.py` going forward needs that
same value passed as `TRAINING_PIPELINE_API_KEY` in its environment —
ask the user for it (they were given it directly) rather than regenerating
a new one, which would silently desync from what's on the Lambda.

---

## 2026-07-27 — Agent in `~/betfair-nlp-daily-races-model` (branch `daily-races-model`)

**Task:** Score today's Daily Races runners with the existing XGBoost
win-probability model. Full plan:
`/home/ubuntu/.claude/plans/go-to-racingapi-website-zesty-stearns.md`.

**Critical constraint, held throughout:** `industry_starting_prices` (the
real historical training collection) is read-only for this whole feature
— every runner in an unresolved today's-race would get `label=0` (no
`status: WINNER` yet), silently corrupting the next real retrain. New
`daily-race-feature-service.ts` issues targeted read-only queries against
it and writes computed features only onto `daily_racecards`. Mechanically
verified, not just code-reviewed: `scripts/live-verify-daily-race-features.ts`
fingerprints (count + sha256 of a 500-doc sample) `industry_starting_prices`
before/after a real run against real dev Mongo and asserts no change.

**RacingAPI Basic plan:** despite the user reporting an upgrade,
`/v1/racecards/basic` and `/v1/results/today` still returned 401 "Basic
Plan required" as of this session (confirmed via
`scripts/live-verify-daily-races-basic.ts` against the real API) — auth
itself works fine, Free-tier `/racecards/free` succeeds. Implementation
proceeded anyway on Free-tier data (endpoint path is config-driven,
`racingApi.racecardsPath`/`RACINGAPI_RACECARDS_PATH`, so flipping to Basic
later needs zero code change). **Worth the user checking on their end —
the upgrade doesn't appear to be live.**

**Built:** new `ml/predict_daily_races.py` (predict-only, no retraining —
loads the saved model + a new sidecar `win_probability_model_categories.json`
that `train_and_predict.py` now also persists, needed so prediction-time
pandas category codes line up with what XGBoost's saved splits were
trained on) + `Model {x}%` badge on `DailyRaceScreen` and a "Model Win %"
detail row on `DailyRunnerDetailScreen`. A committed CI-fixture model
(`ml/fixtures/win_probability_model.ci-fixture.json`, real training run
on the CSV slice + a hand-crafted overlap fixture, 46 estimators, AUC
0.62) keeps `local-ci-e2e.sh` fast/deterministic — no real training run
in the test hot path.

**Verified:**
- `npx tsc --noEmit -p .` / `cd client && yarn build` clean.
- 15 new Jest unit tests (`daily-race-feature-service.test.ts`) pass,
  including an explicit 14-day trailing-window boundary test.
- Full `scripts/local-ci-e2e.sh`: 28/28 Playwright tests pass, both in
  the worktree and again in the primary checkout after merge — new
  assertions cover real (fixture-derived) non-null `modelWinProbability`
  in range, per-race sums ≈100, and exact trailing-form values matching
  the hand-computed overlap fixture.
- All three manual live-verification scripts (`live:verify-daily-races`)
  run for real against real dev Mongo + real RacingAPI + the real
  production-trained model: script 1 correctly detects Basic is still not
  live; script 2 proves the read-only guarantee via before/after
  fingerprint; script 3 scored 52 real today's-races with 0 out-of-range
  probabilities, 0 bad race sums, 69% favorite-plausibility. Cleaned up
  the one test artifact this left in shared dev Mongo (a `model_evaluations`
  doc `ci-fixture-model-v1`) afterward; left the real `daily_racecards`
  data in place.

**Merged and pushed to `origin/develop`** (`git merge --no-ff
daily-races-model`, clean, no conflicts — commit `5402fe6` merged in as
part of the fast-forward push to `743a30b`). Re-verified in the primary
checkout post-merge: `tsc`/`yarn build` clean, full `local-ci-e2e.sh`
28/28 again.

**Not deployed** — per the plan's explicit "Non-goals" section, wiring
the Python feature-compute + prediction steps into the production
EventBridge/Lambda cron is out of scope (Python/XGBoost can't run in that
Node.js Lambda runtime; a follow-up plan would need to pick a Python
compute target). The TypeScript/frontend changes (new display fields,
model badge) are additive and harmless to deploy with no data behind
them — asked the user whether to deploy those and/or run the pipeline
manually against production Mongo now that the code is merged. Worktree
kept (not removed) pending that decision.

---

## 2026-07-27 (later) — Agent in `.claude/worktrees/ml-prediction-api` (branch `worktree-ml-prediction-api`)

**Task:** the daily-races-model work above required a manual local
retrain to get usable predictions — a trained model from the day before
(`xgb-20260726-110115`) was unrecoverable since `ml/models/` is
gitignored and machine-local. User asked: serve the model over an API
instead. Full plan (overwrote the completed daily-races-model plan in
the same plan file — see git history for the original):
`/home/ubuntu/.claude/plans/go-to-racingapi-website-zesty-stearns.md`.

**Built:** container-image Python Lambda `ml-prediction-api` (`apps/ml-api/`)
serving the already-trained model — no MongoDB access, no web framework,
just a bare `handler(event, context)` reusing `CAT_COLS`/`NUM_COLS`/
`normalize_within_race` from `ml/train_and_predict.py` + the row-shaping/
ROI-derivation logic from `ml/predict_daily_races.py`'s
`load_daily_dataframe`. Invoked only via IAM `lambda:InvokeFunction` from
`hello-api` (new `invoke-ml-prediction-api` policy on the shared
`lambda-basic-exec` role) — never a public Function URL or API Gateway
route. Model durability: new `upload_model_to_s3()` step in
`train_and_predict.py` (env-var guarded, same pattern as
`run_filter_battery()`), new S3 bucket `betfair-nlp-ml-models`, baked into
the image at build time by `apps/ml-api/build.sh` rather than downloaded
at cold start (reproducible deploys — `Code.ImageUri` unambiguously
answers "which model is live"). New `src/lib/service/prediction-api-client.ts`
(mirrors `racing-api-client.ts`, `InvokeCommand` instead of `fetch`) +
`DailyRaceService.predictDailyRaces()` + `POST /api/daily-races/predict` —
**v1 is on-demand/manually-triggered only**, per the user's explicit
choice, not wired into the existing EventBridge daily cron.

**Infra gotchas hit, worth knowing about:**
- **No Docker was installed on this VM** — had to `sudo apt-get install
  docker.io` + `sudo usermod -aG docker ubuntu` (group membership needs a
  fresh shell/session or `sg docker -c "..."` to take effect without one —
  used the latter throughout this session).
- **A failed `npm install`/`yarn add -W` attempt broke the *shared*
  `node_modules/.bin`** in the primary checkout (`npm warn reify Removing
  non-directory node_modules` — npm unlinked the worktree's symlink to
  primary's real `node_modules`, wrote the new package through to the real
  target directory, then errored on an unrelated `vite`-nested `esbuild`
  postinstall version mismatch before rebuilding `.bin`). This affected
  **every worktree symlinking to primary's `node_modules`**, not just this
  one. Fixed by hand — a small Node script scanning every installed
  package's `package.json` `bin` field and relinking `node_modules/.bin`
  directly, skipping npm/yarn's install machinery (and its lifecycle
  scripts) entirely. **If you hit `npx tsc`/`npx <anything>` mysteriously
  failing repo-wide, check `ls node_modules/.bin | wc -l` before assuming
  it's your own change** — it may already be broken from an earlier
  session's install attempt in a sibling worktree.
- **`~/betfair-nlp-deploy-develop` (and presumably `~/betfair-nlp-deploy-main`)
  has its own real, separately-installed `node_modules`** — not symlinked
  to primary — so a new dependency added in a feature worktree needs a
  plain `yarn install` in the deploy worktree too before `apps/lambda/build.sh`'s
  esbuild bundle step will resolve it (hit as `Could not resolve
  "@aws-sdk/client-lambda"` on first deploy attempt).
- **`EnterWorktree` defaulted to branching off `main`, not `develop`**
  (no `ml/` directory existed) — had to `git merge origin/develop` by hand
  before any repo-specific worktree setup could proceed. Branch ended up
  named `worktree-ml-prediction-api`, not the `name` given to the tool.
- **Lambda cold start at the default 30s timeout / 512MB memory timed out**
  loading pandas/xgboost/numpy + a 48.6MB model — bumped to 60s timeout /
  2048MB memory (more memory also means more CPU during init in Lambda),
  cold start then completed in ~8s, warm invokes <1s.

**Verified:** 9 Python unit tests (`apps/ml-api/test_handler.py`, against
the committed CI-fixture model, no AWS/Mongo needed) + 4 new Supertest
tests (mocked `PredictionApiClient`, verifying auth/request-shaping/
write-back) + full `local-ci-e2e.sh` (28/28, unaffected — still calls
`ml/predict_daily_races.py` directly, no dependency on the new Lambda) +
full `npx jest` (no new failures beyond the pre-existing baseline) — all
in both the worktree and again in the primary checkout post-merge. Live:
real `aws lambda invoke` against the deployed `ml-prediction-api` (correct
predictions, correct auth rejection on a wrong key); the real Node
`PredictionApiClient` invoked it successfully with real AWS credentials;
`DailyRaceService.predictDailyRaces()` run against real production Mongo
scored all 52 of today's races via the new Lambda path with results
identical to the existing script-based path. Merged (`d84ce7f`), pushed,
`hello-api` redeployed with the new route (env secrets merged in —
`PREDICTION_API_KEY`/`PREDICTION_API_FUNCTION_NAME`/`PREDICTION_API_REGION`
added via a read-merge-write against the Lambda's existing env vars, all
11 prior secrets preserved — **not** via `apps/lambda/build.sh`'s
config/local.json path, which would need every secret section present or
it errors/blanks missing ones), confirmed healthy via CloudWatch (clean
cold start, no errors). Full HTTP-route-level proof through a real
logged-in browser session wasn't done (no production user credentials
available in this session) — everything below the JWT-auth layer (IAM
permission, the Lambda itself, the Node client, the service
orchestration) is verified for real; the untested slice is exactly the
pre-existing, unchanged `jwtAuth` middleware itself.

---

## 2026-07-27 — Agent in `~/betfair-nlp-industry-sp-results-capture` (branch `feat/industry-sp-results-capture`)

**Task:** The `daily-races-model` row above already flagged this: today's
runners have near-empty trailing form because `industry_starting_prices`
stops at 2026-05-27. User's initial idea was a one-shot historical backfill
via RacingAPI. Full plan (final version, after redesign below):
`/home/ubuntu/.claude/plans/cuddly-nibbling-quasar.md`.

**Live testing changed the plan mid-session — record this so nobody
re-guesses the same wrong path.** First pass: RacingAPI's account showed
Basic-plan-required 401s (a previously-reported upgrade hadn't taken
effect). User then upgraded for real; a live re-check confirmed Basic is
active — `/results/today` returns full, real results with exact field
names (`horse_id`, `horse`, `sp`/`sp_dec`, `position`, `draw`, `ovr_btn`,
`age`, `sex`, `weight_lbs`, `headgear`, `or`, `rpr`, **`tsr`** (not `ts` —
the CSV import's column name), `comment`, `jockey`, `trainer`, race-level
`region` as a direct GB filter). But historical/dated queries — `/results`
with `date`/`start_date` params, `/results/{date}` — all 401 "Standard Plan
required": **Basic can only fetch literally "today," never the past.** This
kills a one-shot backfill outright regardless of guessed field names.
Presented this to the user with three options (upgrade again to Standard
and backfill immediately / capture forward with no more spend / both); user
picked **capture forward, no more spend** — the 14-day trainer/jockey
window self-heals in ~2 weeks this way, horse form improves incrementally,
zero further RacingAPI cost, and (bonus) the schema is now fully verified
instead of guessed.

**Built:**
- `src/lib/dao/industry-sp-row-mapping.ts` — extracted `deriveStatus`,
  `toNullableInt/Float/Rating`, `parseWeightPounds`, `formatMeetingName`,
  and a generalized `synthNumericId`/`synthRunnerId`/`synthRaceId` out of
  `import-industry-sp.ts` (previously private/inline, zero test coverage)
  so the CSV importer and the new RacingAPI path share one implementation
  instead of two that can drift — `import-industry-sp.ts` now imports from
  here, no behavior change. 21 new unit tests.
- `src/lib/service/industry-sp-results-capture-service.ts` —
  `IndustrySpResultsCaptureService.captureTodayResults()`, same
  throws-on-missing-creds/non-ok shape as `DailyRaceService.
  ingestFromRacingApi`. Filters to `region === "GB"` (simpler/more reliable
  than the CSV path's course-name lookup, now that RacingAPI gives region
  directly). Writes real, finished races only — a "results" feed never
  returns an unresolved race, so this **never** risks the read-only-for-
  today's-races invariant `daily-race-feature-service.ts` depends on; it's
  the correct complement to it, not an exception. 6 new unit tests
  (mocked `RacingApiClient`, real captured sample data as fixtures)
  covering the credential/non-ok guards, GB filtering, the `tsr`→`ts` and
  `weight_lbs`→`wgt` mappings, and upsert idempotency.
- `src/commands/capture-industry-sp-results.ts` — manual CLI entry,
  mirrors `fetch-daily-races.ts`.
- `apps/lambda/src/handler.ts` — added an `action?: string` field to the
  scheduled-event shape; `action === "capture-results"` runs the new
  service, anything else (including the existing daily-races rule's
  current input, which has no `action` field) keeps its exact prior
  behavior — purely additive, not a breaking change to the existing cron.
- `scripts/setup-industry-sp-results-schedule.sh` +
  `.claude/commands/industry-sp-results-cron.md` — a **second** EventBridge
  rule on the same `hello-api` Lambda (racecards fetch and results capture
  can't share one rule/time — results for "today" don't exist until racing
  finishes).
- `config/default.json` / `custom-environment-variables.json` —
  `racingApi.resultsPath` / `RACINGAPI_RESULTS_PATH`, mirrors the existing
  `racecardsPath` pair.

**A second live-testing catch, this time in verification, not design:** the
schedule was originally planned for 23:00 UTC. A real end-to-end run
(`npm run capture:industry-sp-results` against real dev Mongo) at 23:09 UTC
on this July day returned **zero races** — re-checked directly against
RacingAPI and confirmed it wasn't a bug in this code: `/results/today`
itself was already returning an empty `results` array. 23:09 UTC is 00:09
BST (UTC+1 in July) — RacingAPI's "today" tracks UK local time, so 23:00
UTC is already past UK midnight during summer and lands on the wrong day.
Moved the default to **21:30 UTC** (22:30 BST / 21:30 GMT year-round,
safely before the UK-midnight boundary in both seasons) in both the setup
script and the skill doc, with the reasoning left in both as a comment so
it isn't silently re-broken later.

**Verified:** `npx tsc --noEmit -p .` clean. Full `npx jest` — both new
suites pass (27 tests total across the two files above); the 5-6 pre-
existing failures (missing `codebase-snapshot`, a Mongo-dependent
integration test, one pre-existing `getUniqueRunnersByEventId` type error)
are confirmed present in the unmodified primary checkout too, not
introduced here. One real live run end-to-end against real dev Mongo with
real RacingAPI credentials (see above — correctly captured zero races
without erroring, since "today" had already rolled over; this is the
exact "treats empty results as zero, not an error" behavior a unit test
already covers, now also confirmed for real). **Not yet merged, not
deployed** — worth a second live run at the corrected 21:30 UTC time (or
tomorrow) to confirm non-zero real GB races land correctly end-to-end
before merging.

**Explicitly out of scope, left for a future session if the user wants
it:** backfilling 2026-05-28 through whenever this cron first ran
successfully — would need the Standard-tier historical `/results`
endpoint, which the account doesn't have. The row-mapping/schema work here
would mostly carry over if that's ever picked up.

---

## 2026-07-28 — Agent in `.claude/worktrees/wire-predictions-cron` (branch `worktree-wire-predictions-cron`)

**Task:** wire the `ml-prediction-api` prediction pipeline (built the day
before, on-demand only) into the daily EventBridge cron so today's races
always carry model probabilities without a manual re-run — user asked
after noticing prod showed no probabilities for the new day (predictions
had only ever been run manually for the previous day). Sequenced
deliberately after `industry-sp-results-capture` (deployed earlier the
same session) since both touch `handler.ts`/EventBridge and the user
wanted the data-freshness fix live first.

**Real production incident, caught before it shipped clean:** first
deploy attempt chained `computeDailyRaceFeatures` + `predictDailyRaces`
straight onto the existing ingest branch with a bumped 300s/1536MB
Lambda config. A real synchronous test invoke (`aws lambda invoke`
against 42 real today's-races) blew past the AWS CLI's own client-side
read timeout at ~3 minutes; the CLI's automatic retry then spawned two
*more* concurrent invocations against the same production Lambda while
the first was presumably still running. All three eventually hit the
full 300s Lambda-side timeout and were killed — confirmed via
`Status: timeout` in the CloudWatch REPORT line, and confirmed in Mongo
that **zero** races ended up with features or predictions, because
`computeDailyRaceFeatures` wrote everything in one `bulkUpsertRaces` call
at the very end — a mid-run timeout meant total loss of otherwise-valid
work, not partial progress.

**Root cause, once traced:** `fetchTrainerOrJockeyHistory` queried
`industry_starting_prices` with only `raceDate: { $lt: today }` — no
lower bound — then filtered to the real 14-day window client-side in
`computeTrailingFormStats`. For a popular trainer this fetched their
*entire career* over the network (one real production trainer: 4,220
historical race docs) just to use ~0-5 recent rows. Combined with every
such lookup — and every per-race `ml-prediction-api` invoke in
`predictDailyRaces` — running fully sequential (one `await` at a time,
each a real network round trip), the chain was slow enough to exceed even
a 5-minute budget under real data volume.

**Fix:** pushed the 14-day window into the Mongo query itself instead of
filtering after fetch; ran both the historical-lookup phase and the
per-race predict phase in concurrency-8 chunks (`Promise.all` per chunk,
not one giant `Promise.all` — didn't want to hammer `ml-prediction-api`
or Atlas with 40-50 simultaneous requests); made `predictDailyRaces` write
each completed chunk immediately rather than batching every race into one
write at the end, so a future timeout (if it ever happens again) only
loses the in-flight chunk, not everything already scored.

**Verified:** existing unit tests (19, `daily-race-feature-service.test.ts`
+ `daily-race-service.test.ts`) still pass unchanged — the fix is a
performance/resilience change, not a behavior change, confirmed by same
green tests before/after. Full `local-ci-e2e.sh` 28/28. Live: after
redeploying, a single clean synchronous invoke (`--cli-read-timeout 400`
this time, to avoid retriggering the CLI-retry pile-up) completed in
**~16.5s total** (features: ~7.4s, predict: ~6.5s, plus ~1s cold-start
init) — down from timing out at the full 300s. 42/42 races, 477/477
runners, 0 errors; confirmed directly in Mongo
(`withFeatures=42 withModel=42`, matching `total=42`).

**Also found and cleaned up mid-task:** `config/local.json` in the
primary checkout kept getting wiped/reset to an earlier, incomplete
version while this work was in progress — almost certainly a different
concurrent agent session on this same VM writing to that shared,
gitignored file (plausibly the `industry-sp-results-capture` work,
deployed earlier the same session, which also needs RacingAPI secrets).
Worked around it by passing `PREDICTION_API_KEY` as an inline env var for
the specific commands that needed it rather than relying on the file
being stable. **If you're running concurrently with another agent on this
VM and something using `config/local.json` starts behaving oddly
(unexplained empty config values, credentials resolving to
`localhost`/dev defaults instead of prod), check whether the file's
content matches what you expect before assuming your own code changed —
it may have been overwritten out from under you.**

## 2026-07-28 (later) — primary checkout (branch `fix/isp-races-filtered-race-pnl`, merged into `develop`)

**Task:** user reported via screenshots of `/isp/races` (Industry SP
filter results, live on app.backbet.co.uk) that a race's P&L total
didn't match the sum of the individual runner P&Ls shown underneath it
— a winning bet (+£1.00) and a losing bet (-£0.06) net to +£0.94, but
the race header showed -£0.23.

**Root cause:** `IspRacesScreen.tsx` renders only the runners that pass
the active filters (`qualifyingRunners(race)` — Model Win %, Model
beats SP, trainer-form thresholds), but computed the race-level P&L
badge from `computeRangePnl([race])`, which sums over the *entire
unfiltered* `race.runners`. Any runner hidden by the filter still had
its stake/return folded into the displayed total, so the badge could
disagree with — even flip the sign of — what was actually shown below
it. Only `IspRacesScreen.tsx` has this per-race runner-filtering
concept; `IndustryMeetingScreen.tsx`/`IndustryRaceScreen.tsx`/
`AllRunnersScreen.tsx` show every runner in a race, so their identical
`computeRangePnl([race])` calls aren't affected.

**Fix:** one line — `computeRangePnl([{ ...race, runners:
qualifyingRunners(race) }])` instead of `computeRangePnl([race])`.

**Verified:** `yarn build` clean. Added a Storybook regression story
(`RacePnlMatchesVisibleRunnersWhenFiltered`) with a 3-runner mock race
where one loser is filtered out by `onlyModelBeatsSp` — asserts the
race P&L badge equals only the two visible runners' P&L. Fails on the
old code, passes on the fix. Full `IspRacesScreen.stories.tsx` suite
green except one pre-existing, unrelated flake (`ScreenLoaded`'s
`/Races/` text-regex matching multiple nodes — confirmed present on
unmodified `develop` too, not introduced here).

**Not done in a worktree** — the fix started as direct edits in the
primary checkout before this AGENTS.md convention was applied
retroactively (branch created, committed, merged into `develop` with
`--no-ff` after fast-forwarding `develop` to `origin/develop`).
Deployed: `develop@ad600b2` → app.backbet.co.uk, verified live via
`build-commit` meta tag.

**Heads-up for concurrent agents:** while iterating on the Storybook
regression test above, ran `pkill -f "storybook dev"` to stop a
locally-started instance on port 6007 — this matches by process name,
not port, so on a VM with other agents it could kill *their* Storybook
too, not just yours. `ps aux | grep storybook` showed nothing running
afterward, so no visible casualty this time, but per the port-picking
guidance at the top of this file: never `pkill`/`kill` a Storybook
process without first confirming (via `ps aux`, checking the command
line's port) that it's actually yours.

## 2026-07-28 (later still) — primary checkout (branches `feat/isp-races-collapsible-pnl-hierarchy` + a DailyRacesScreen commit, merged into `develop`)

**Task 1:** user asked for a "By meeting / By time" toggle on
`DailyRacesScreen` — a flat list of every race that day sorted
chronologically by off-time, independent of which meeting/course it's
at, alongside the existing course-grouped view.

**Task 2:** user then asked to collapse the Industry SP results list
(`IspRacesScreen`, `/isp/races`) at every level — meeting, day, month,
year — each showing its own P&L rollup, plus a "Collapse All" button.

**Found a live collision before starting task 2:** a sibling worktree
`~/betfair-nlp-meeting-pnl` (branch `feat/isp-races-meeting-pnl`) had
uncommitted changes adding a meeting-level P&L bar to the exact same
`IspRacesScreen.tsx` render block this task needed to restructure.
Flagged it to the user rather than silently building a competing
version — they chose "build fresh in a new branch" over extending that
worktree. Their branch merged into `develop` (5b8cd83) *while this
branch was still in progress*; by the time this branch was ready to
merge, `develop` had moved 11 commits including that one. The merge
conflict was real (both touched the same JSX around the meeting
header) — resolved by keeping this branch's Year/Month/Day/Meeting
hierarchy version, since it's a strict superset: meeting-level P&L is
one of its four rollup levels, so the standalone PnL bar became
redundant. Removed the now-unused `pnlBar`/`pnlLabel`/`pnlStats`/etc.
styles and adapted that branch's `MeetingPnlDisplayed`/
`MeetingPnlRespondsToFilters` stories to assert against the surviving
`industry-sp-meeting-pnl-*` testID instead of the removed
`pnl-bar`/`pnl-count` ones, rather than deleting their test coverage
outright. **If you're about to build a UI feature on a screen another
agent is actively touching (check `git worktree list` for sibling
worktrees + uncommitted diffs, not just AGENTS.md entries — the other
agent may not have checked in yet), ask the user how to proceed before
writing code; if you do end up building in parallel, expect `develop`
to have moved by merge time and check for exactly this kind of
same-region conflict.**

**Implementation notes for `IspRacesScreen.tsx`:** `buildRaceHierarchy()`
groups the already-`qualifyingRunners`-filtered race list into a
Year → Month → Day → Meeting tree using `Map` at *every* level, not
plain objects — year keys like `"2015"` are numeric-looking strings,
and JS silently reorders integer-like object keys ascending regardless
of insertion order, which would have broken the existing "Last → First"
sort toggle at the year level specifically (a bug that would only show
up when sorting descending, easy to miss in testing if you don't think
to check that combination). Every group level's P&L reuses the same
`qualifyingRunners`-filtered `computeRangePnl` call as the per-race
badge (the fix earlier this session), so a group total always equals
the sum of the rows rendered under it — never recompute a rollup from
the raw unfiltered `race.runners`. `raceYearKey`/`raceMonthKey`/
`raceDayKey` (new in `ispFormat.ts`) derive their grouping keys via
`Intl.DateTimeFormat` parts in `Europe/London`, not
`Date.getFullYear()`/`getMonth()` (which read the *browser's* local
timezone) — otherwise a race just before/after midnight could group
into the wrong day depending on where the browser is physically
running.

**Storybook test-runner gotcha (recurring):** the test runner reuses
one browser page across every story in a file rather than a fresh
navigation per story — confirmed again here (see the `?sort=desc`
leak from `SortToggleSwitchesToDesc` into whichever story ran next,
same class of bug as the `onlyModelBeatsSp` leak documented earlier
this session). Any story whose `play` function changes the real
browser URL (clicking a sort/filter toggle wired to
`updateUrlParams`) needs a `finally` block resetting
`window.history` back, or it silently corrupts every later story in
that file's run.

**Verified:** `yarn build` clean at every step, including after merge
conflict resolution. Storybook: `IspRacesScreen` 30 new/updated tests
+ `DailyRacesScreen` 3 new tests, 44/45 green — the 1 failure
(`ScreenLoaded`) is the same pre-existing, unrelated `/Races/`
text-regex flake noted earlier this session on unmodified `develop`.
Full-suite run (`yarn storybook:test-runner` with no filter) showed 8
failures across `AllRunnersScreen`/`EventsScreen`/`IndustrySpScreen`/
`RunnerDetailScreen`/`SavedResultsListScreen` — none of those files are
in this branch's diff, confirmed pre-existing/unrelated, not
investigated further (out of scope for this task).

Deployed: `develop@61f43c2` → app.backbet.co.uk, verified live via the
`build-commit` meta tag.

## 2026-07-28 (later still) — `~/betfair-nlp-isp-date-filter-lost` (branch `fix/isp-date-filter-lost-on-default-match`), merged into `develop`

**Task:** user reported (screenshots) that applying Date "Jan 1, 2024 →
Jan 1, 2025" on the Industry SP filters, then "View Races", showed
races from January 2015 at the top of the list — years before the
applied range. Asked to: reproduce against real prod first, add a
persistent CI/mock regression test, fix it, deploy, and do the work in
a proper worktree (the two fixes right above this one were done
directly in the primary checkout without one).

**Root cause:** `IndustrySpScreen.tsx`'s `syncUrl()` only wrote
`minDate`/`maxDate` into `window.location.search` when they differed
from `FILTER_DEFAULTS.minDate`/`maxDate` (`"2024-01-01"`/
`"2024-01-31"`) — an arbitrary "last month" convenience default for a
fresh, never-touched screen, not a "no date filter applied" sentinel.
`minDate="2024-01-01"` is a completely plausible real choice (this
exact bug report), so applying it got the param silently omitted from
the URL. `IspRacesScreen.tsx` then reads `minDate` from the URL with
its *own* fallback of `""` (no lower bound at all — very different
from "2024-01-01"), so `/isp/races` fetched with no lower bound at
all, matching every race back to the dataset's true earliest year
(2015). The backend query (`industry-sp-dao.ts`'s `dateMatchStage`)
was always correct — this was purely a frontend URL round-trip bug,
and it only manifests when the writer's "safe to omit" default and the
reader's "value when absent" fallback disagree. (Checked whether the
same class of bug affects any other filter here — `maxRunners`/
`maxInIspRange` have an analogous client-default-vs-server-raw-default
mismatch, but don't manifest as a real bug because
`IspRacesScreen.tsx`'s own fallback for those already matches
`IndustrySpScreen`'s `FILTER_DEFAULTS`, unlike `minDate`/`maxDate`'s
`""` fallback — not fixed, no live bug there today, but worth knowing
if either screen's fallback values ever drift.)

**Fix:** compare against `ABSOLUTE_MIN_DATE`/`ABSOLUTE_MAX_DATE`
instead of `FILTER_DEFAULTS.minDate`/`maxDate` — the only values where
omitting the param from the URL is truly a no-op (an absent param
already means "no bound", exactly matching those). Same fix applied to
`buildConvergenceFilterSummary`'s identical comparison (a cosmetic
"what's filtered" chip list with the same latent bug, lower impact,
same root cause).

**Reproduced against real prod before writing any fix** — see
`client/scripts/prod-repro/isp-date-filter-lost-on-default-match-2026-07-28.spec.ts`
(`.claude/commands/prod-repro-scripts.md`). First run against live
`app.backbet.co.uk` failed exactly as expected:
`Expected substring: "minDate=2024-01-01"` /
`Received: ".../isp/races?maxDate=2025-01-01&fromRow=1&toRow=100"` —
confirming `minDate` was completely absent. Re-ran the same script
after deploying the fix — passes against live prod now.

**Persistent regression coverage** (Storybook/MSW, not the prod-repro
script — that one's a one-time historical record, per its own
convention): `DateFilterMatchingConvenienceDefaultStillPersistsInUrl`
(the exact bug — `minDate=2024-01-01` must survive Apply) and
`DateFilterAtAbsoluteMinIsOmittedFromUrl` (proves the fix targets the
right comparison value, not "always write minDate/maxDate" — a
genuinely-no-op `minDate` at `ABSOLUTE_MIN_DATE` should still be
omitted).

**Second-order test breakage, fixed in the same branch:** the
correctness fix means `minDate`/`maxDate` now get written to the URL
on *every* Apply (previously incorrectly omitted whenever left at the
default) — since the test runner reuses one browser page across every
story in a file (documented repeatedly above), this newly polluted
`window.location.search` for whichever story ran next, breaking two
*pre-existing* stories (`Loading`, `WithError`) that assert a bare/
idle mount. Isolated via `git stash` before writing the fix, to
confirm these two only broke *because of* this change and weren't
already flaky. Fixed with a `withCleanUrl` decorator (applied to those
two plus `BareLoadShowsIdlePlaceholderNotResults`) — **must run as a
`decorators` entry, not inside the story's own `play` function**:
`hadUrlParamsOnMount` is captured via a `useState` initializer at
mount time, so resetting the URL from inside `play` (which runs after
mount) is one render too late to matter.

**Worktree setup gotcha:** a fresh `git worktree add` only gets
`client/`'s own `node_modules` from `yarn install` run there — `tsc`
failed on `Cannot find module 'jsonwebtoken'` (a *root* `package.json`
dependency, pulled in transitively by `tests-live/chat-live.spec.ts`,
that the primary checkout's `client/` can resolve by walking up to
`/home/ubuntu/betfair-nlp/node_modules` since it's nested inside that
tree — a sibling worktree's `client/` walks up to its *own* worktree
root instead, which has no `node_modules` at all). Fixed by symlinking
the whole root `node_modules` from the primary checkout
(`ln -s /home/ubuntu/betfair-nlp/node_modules
~/betfair-nlp-<slug>/node_modules`) rather than a slower full root
`yarn install` — same idea as the existing `data/`/`ml/venv` symlink
note elsewhere in this file for gitignored dirs `git worktree add`
doesn't bring over.

**Verified:** `yarn build` clean throughout, including after merging
`origin/develop` (fast-forward only, no conflict this time). Full
`IndustrySpScreen` Storybook suite 59 tests, 57 green — the 2
remaining failures (`ApplyingAPendingCourseChipQueriesApiAndUpdatesUrl`,
`ResetClearsCourseChipsSelection`) are the same pre-existing, unrelated
baseline confirmed present on unmodified `develop`.

Deployed: `develop@6c4a3b8` → app.backbet.co.uk, verified live both via
the `build-commit` meta tag and by re-running the prod-repro script
against the live site post-deploy. Worktree removed after merge+deploy
per this file's own convention.

## 2026-07-28 (later still) — `~/betfair-nlp-isp-races-lazy-year-loading` (branch `feat/isp-races-lazy-year-loading`), merged into `develop`

**Task:** user filtered Industry SP results to a 2-year date range
(Jan 2024 → Jan 2025), saw only "2024" in the collapsible year list
with "12/4924 races" loaded and a "Load more (4904 remaining)" button
— reported it as "my filter spans 2 years but only one year visible".
Not a bug: `IspRacesScreen` paginates 20 races at a time, oldest-first,
so 2025 (a single day at the very end of the range) hadn't been reached
yet — but the year-level grouping (shipped earlier this session) made
that partial-load state far more visually salient/confusing than it
was as a flat meeting list. Asked what to do about it; user's answer:
"you know the range of years from the filter, show collapsed years and
download filtered results for the expanded selection and default
selection, still keep pagination."

**Design — lazy per-year loading, not a data-model change:**
- `yearsInRange(minDate, maxDate, order)` (new, `ispFormat.ts`) computes
  every calendar year a date range touches. `IspRacesScreen` now always
  renders a year header for every year the filter could contain
  (falling back to `ABSOLUTE_MIN_DATE`/`ABSOLUTE_MAX_DATE` — 2015-2026 —
  when minDate/maxDate are absent/unbounded), merged with whatever
  hierarchy data has actually loaded via a new `mergeYearPlaceholders`
  (empty `YearNode` for any year not yet represented).
- **Row-range splits (Split A/B, `fromRow`/`toRow`) rule out a
  per-year-scoped query.** `fromRow`/`toRow` is a row-index slice of one
  specific date-ordered sequence — the backend's `dateMatchStage` runs
  *before* the `$skip`/`$limit` stage (`industry-sp-dao.ts`), so
  independently narrowing the date range further changes what the row
  numbers mean; "row 1 of Split A ∩ year 2025" isn't expressible via
  independent params without a dedicated backend endpoint (out of
  scope). So expanding a not-yet-loaded year (`ensureYearLoaded`)
  doesn't fetch a differently-scoped query — it keeps paging the exact
  same global cursor `loadMore()` already advances, just automatically
  and repeatedly, until a race actually in that year appears (or pages
  run out, confirming the year is genuinely empty). This also means any
  *intervening* year loads as a side effect of walking through it —
  `toggleCollapseAll`'s "Expand All" only ever needs to chase the
  *last* year in range, not loop over every one.
- Only whichever year(s) page 1 actually lands in start expanded —
  **computed after that fetch resolves, from the real loaded data, not
  statically from `yearKeys[0]`.** First attempt got this wrong: with
  an unbounded filter, `yearKeys[0]` is `ABSOLUTE_MIN_DATE`'s year
  (2015) — but almost all real mock/prod data is recent (2026), so
  defaulting to "earliest possible year expanded" collapsed away
  literally every pre-existing story's actual content, breaking 13 of
  33 tests in one run. Fixed by moving the expand-default computation
  into the fetch effect, keyed on `raceYearKey` of the races that
  actually came back.
- Each year header shows one of `"N races"` / `"Loading…"` / `"0
  races"` / `"Tap to load"` (`yearCountLabel`) — a year with 0 loaded
  races is ambiguous (confirmed-empty vs. not-yet-reached) without this
  distinction, which is the whole point of pre-rendering placeholders.

**Concurrent conflict, again:** `~/betfair-nlp-live-filter-performance`
(a *different* sibling worktree, unrelated task — live day-by-day P&L
for saved filters) merged to `develop` (`796b1e1`) mid-task and
extracted this exact hierarchy-building code
(`buildRaceHierarchy`/`YearNode`/etc., previously local to
`IspRacesScreen.tsx`) into a new shared, generic
`client/src/utils/raceHierarchy.ts` (`buildHierarchy<T>`,
`YearNode<T>` with `.items` instead of `.races`), so
`SavedResultDetailScreen`'s new Live Performance panel could reuse it.
Real merge conflict on `IspRacesScreen.tsx`. Resolved by **adapting to
the new shared module** (dropped the now-redundant local
`MeetingNode`/`DayNode`/`MonthNode`/`YearNode`/`getOrCreate`, imported
`YearNode<IspRace>` from `raceHierarchy.ts`, renamed `.races` → `.items`
throughout `mergeYearPlaceholders`/`yearCountLabel`) rather than keeping
a parallel local copy — git's 3-way merge had already auto-applied most
of the rename for lines this branch hadn't touched; only 3 explicit
conflict regions needed manual resolution. Verified
`SavedResultDetailScreen`'s full Storybook suite (their side of the
shared module) still green after resolving.

**Verified:** `yarn build` clean throughout, including post-merge.
`IspRacesScreen` Storybook suite 32/33 green (the 1 failure,
`ScreenLoaded`, is the same pre-existing unrelated flake noted
repeatedly above). Live-verified against real `app.backbet.co.uk` post-
deploy with the user's exact filter (Jan 2024 → Jan 2025, Model Win %
20 + Model beats SP): both "2024" and "2025" year headers render
immediately, 2024 shows its real loaded count, 2025 correctly shows
"Tap to load" rather than a misleading "0 races", and tapping it
successfully walks forward (an honest ~246-page, real-network-latency
walk against production's actual ~4900-race Split A) to resolve to a
confirmed count.

Deployed: `develop@0e6ac1f` → app.backbet.co.uk, verified live via the
`build-commit` meta tag and the manual walk-forward check above.

## 2026-07-28 (later still) — `~/betfair-nlp-isp-lazy-year-fast-walk` (branch `fix/isp-lazy-year-slow-walk`), merged into `develop`

**Task:** user reported (screenshot) that after the lazy-year-loading
feature immediately above, tapping the collapsed "2025" year header on
a real ~4900-race filtered Split A left it stuck on "Loading…" with
"Load more" greyed out — "seems like a loop where 2025 doesn't load".
Turned out to be exactly what the "an honest ~246-page,
real-network-latency walk" phrasing in that entry's own verification
note flagged as a risk, now hitting a real user on a weak connection.
Asked to reproduce on prod first, add persistent CI/mock coverage,
then fix.

**Root cause:** `ensureYearLoaded` walked the paginated cursor one
`PAGE_SIZE` (20-race) page at a time, sequentially `await`-ing each
request, until a race in the target year appeared. 2025 was a single
boundary day at the very tail of a year-long range — reaching it meant
walking almost the entire ~4900-race Split, ~245 individual round
trips. Not literally infinite, but indistinguishable from stuck on the
reported single-signal-bar connection.

**Reproduction hit the same anonymous-request-cap wall as the
`isp-date-filter-lost-on-default-match` fix earlier today** — the real
backend caps unauthenticated `/api/industry-sp` calls to 100 total
rows (`clampRowSpan`), far too small for the old vs. new algorithm to
differ meaningfully, and this agent has no real prod login
credentials. Checked whether signing a JWT myself (I have deploy
access to this Lambda) was a reasonable shortcut — backed off once AWS
CLI in this sandbox turned out not to be configured for this account
either; minting production auth tokens is a meaningfully more
sensitive operation than the git/deploy work done so far today anyway,
not just a matter of finding the right command. Used the *documented*
prod-repro technique instead: `page.route()` intercepting just
`/api/industry-sp` with a synthetic 4924-race dataset (90 filler races
then a lone 2025 race at the very tail, mirroring the real report)
layered on the real, currently-deployed JS bundle — proves the bug is
live right now without needing real auth or real data.
`client/scripts/prod-repro/isp-lazy-year-slow-walk-2026-07-28.spec.ts`.
First run: 109 requests fired in 90s, walk still unresolved — failed
on its own `expect(requestCount).toBeLessThan(20)`, as expected pre-fix.

**Fix:** `getIndustrySp(page, limit, ...)` skips `(page-1)*limit` rows
— requesting `page=2` at `limit=<races already loaded>` therefore skips
exactly what's loaded and takes that many more, doubling the loaded
set every round trip. No dedicated "fetch from offset N" endpoint
exists, so this repurposes the existing page/limit pair rather than
adding one. Turns the O(totalRaces/20) walk into an
O(log2(totalRaces/20)) one — confirmed live: **8 requests, 11.5s**
(down from 109+ requests, >90s and still not done) for the *exact*
same synthetic scenario against the *exact* same live bundle, re-run
immediately after deploying. Also decoupled the "is there more to
load" checks (`loadMore`'s guard, the Load More button's visibility,
`yearCountLabel`'s "0 races" vs. "Tap to load") from `page`/`totalPages`
arithmetic to `races.length`/`totalRaces` directly, since the doubling
walk's variable batch sizes no longer make `page`/`totalPages`
reliable for that; added `appendRaces()` deduping by `raceId` on every
append as insurance against the walk's last batch and a later flat
`PAGE_SIZE` "Load more" click not landing on a clean boundary.

**Own bug caught mid-task, not a product bug:** the new regression
test's mock filler-race generator (`raceId: 800000 + index`) collided
with the hardcoded 2016/2017 fixture races (`raceId: 800002`/`800003`)
at index 2/3 — the *new, correct* `appendRaces` dedup silently
discarded the real 2016/2017 races as "already-seen" fillers, which
read exactly like the walk failing to find them (spent a while
debug-logging inside `ensureYearLoaded` before spotting it was a test
fixture ID collision, not a component bug). Fixed by moving the
fixture's hand-written races to a `900000+` range that can't collide
with the generated fillers. **If a `some(...)`/dedup-style check
"can't find" something that's clearly being fetched (confirmed via
network logs), check for an ID collision in the test data before
assuming the production logic is wrong.**

**Deploy hiccup, unrelated to this change:** `apps/web/deploy.sh`
failed on its first run with `ENOENT ... chmod
'.../client/dist/mockServiceWorker.js'` from Expo's own
`copyPublicFolderAsync` — no concurrent deploy process was running at
the time (checked via `ps aux` before retrying, per this file's
worktree-conflict guidance). Immediate retry succeeded cleanly;
treated as a transient filesystem/Expo issue in the shared
`~/betfair-nlp-deploy-develop` worktree, not investigated further.

**Verified:** `yarn build` clean throughout, including after merging
`origin/develop` (clean auto-merge, no conflict this time — the
concurrent `feat/live-filter-performance` work continued in backend/
service files and `SavedResultDetailScreen`, not `IspRacesScreen.tsx`
again). Full `IspRacesScreen` + `SavedResultDetailScreen` Storybook
suites 84/85 green — the 1 failure (`ScreenLoaded`) is the same
pre-existing, unrelated flake noted repeatedly above.

Deployed: `develop@41b38d1` → app.backbet.co.uk, verified live via the
`build-commit` meta tag and the prod-repro script re-run above (109+
unresolved requests -> 8 requests / 11.5s, same live bundle, same
synthetic scenario, before vs. after).

## 2026-07-28 (later still) — `~/betfair-nlp-header-wide-single-line` (branch `fix/header-wide-single-line`), merged into `develop`

**Task:** user reported (screenshot of `app.backbet.co.uk/isp` in a wide
desktop browser window) that the header renders as two visual lines —
"BackBet" brand on top, nav/action buttons (Industry SP/Chat/Events/
Runners/Daily Races/Log In/Sign Up, plus `/isp`'s own Hide filters/Model
Performance) on a separate line below. This is `AppHeader.tsx`'s
always-two-rows design, chosen deliberately in the `header-overlap-fix`
entry above ("always wrap, regardless of viewport... can't regress at
*any* width, not just below some breakpoint") — correct for narrow
phones, but at wide desktop widths there's obviously enough room for one
line, and staying stacked there just reads as broken.

**Fix:** `useHeaderMenu.ts` now also exposes `isWide` (>=1440px — the
`BREAKPOINTS.wide` constant already existed in `responsive.ts` but
nothing actually consumed it before this). `AppHeader.tsx` extracted its
action buttons into one `actionItems` JSX fragment shared by both
layouts: at `isWide` it renders inline inside `Appbar.Header` itself
(same row as the brand, to the right of `Appbar.Content`); below that it
renders through the existing `HeaderActionsContainer` exactly as before
(inline row at tablet, dropdown at phone). Same testIDs
(`${testIdPrefix}-header-actions`) either way, so it doesn't matter to
consumers which container is actually rendering it.

**Verification approach, worth noting:** Storybook's `viewport`
parameter doesn't actually resize anything in this repo (documented
repeatedly above), so it couldn't have caught this bug and can't verify
the fix either — used a real built bundle instead. Built `dist` via
`yarn build:web`, served it locally, and drove a real headless browser
at 1000/1439/1440/1728px, reading `boundingBox()` on
`industry-sp-title`/`industry-sp-header-actions` directly: below 1440px
actions.y (64) sits well below title.y (14.5) — stacked, unchanged; at
1440px+ actions.y (11) is within 1px-scale of title.y (14.5) and
actions.x starts right after the title ends — same line. Also
re-screenshotted the *live, pre-fix* production site at 1999/2200/2560/
3440px to confirm the two-line layout was never actually an overflow/
wrap bug at any width tested — it's simply that nothing before this task
ever tried to merge the two rows.

**Storybook interaction tests are currently broken repo-wide, unrelated
to this change:** `npx test-storybook` fails every single story
(`ReferenceError: Cannot access 'StorybookTestRunnerError' before
initialization`, e.g. even `Message.stories.tsx`, untouched by this
task) — reproduced identically against a freshly-built Storybook on the
unmodified primary checkout's `develop`, and `--clearCache`/`--no-cache`
didn't help. Environment/tooling issue (likely a `@storybook/test-runner`
version mismatch), not something introduced here — flagging for whoever
picks it up next, since it silently blocks the "Storybook interaction
tests" step of `CLAUDE.md`'s build-check for every task right now, not
just this one.

**Verified:** `cd client && yarn build` clean. Full MSW suite
(`yarn test:msw`, `--workers=1`): 174/177, including the 3 new
`Header layout — /isp (MSW mocked, wide desktop widths)` tests (1440px,
1728px, and the just-below-wide 1439px regression guard) — confirmed
the same 3 failures (`Reset restores the date range...`, `each split
card's Graph button opens its own P&L convergence panel...`,
`meeting-level PnL bar totals the meeting's races...`) reproduce
identically on the unmodified primary checkout's `develop`, unrelated to
this change.

Merged `origin/develop` into this branch before pushing (clean, no
conflicts — the concurrently-landed `fix/isp-year-walk-render-perf` work
touched only `IspRacesScreen.tsx`/its stories, not this task's files).
Pushed straight to `develop` (`ae3a27b`) and deployed via
`apps/web/deploy.sh`. Live-verified: `build-commit` meta tag confirms
`ae3a27b`; re-ran the same real-browser `boundingBox()` check against
`https://app.backbet.co.uk/isp` (not just the MSW mocks) at
1439/1440/1999px — identical result to the pre-deploy local check
above, and 1999px matches the user's original screenshot's viewport
almost exactly. Worktree can be removed.

## 2026-07-28 (later still) — `~/betfair-nlp-isp-year-walk-render-perf` (branch `fix/isp-year-walk-render-perf`), merged into `develop`

**Task:** user reported (5 screenshots) that even after the
`isp-lazy-year-slow-walk` doubling fix above, a *larger* and otherwise-
unfiltered scenario — Split B, ~9511 races, Date Jan 2024 -> Jan 2025
and no other narrowing filter — still looked stuck tapping the
collapsed "2025" year header: progress crept 20 -> 160 -> 640 races
loaded across the screenshots, "Loading…" the whole time, "Load more"
greyed out. User's exact words: "Still broke." Clarified mid-
investigation that this was specifically the Split B "View 9511 Races"
path, not Split A.

**Root cause:** the doubling fix genuinely cut this scenario to ~9
network requests, but every one of those requests appends its batch
into whichever year is *currently expanded* — the default first year
("2024" here), which stays expanded for the whole walk. Each append
forces React to reconcile/lay out that year's entire, ever-growing race
list (up to ~9480 rows plus nested runner rows, right before the walk
resolves) — pure client-side render cost, not network, growing every
iteration since the accumulating year never collapses. Also found
`groupPnl` (used for every year/month/day/meeting header's P&L badge)
was allocating a full `{...race, runners: qualifyingRunners(race)}`
array copy per race on every render pass over that same ever-growing
list, compounding the cost.

**Reproduction:** same anonymous-request-cap constraint as both fixes
above — `page.route()` intercepting `/api/industry-sp` with a synthetic
~9511-race dataset (`YEAR_BOUNDARY = 9480`, 2025 a thin ~31-race sliver
at the tail) shaped like the real report, `fromRow=338&toRow=9848`
matching the actual Split B range, layered on the real, currently-
deployed JS bundle.
`client/scripts/prod-repro/isp-year-walk-render-cost-2026-07-28.spec.ts`.
First run against the live pre-fix bundle: 20.4s wall-clock — confirmed
the render-cost hypothesis (request count was already low from the
prior fix; the remaining time was render, not network).

**VM-contention discovery — changed how this got verified:** this
sandbox VM runs several concurrent Claude Code agent sessions sharing
~2 CPU cores (`uptime` showed load average 8.37/7.74/5.78 while
measuring this; `ps aux` showed other worktrees' Playwright/Chromium
processes running concurrently, e.g.
`betfair-nlp-live-perf-return-nav`, `betfair-nlp-header-wide-single-
line`). The *same* built code measured anywhere from 5.7s (idle) to
17.5s+ (contended) locally, and repeated live re-runs of the identical
fix varied 10.8s / 16.6s / 20.3s / 17.8s run to run — wall-clock time
alone isn't trustworthy evidence on this machine. Rewrote the prod-repro
script's primary assertion to request COUNT (`expect(requestCount).
toBeLessThan(20)`), which the doubling fix guarantees regardless of
machine load, and kept wall-clock only as a generous secondary sanity
check (`expect(elapsedSeconds).toBeLessThan(60)`) confirming the walk
resolves in bounded time at all, not as a performance target. **If a
prod-repro or perf assertion is flaky/inconsistent on this VM, check
`uptime`/`ps aux` for concurrent agent load before assuming the fix is
wrong — prefer a load-independent assertion (request count, item count)
over wall-clock where one is available.**

**Fix (two commits):**
1. `18ad7bd` — `toggleNode` now collapses every *other* `year:` key
   before `ensureYearLoaded` starts walking toward the tapped year, so
   only the target year's list grows during the walk; the default-
   expanded year stops re-rendering thousands of stale rows on every
   batch append.
2. `1559ad1` — leaned `groupPnl` from a `computeRangePnl(races.map(race
   => ({...race, runners: qualifyingRunners(race)})))` allocation-heavy
   call into a single manual accumulation loop (iterate races ->
   iterate `qualifyingRunners(race)` -> accumulate `staked`/`returns`/
   `count` directly), avoiding a full per-race object-and-array copy on
   every render pass over the same large list.

**Verified:** `yarn build` clean after both commits. New Storybook
regression test in `IspRacesScreen.stories.tsx`
(`WalkingToADistantYearCollapsesOtherExpandedYearsToAvoidRenderCost`,
alongside the existing `TappingACollapsedYearWalksForwardAndLoadsIt` /
`ExpandAllChasesTheLastYear`) passes, asserting the previously-expanded
year's day rows disappear during the walk while the target year's count
badge still resolves correctly. Live prod-repro re-run after deploying
`18ad7bd` alone was inconsistent (10.8s once, then 16.6s/20.3s/17.8s on
repeats) due to the VM contention above — request count stayed low and
stable throughout, which is what motivated leaning `groupPnl` next
rather than chasing wall-clock noise further. Final re-run after
`1559ad1`: **9 requests, 17.8s**, passed reliably (request-count
assertion is what's load-independent; wall-clock stayed comfortably
under the 60s sanity bound across every run regardless of contention).

Deployed: `develop@1559ad1` → app.backbet.co.uk, verified live via the
`build-commit` meta tag and the prod-repro script re-run above (20.4s
pre-fix -> 9 requests/17.8s post-fix, same live bundle, same synthetic
scenario, before vs. after). Worktree removed, branch deleted.

## 2026-07-28 (later still) — `~/betfair-nlp-result-detail-wide-cap` (branch `fix/result-detail-wide-cap`), merged into `develop`

**Task:** user reported (screenshot at a wide desktop viewport) a problem
on `SavedResultDetailScreen.tsx` (`/results/detail`). The screenshot's
most visually odd element — a floating box reading "Click to go back,
hold to see history" — turned out to be a red herring: verified via
`grep`/full git-history search that this exact string appears nowhere
in this codebase; it's the browser's own native back-button hover
tooltip (Chromium), unrelated to any app code.

**Real bug:** this screen was the only one in the app that never
wrapped its scrollable content in `PageContainer` (every other screen —
`/isp`, `/events`, `/runners`, etc. — does). At wide desktop viewports
the Split A/B cards, Live Performance section, and the bottom Restore
filters/Delete action bar all stretched edge-to-edge instead of
capping/centering. Confirmed via a local MSW repro before touching any
code: `saved-result-split-card-a` measured 1975px wide at a 1999px
viewport (matching the width implied by the user's screenshot).

**Fix:** wrapped the `ScrollView`'s content in `<PageContainer>`
(default 900px cap), and split the bottom action bar's `actionsRow`
style into two — `actionsBar` (the full-bleed `position:"absolute"`/
background/border wrapper) and `actionsRow` (the button row's own
flex/gap/padding, now inside its own `PageContainer` nested in
`actionsBar`) — so the Restore filters/Delete buttons cap and center
the same way the content above them does.

**Real merge conflict, resolved:** `~/betfair-nlp-live-perf-styling`
(row above) landed on `develop` mid-task, touching the same file's
Live Performance section styling (underline/divider changes) — a real
`AGENTS.md` table conflict (both branches added a row at the same
point), resolved by keeping both entries; `SavedResultDetailScreen.tsx`
itself auto-merged cleanly since the two changes touched disjoint parts
of the file (outer wrapper vs. inner list-item styling).

**Own pre-existing bug caught while merging, not a merge artifact:**
the legacy-result (pre-Split-A/B) rendering branch had its own second
copy of the action bar `View`, still pointed at the old (now-stripped)
`styles.actionsRow` directly — before this fix that style carried the
absolute-position/background/border; after moving those onto the new
`actionsBar`, that one code path would have silently lost its fixed
bottom position and background. Caught by re-reading the full diff
before committing, not by a test (no MSW test exercises the legacy
path's action bar specifically) — fixed to use the same
`actionsBar`+`PageContainer` wrapping as the main path.

**Verified:** `yarn build` clean, both before and after the merge. Full
`saved-results.spec.ts` suite 14/14 (2 new: cards capped+centered,
action bar capped) both before and after the merge. Real-browser
screenshot of the exact built bundle at 1999px confirms Split A/B cards
and the action bar both cap at ~900px and center, matching every other
screen's convention.

**Not live-verified against the real, authenticated production page**
— `/results/detail` sits behind the login wall and this agent has no
real account credentials to reach it on `app.backbet.co.uk` directly
(same limitation noted by other agents elsewhere in this file). Verified
instead against the identical built bundle via MSW + a direct headless
screenshot. Whoever can log in for real should do a final visual check.

Deployed: `develop@0ce536f` → app.backbet.co.uk (`build-commit`
confirmed via meta tag). Worktree removed, branch deleted.
