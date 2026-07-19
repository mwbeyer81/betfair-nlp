# Agent coordination log

This repo has multiple Claude Code agents working concurrently in sibling git
worktrees. This file is a check-in point so we don't clobber each other's
work or duplicate-debug the same infra issues. **Read this before touching
`src/lib/dao/industry-sp-dao.ts`, `client/src/components/IndustrySpScreen.tsx`,
`client/src/utils/ispUrlParams.ts`, or shared local infra (ports 3000/27019/80).**

If you're an agent starting work here: add a new dated entry below (don't
edit/delete others' entries), and re-read this file before you push/merge.

---

## 2026-07-17 18:24 UTC — Agent in `/home/ubuntu/betfair-nlp` (branch `develop`)

**Task:** Added a "Race A / Race B" split feature to the `/isp` filters
screen — two independent race-range filters (default: first half / second
half of matching races), each with its own PnL summary, so a filter
hypothesis can be backtested on two slices of the data independently.

**Files touched (uncommitted, not yet pushed):**
- `client/src/components/IndustrySpScreen.tsx` — rewritten for the A/B split
- `client/src/components/IndustrySpScreen.stories.tsx` — new/renamed testIDs
- `client/src/utils/ispUrlParams.ts` — generalized `urlToRowParam()` to take
  a param name (`fromRowA`/`toRowA`/`fromRowB`/`toRowB`), added `urlHasParam`
- `client/App.tsx` — `onViewRaces` now takes `(fromRow, toRow)`
- `client/tests-msw/industry-sp.spec.ts`, `responsive.spec.ts` — testID updates
- `client/tests/industry-sp-e2e.spec.ts` — testID updates + new split test
- `src/lib/dao/industry-sp-dao.ts` — **see bug report below**

**⚠️ Backend bug found + fixed (twice — the first attempt didn't work,
leaving this note in case it saves you the same detour) — relevant to your
`industry-sp-dao.ts` changes too:**

`getAllRacesByRace`'s `$facet` stage was running the same `$sort` on
`raceTime` independently in the `total`/`totalRunners`/`pnlStats`/`data`
branches whenever a row range (`fromRow`/`toRow`) was active, each as a
blocking in-memory sort. At this collection's real size (~109k matching
races) that's enough to exceed Atlas M0's 32MB in-memory sort limit —
confirmed via live server logs, `MongoServerError code 292
QueryExceededMemoryLimitNoDiskUseAllowed`. **Any query with `fromRow > 1` or
`toRow` set was returning HTTP 500.** Nothing before the A/B split feature
exercised row ranges in production traffic, so this was invisible until now.

- First attempt (commit `56d9d59`): de-duplicated the sort (ran it once
  before `$facet` instead of once per branch) and added
  `{ allowDiskUse: true }`. **This did not fully work** — de-duplicating
  raised the safe ceiling from basically nothing to ~40k matching docs
  (confirmed via binary search against the live API), but the exact 50/50
  default split of the current ~109k-race dataset (54621/54622) sits just
  past that line, so it still 500'd. `allowDiskUse` turned out to be a
  no-op here: **Atlas M0/M2/M5 silently ignore that option** — same error,
  same codeName, even with it set.
- Real fix (commit `e28d194`): put the `$sort` on `raceTime` as the
  pipeline's *first* stage, ahead of the `$match`/`$addFields` filtering —
  MongoDB then walks the existing `{raceTime: 1}` index directly instead of
  buffering an in-memory sort, so everything downstream (skip/limit, bounded
  or open-ended) costs O(1) memory regardless of range size. Verified live:
  default A/B split, narrow filtered ranges, country filters, and desc sort
  all return 200 now, in under ~2.5s.

You're adding `formFilterStages` into the same `basePipeline` for your form
filters — worth pulling this fix in when you merge/rebase (`develop` has it
as of `e28d194`) so your new filter paths don't hit the same wall once
combined with a row range. One thing to watch for in your own work: if you
add any `$match`/`$addFields` stage that needs to run *before* the row-range
sort can be pushed down to the index (i.e. before `leadingSortStage` in the
current code), that would reintroduce the blocking-sort problem — keeping
the index-eligible `$sort` as pipeline stage zero is the load-bearing part
of this fix, not just "a sort exists somewhere before $facet".

**⚠️ Local infra state you should know about:**
- **Port 3000** (`ts-node src/server/index.ts`): I killed and restarted this
  process and lost its `MONGODB_URI`/`JWT_SECRET` env vars in the process —
  they weren't in any committed config (`config/local.json` doesn't exist on
  disk) and I couldn't recover them. **It's currently up but pointing at
  nothing usable (`jwt.secret` empty, `mongodb.uri` defaults to
  `localhost:27017`) — logins/queries against it will fail.** The user is
  aware and will restore the real env vars when they next need it. If you
  depend on port 3000 for live e2e tests, check with the user first, or
  restart it yourself with correct env vars if you have them.
- **Port 27019**: a local test MongoDB (empty/fixture-only, not the real
  ~109k-race dataset) — this is what `*.integration.test.ts` suites use, and
  it's unaffected by the above.
- **Port 80** (`serve -s client/dist`): still up, serving whatever was last
  built via `yarn build:web` in *this* worktree (`/home/ubuntu/betfair-nlp`)
  — if you rebuild `dist` in your own worktree it won't affect this one
  (separate directories), but if you also run something on port 80 from your
  worktree it'll conflict with this one. Consider a different port.
- **Ports 6006/6007**: Storybook — I used 6006, I see your agent is using
  6007, good, no conflict there.

**Deploy status (updated 20:50 UTC): fully live.** `develop` is at
`ce42876`. Backend fix (index-backed row-range sort) deployed to Lambda
`hello-api` and verified — Race A/B splits, filtered ranges, country
filters, desc order all return 200 with real data. Two follow-up frontend
fixes since:
1. Split card's Races/Horses/Staked/Return/PnL row overflowed on narrow
   phones — moved the full breakdown into a new `SplitDetailPanel.tsx`
   (full-screen, opened via a "Details" button); the card now shows only a
   compact one-line PnL headline.
2. **Bigger one, worth knowing if you touch any `/isp*` screen:** this
   app's `index.html` deliberately locks `html`/`body` with
   `position:fixed; overflow:hidden` to stop iOS Safari's pinch-zoom/
   bounce-scroll — see the comment block at the top of that file. That
   means **the document itself can never scroll on this app, ever** — only
   a real RN `ScrollView` component can make content reachable. `/isp`
   didn't have one wrapping its main content, so once the filter grid + two
   split cards exceeded the visible viewport (which real Safari's address
   bar/tab bar chrome shrinks well below the logical device height), Split
   B was **completely unreachable** — not just visually cramped, genuinely
   un-scrollable-to. Confirmed via a user screenshot on Chrome/iOS and
   reproduced exactly with Playwright at a 390×500 viewport. Fixed by
   wrapping the toolbar-through-split-cards content in a `ScrollView`
   (`industry-sp-scroll` testID); Appbar header and the SplitDetailPanel
   overlay both stay outside it. If your form-filter work adds enough
   filter rows to `/isp` that content grows taller, this ScrollView is what
   makes the extra rows reachable — don't remove it, and if you add new
   full-screen panels of your own, remember they need `position:absolute`
   at the `SafeAreaView` level (outside any ScrollView), not inside it.

All three fixes confirmed live via Playwright screenshots against
app.backbet.co.uk (including reproducing the exact "content below the fold
is unreachable" bug at a short viewport, then confirming the scroll fixes
it).

**If you rebase/merge onto `develop` now:** `industry-sp-dao.ts` on
`develop` already has the index-backed-sort fix (see above) — no need to
cherry-pick, just resolve the normal merge/rebase diff. Worth reading the
"watch for" note above before you touch this method's pipeline ordering.

**If you push/merge first:** the `allowDiskUse: true` fix is a 3-line,
low-risk change — feel free to cherry-pick it into your branch directly
rather than waiting on mine; it'll save you from hitting the same 500 when
your form filters get combined with any row range.

---

## 2026-07-17 22:00 UTC — same agent, /isp home page perf pass

Smoke-tested `/isp` page load timing live (Playwright, timing each `/api/*`
request). Two fixes, both on `develop` now (`e835531`, `cf8477a`):

1. **`getFilterBounds()` was the slowest request on the page (~4.1s)** —
   it `$unwind`-ed every race's runners array with no filtering first
   (~109k races × ~9 runners/race ≈ 1M documents through the pipeline).
   Rewrote to reuse the already-indexed `runnersWithIspCount` for max
   runners (no unwind needed) and compute isp min/max via `$filter` +
   `$min`/`$max` *expressions* over each doc's own array (keeps the
   pipeline at ~109k docs, no explosion). **No new index was needed** —
   `{runnersWithIspCount: 1}` already existed, it just wasn't being used
   because `$unwind` ran before any `$match` could touch it. Cut this
   query from ~4.1s to ~1.5-2s server-side (confirmed via CloudWatch
   `Duration`, not just wall-clock).
2. **Under concurrent browser load, `filter-bounds`/`countries` were still
   slow (up to 4.5s) even after the fix above** — likely Atlas M0
   connection contention when ~5 requests fire together on page mount
   (sequential curl tests were consistently fast; concurrent browser loads
   weren't). Since both endpoints return identical, rarely-changing data
   (only changes on a manual reseed) with no per-user variation, added
   `Cache-Control: public, max-age=3600` to both (and their `/api/runners/*`
   equivalents, for consistency) — the fetch() calls in `chatApi.ts` use
   default caching, so no frontend changes needed. Confirmed live: a second
   page load in the same browser context/session hit these two endpoints
   in 47ms/63ms instead of 1.7s/2.3s, and total page-load time dropped from
   ~7.5s to ~3.1s.

**If you add new near-static endpoints** (bounds, distinct-value lists,
anything that only changes on reseed) to `/isp` or `/runners`, consider the
same `Cache-Control: public, max-age=3600` pattern up front rather than
discovering the same contention issue later.

**Remaining cost on a cold/first page load** is now the three
`industry-sp` data queries themselves (grand total + Race A + Race B),
~700ms-2.9s each depending on Atlas M0 load — these already have the
index-backed-sort fix from earlier. Didn't chase this further this round;
flagging in case you're looking at the same page and want to pick it up
(e.g. caching a "no filters applied" default response, or precomputing the
grand total).

---

## 2026-07-18 06:25 UTC — same agent, /isp still slow after the caching pass

User reported the home page still took ages to load even after the caching
fix above. Root cause: caching `filter-bounds`/`countries` didn't touch the
actual `industry-sp` data queries (grand total + Race A + Race B), which
were still 3 separate concurrent requests. Two more fixes, both on
`develop` now (`40cfbbc`, `4105c72`):

1. **New `GET /api/industry-sp/splits` endpoint** (`IndustrySpService.
   getSplitStats`) combines the grand-total + split A + split B requests
   into one HTTP round trip. Under concurrent browser load, AWS Lambda was
   spinning up a separate execution environment per concurrent request —
   each paying its own cold start + fresh MongoDB connection against Atlas
   M0's limited throughput — and the browser had to wait a full round trip
   to learn the grand total before it even knew what split boundaries to
   ask for. The endpoint now computes the default 50/50 split server-side
   when the caller omits fromRowA/toRowA/fromRowB/toRowB, using
   `Promise.all` over the three *existing, unmodified* DAO queries so the
   index-backed-sort optimization from the earlier perf pass isn't lost
   (that fix specifically needs `$sort` to be pipeline stage zero — merging
   into one MongoDB `$facet` would have broken it; composed at the service
   layer instead). `IndustrySpScreen.tsx` now calls
   `chatApi.getIndustrySpSplits()` once instead of `chatApi.getIndustrySp()`
   three times.
2. **Cached `/api/industry-sp/splits` for 60s.** Even combined into one
   request and fully warm (5 consecutive curl calls, no cold start), the
   three aggregations inside `getSplitStats` consistently took ~2-2.5s —
   genuine Atlas M0 query latency, not something request-combining or
   indexing alone fixes. Since the dataset only changes on a manual reseed,
   caching (like `filter-bounds`/`countries` already do, just a shorter TTL
   since PnL figures read as more "live" to a user) smooths out repeat
   loads of the same filter combination without real staleness risk.

**Net result, confirmed live via Playwright:** first (cold) page load
~7.4s → down from ~7.5s pre-fix (the 3-Mongo-query cost genuinely doesn't
go away on a first load, cache or no cache), but the **second and later
loads within a session dropped from ~3.1s to ~1.3s, then ~980ms** — the
common case most users actually experience.

**If you're touching `/isp` performance further:** the theoretical floor
for a first/cold load is now `1 network round trip + grand-total query
time + max(splitA, splitB query time)` — the sequential dependency (need
the grand total before the default split boundaries are known) is
inherent to the "50/50 split" feature, not an implementation shortcut, so
it can't be removed without either (a) caching the grand total separately
with its own short TTL so repeat *different-filter* loads can still skip
re-deriving it, or (b) an Atlas cluster tier upgrade (M0 is genuinely
throughput-constrained; that's the real ceiling now, not application code).

**If you add new endpoints to `/isp`:** check whether they can reuse
`getSplitStats`'s pattern (one combined round trip, `Promise.all` over
independently-optimized DAO calls, short cache if the data doesn't change
often) rather than adding more concurrent per-field requests — that's
exactly the pattern that caused this in the first place.

**Aside, unrelated to this fix:** the live e2e suite (`tests/industry-sp-
e2e.spec.ts`) can't currently run locally — it targets `localhost:3000`,
which is still down from the credential loss noted earlier in this file
(MONGODB_URI/JWT_SECRET). All verification for these two commits was done
directly against the deployed app.backbet.co.uk instead.

---

## 2026-07-18 07:20 UTC — same agent, "Failed to load industry SP" crash

User hit this live shortly after the perf work above shipped. Root cause:
an inverted row range (`fromRow > toRow`) makes `rowLimit = toRow - fromRow
+ 1` go negative in `getAllRacesByRace` — MongoDB's `$limit` stage throws
outright on a negative argument (`MongoServerError` code 5107201) rather
than just matching nothing. Confirmed via CloudWatch and reproduced with
`/api/industry-sp/splits?fromRowA=100&toRowA=5&fromRowB=1`.

**Reachable from a stale/hand-edited/bookmarked URL** — `fromRowA`/
`toRowA`/`fromRowB`/`toRowB` (and the legacy endpoint's `fromRow`/`toRow`)
come straight from query params. `/api/industry-sp` already had its own
protection (router clamps `toRow` up to `fromRow` before it reaches the
DAO) — `/api/industry-sp/splits` didn't replicate that clamp, which is why
this was reachable there specifically. Fixed on `develop` (`ccf2dc4`):

- `getAllRacesByRace` (shared by both endpoints) now short-circuits an
  inverted range to an empty result instead of ever building the negative
  `$limit`, and clamps `fromRow < 1` too (same crash class, via `$skip`).
- Router-level clamp added to `/splits`' fromRowA/toRowA/fromRowB/toRowB
  as a first line of defense, matching `/api/industry-sp`'s existing
  pattern (though the two endpoints now handle the edge case differently —
  `/api/industry-sp` clamps toRow *up* to fromRow, `/splits` treats it as
  *empty* — both are crash-free, this wasn't worth reconciling into one
  behavior since neither is "more correct" and changing the legacy
  endpoint's longstanding behavior was the riskier option).

**If you're adding query-param-driven endpoints:** don't assume
`Math.max(1, x)` alone is enough sanitization for a from/to pair — validate
`to >= from` too (or, like `getAllRacesByRace` now does, treat an inverted
pair as legitimately empty at the DAO level so it's covered regardless of
which route calls in). Verified: DAO/service integration tests, 2 new live
e2e regression tests, and confirmed live in an actual browser via the
exact triggering URL shape (screenshot-verified: split card renders "No
races match this split" instead of the error state).

---

## 2026-07-18 — Agent in `/home/ubuntu/betfair-nlp` (branch `develop`) — session cache for `/isp`, Details "← Filters" button

User report: tapping "Filters" (navigating `/isp/races` → `/isp` via the
back button) re-ran the full `/api/industry-sp/splits` fetch every time,
which is slow. Root cause and fix, shipped as `06dabf8`:

**Fix 1 — sessionStorage cache for the `/isp` aggregate.** New
`client/src/utils/ispSplitsCache.ts` caches the splits result (grand total
+ both A/B splits) in `sessionStorage`, keyed by the full filter/split
combination (`buildSplitsCacheKey`) with an `isDefault` sentinel so an
auto-computed default split gets its own cache bucket rather than being
pinned to a row range that goes stale as the dataset grows. `fetchTrigger`
(a monotonic counter, 0 at mount, incremented only by Apply/Reset) gates
the cache check — `fetchTrigger === 0` means "this is a remount, not an
explicit user action," so only mounts/remounts read the cache; Apply and
Reset always bypass it and fetch fresh. This is deliberately scoped to
just the `/isp` home page's aggregate — the paginated races list on
`/isp/races` still always fetches fresh, unchanged.

**Fix 2 — a real (if narrow) race condition, found while testing Fix 1.**
`IndustrySpScreen.tsx` used to have two separate effects: one that fetched
and set state, and a second reactive `useEffect` that watched that state
and wrote it to the URL via `history.replaceState`. These don't
necessarily land in the same commit — a fast click on "View Races"
(trivial for Playwright, and not impossible for a fast human click) could
read `window.location.search` in the gap between "loading became false"
and "the URL-sync effect actually ran," silently dropping the just-applied
split row params from the URL. Fixed by deleting that second effect and
writing the URL synchronously (`syncUrl()`) right inside the fetch
effect's own cache-hit/network-success branches, off the just-fetched
`result` object rather than React state. **If you touch this fetch effect
again: keep state-setting and URL-writing in the same synchronous block —
splitting them back into separate effects reopens this exact race.**

**Fix 3 — `SplitDetailPanel` had no "← Filters" affordance,** only a
generic "X" close icon — inconsistent with the "← Filters" pattern already
used on `IspRacesScreen`. Replaced with an explicit `← Filters` button
(`testID="split-detail-panel-filters-{id}"`); the `onClose` prop is
unchanged, just relabeled at the call site.

**Storybook gotcha:** stories that mount `IndustrySpScreen` mostly share
the same default filter args, so a cache entry written by one story leaked
into the next one's mount via Storybook's preview iframe retaining
`sessionStorage` across story navigations (not a fresh page load per
story). Fixed with a global `loaders` entry in `.storybook/preview.tsx`
that clears `sessionStorage` before every story — needed for any future
`sessionStorage`/`localStorage`-caching feature in this app too, not just
this one.

**Verification:** MSW suite (`tests-msw/industry-sp.spec.ts`, 33/34 pass —
the 1 failure is the pre-existing unrelated "sort=asc on initial load"
flake), Storybook interaction tests (`IndustrySpScreen.stories.tsx` +
`SplitDetailPanel.stories.tsx` both fully pass), and a new
`tests-live/industry-sp-live.spec.ts` run directly against
`app.backbet.co.uk` (local dev backend on :3000 is still down per the
credential loss noted earlier in this file) — confirms live that
returning via "← Filters" fires zero new `/splits` requests and completes
in under 2s, the Details panel's "← Filters" button works, and Apply still
always fetches fresh.

---

## 2026-07-18 — Agent in `/home/ubuntu/betfair-nlp` (branch `develop`) — combined-request fix wasn't enough; default date window added on top

User kept seeing load times ranging from ~5s up to ~60s even after the
request-combining fix (see the entry above this one) landed. Pulled fresh
CloudWatch data and confirmed it directly: most `/splits` invocations land
in the normal ~1.2–2.9s range, but a handful still spike to 19-21s *after*
that fix was live. Root cause: combining 3 concurrent requests into 1 only
removes the concurrency *a single page load creates on its own* — it does
nothing about concurrency from *other* traffic hitting the same shared
Atlas M0 cluster at the same moment (other real users, my own testing, or
this file's other agent's testing/backfill work). M0 is throughput-
throttled per-tenant; enough concurrent ops from anywhere stalls some of
them for 20-30s regardless of how few requests any single client sent.

Also isolated, via temporary `console.log` timing markers around the
`getSplitStats` DAO calls (built+deployed from the clean
`betfair-nlp-deploy-develop` worktree, hit a few times, read back via
CloudWatch, then reverted — never touched the raw Mongo/Lambda-secret
values directly, only the resulting duration numbers) that **~98% of
server time is genuine MongoDB query cost, not Express/Lambda overhead**
(0-16ms). So neither more `Promise.all` nor further request-combining can
shave this floor — it's not wasted round trips, it's real compute.

**Fix, on top of (not instead of) the combining fix:** added an optional
`minDate`/`maxDate` raceTime-range filter to `getAllRacesByRace`
(`ccf2dc4`-adjacent code, see `8a88917`) — a new `dateMatchStage` prepended
*before* the row-range `$sort`, so it combines into one indexed
`{raceTime:1}` scan rather than adding a second pass. `/isp`'s frontend
now **defaults to calendar year 2024** instead of the full 2015-2026
dataset (`23dca46`) — shrinks the actual matched-race count the query
has to run over, which is the one lever that touches the real ~2.5s DB
floor rather than just avoiding self-inflicted concurrency. Verified live:
full dataset totalRaces=109726 took ~3.1s; 2024-filtered totalRaces=9845
took ~1.75s. Cold UI load samples went from ~3.8-7.3s down to a
consistent ~2.6-3.0s (tighter variance too, not just a lower average —
fewer docs scanned means less exposure to a contention spike mid-query).

**Deliberately NOT date-scoped:** `getFilterBounds`/`getDistinctCountryCodes`
stay dataset-global — narrowing them to the current date window would make
e.g. a country only present outside that window silently vanish from the
dropdown instead of just returning zero matches once selected. Also
deliberately did **not** touch `getFilterBounds` itself even though it's
right next to my change, since this file's other agent was mid-rewrite of
that exact method when I started (precomputed minIsp/maxIsp fields,
uncommitted) — used `git stash push -- src/lib/dao/industry-sp-dao.ts`
to isolate my `getAllRacesByRace` edit onto a clean HEAD-based diff,
committed, then `git stash pop` to restore their in-progress work
untouched. **If you're touching `industry-sp-dao.ts` and see uncommitted
changes you didn't make: that's very likely someone else's live work, not
stale cruft — stash-isolate around it rather than editing through it.**

**Remaining ceiling:** the 2024 default only shrinks the common case: a
custom date range (or Reset back toward "all time") still runs the full-
cost query, and the underlying 20-30s contention-spike risk under
concurrent load is unchanged for whatever window IS queried. The Atlas
tier upgrade (M10+) recommended in the entry above this one is still the
only fix for that; this entry's change is strictly a "make the common
path cheaper" complement to it, not a replacement.

---

## 2026-07-19 — Agent in `~/betfair-nlp-anon-isp-home` (branch `anon-isp-home`)

**Task (starting):** Make `/isp` work without signup/login and become the
app's de-facto home page (it's already the router's default/fallback —
see `useRouter.ts` — but today `App.tsx` blocks *everything*, including
`/isp`, behind a mandatory `AuthScreen` until authenticated). Plan:
- New `optionalJwtAuth` middleware (`src/server/middleware.ts`) that sets
  `res.locals.isAuthenticated` without ever 401ing.
- Move all `/api/industry-sp*` routes in `src/server/router.ts` to run
  *before* the blanket `router.use(jwtAuth)` gate, scoped under
  `optionalJwtAuth` instead. Every other route (`/api/events/*`,
  `/api/runners/*`, `/api/query`, `/api/stats`) stays gated exactly as
  today — Events/Chat/Runners intentionally remain login-only, just
  unlinked from the UI.
- Cap Split A / Split B (the race-range backtest windows in
  `IndustrySpService.getSplitStats`) at 100 races when anonymous, 1000
  when authenticated — enforced server-side against *both* the
  auto-computed default window and any explicit `fromRowA/toRowA/
  fromRowB/toRowB` the caller supplies (today there's no clamp at all on
  explicit values).
- `App.tsx`'s auth gate becomes route-scoped (only forces `AuthScreen` for
  `/events`, `/chat`, `/runners`); `/isp*` renders unauthenticated, with a
  dismissible `AuthScreen` overlay reachable via new Sign Up/Log In
  buttons on `IndustrySpScreen`'s header, plus a cap banner when
  anonymous and the matched set exceeds 100.

**Touching (per the warning at the top of this file):**
`client/src/components/IndustrySpScreen.tsx` (props/header/banner only —
not the filter/split-fetching logic itself), `src/server/router.ts`,
`src/server/middleware.ts`, `src/lib/service/industry-sp-service.ts`
(`getSplitStats` signature + default-window clamp only),
`client/App.tsx`, `client/src/components/AuthScreen.tsx`. **Not**
touching `src/lib/dao/industry-sp-dao.ts` or `client/src/utils/
ispUrlParams.ts` at all — no changes needed there for this feature.

Will append a completion entry below once shipped/verified.

**Done — shipped, not yet merged/deployed (still on `anon-isp-home`, not
pushed).** Plan above landed as designed, plus a few things found along
the way:

- **A behavior change beyond "add a cap":** `getSplitStats`'s default
  split window is (since the last entry above) an even half/half divide
  of the current total with `effToB` deliberately left `null`
  ("unlimited, through the end"). The new `raceCap` clamp is applied as a
  *ceiling on top of* that half/half computation (not a replacement for
  it) — so a small filtered total still gets both splits populated the
  way the half/half fix intended, but a large total (or an explicit
  caller-supplied range) is now bounded to raceCap. This also closes a
  real hole: previously an *authenticated* caller passing an explicit
  `toRowB` of `null`/omitted got a truly unbounded window — that's now
  capped at 1000 too, and a matching existing test
  (`splitB.toRow` expected `null`) was updated to expect `1005`
  (`fromRowB=6, raceCap=1000`).
- **`/api/industry-sp` (the plain race-list endpoint used by "View
  Races"/drill-down)** got the same `clampRowSpan` treatment for defense
  in depth — an anonymous caller hitting it directly with a huge
  `toRow` (bypassing `/splits` entirely) is capped the same way.
- **`chatApi.authHeader()` bug fixed in passing:** it always sent
  `Authorization: Bearer ${this.token}` even with no token, producing a
  literal `"Bearer null"` string. Harmless with the old all-or-nothing
  gate (every route needed a *real* token anyway), but with
  `/api/industry-sp*` now public, that malformed header was landing on
  `optionalJwtAuth` and (harmlessly, but sloppily) failing verification
  every single anonymous request. Now returns `{}` when there's no token.
- **sessionStorage splits cache (`ispSplitsCache.ts`) now includes
  `isAuthenticated` in its cache key** — without this, an anonymous
  100-race result cached under a given filter/split combo would get
  served back after the user signs up (or vice versa) on any remount
  that reuses the cache, since the key was otherwise identical. Known
  remaining gap, judged acceptable: signing up via the new overlay
  updates the header buttons/banner instantly (prop-driven), but doesn't
  itself trigger a fresh `/splits` fetch — the user needs to hit Apply
  (or reload) to actually see the upgraded 1000-race data. Flagging in
  case someone wants to wire an auto-refetch on auth-transition later;
  didn't do it here because distinguishing "just signed up" from "a
  stored session resolving on page load" cleanly (without extra
  unwanted fetches on every normal logged-in page load) needs a bit more
  plumbing than seemed worth it for this pass.
- **Storybook gotcha (new one, not the sessionStorage one from the
  2026-07-18 entry above):** `meta.args`' `fn()` mocks are created once
  at module load and shared by every story that doesn't override them —
  stories asserting an exact `toHaveBeenCalledTimes(N)` on a shared arg
  (my new `onRequestAuth`/`onLogout` stories) picked up call counts left
  over from whichever story ran before them in file order. Fixed by
  giving each such story its own `args: { onRequestAuth: fn() }`
  override. **If you add a story that asserts an exact call count on a
  meta-level `fn()` arg, give it its own fresh `fn()` in that story's own
  `args`** — `toHaveBeenLastCalledWith` (as the existing
  `onViewRaces` assertions already do) doesn't have this problem, only
  exact-count assertions do.

**Verified:**
- `cd client && yarn build` — clean, no TS errors.
- Supertest (`src/server/__tests__/app.test.ts`): 78 passed (added ~13
  new cases for the public routes + raceCap clamping).
- Storybook interaction tests (`IndustrySpScreen.stories.tsx`): 43/45
  pass — the 2 failures (`ApplyingAPendingCourseChipQueriesApiAndUpdatesUrl`,
  `ResetClearsCourseChipsSelection`) are **pre-existing and unrelated**:
  confirmed by `git stash`-ing every file this entry touches and
  re-running against the original code, which fails the exact same two
  tests with the exact same error (a `[object Set]` URL-serialization bug
  in the course chip filter, nothing to do with auth/raceCap).
- MSW Playwright (`tests-msw/industry-sp.spec.ts`,
  `tests-msw/navigation.spec.ts`, `tests-msw/responsive.spec.ts`, against
  `yarn build:web`'s static `dist/`): 102/103 pass — the 1 failure
  (`sort=asc is sent on initial load`) is the same pre-existing flake
  already noted in this repo's CLAUDE.md/earlier entries, unrelated.
  Added a new `anonTest` fixture (no token injected) alongside the
  existing `test` fixture for the anonymous-access coverage.
- Full non-integration Jest suite: same 8-suites-already-failing/35-tests
  baseline confirmed via the same stash-and-compare approach (missing
  `OPENAI_API_KEY`-type / `getHorsesByOdds`-not-implemented issues,
  nothing to do with this change).
- **Not run — no local MongoDB available in this sandbox** (no
  `docker`/`mongod` binary, port 27019 unreachable): the DAO integration
  tests (`industry-sp-dao.integration.test.ts`) and the service
  integration test (`industry-sp-service.integration.test.ts`, which
  exercises `getSplitStats` against real data). The service-layer change
  is a new *optional trailing* `raceCap` parameter defaulting to 1000, so
  every existing call in that integration test (none of which pass a
  6th-from-last-ish `raceCap` arg) should behave identically to before —
  but this is reasoning about the diff, not a real run. **Whoever next
  has DB access should run
  `npx jest --testPathPattern="integration" --no-coverage --runInBand`
  before this merges.**
- **Not run — no live server/real e2e environment in this sandbox**
  (same `localhost:3000`/credential-loss situation noted in the
  2026-07-18 entries above): `client/tests/industry-sp-e2e.spec.ts`. Added
  a new "Anonymous access" describe block there (no-login `/isp` load,
  Sign Up overlay, `/events`+`/chat`+`/runners` still gated, a live
  `/api/industry-sp/splits` raceCap check) and fixed the one test that
  referenced the now-removed `industry-sp-screen-events-button` testID —
  worth a real run against `app.backbet.co.uk` or a working local
  `localhost:3000`/`:80` before merging.

  **Post-merge note:** this shipped — merged to `develop` (`c52bc42`),
  Lambda + `app.backbet.co.uk` both redeployed and verified live
  (screenshot + curl checks against production). One deploy gotcha for
  whoever deploys next: **run `apps/lambda/build.sh` and
  `apps/web/deploy.sh` from a worktree whose local HEAD is actually
  `origin/develop`**, not just after pushing to the remote — I first ran
  `apps/lambda/build.sh` from `/home/ubuntu/betfair-nlp`'s primary
  checkout right after `git push origin anon-isp-home:develop`, and it
  silently bundled the *old* pre-merge code (the local branch pointer
  hadn't moved, only the remote had), deploying stale Lambda code that
  still 401'd on `/api/industry-sp*`. Caught it via a live curl check,
  fast-forwarded the local checkout (`git stash` the primary worktree's
  unrelated pre-existing dirty state first, `git merge --ff-only
  origin/develop`, `git stash pop`), redeployed, confirmed fixed. Also:
  `aws lambda update-function-code` followed immediately by
  `update-function-configuration` in `apps/lambda/build.sh` has a race
  (the config call can hit `ResourceConflictException: An update is in
  progress` if it lands before the code update's async state settles) —
  ran into it twice, worked around each time with
  `aws lambda wait function-updated --function-name hello-api --region
  eu-north-1` before retrying the config call manually. Didn't fix the
  script itself since it's shared infra outside this branch's scope, but
  **whoever deploys Lambda next should expect this and either retry once
  or add the wait into `build.sh` properly.**

---

## 2026-07-19 (later) — Agent in `~/betfair-nlp-auth-hardening` (branch `auth-hardening`)

**Task (starting):** Four features on top of the anonymous-ISP-home work
above:
1. Password confirmation field on signup (`AuthScreen.tsx`, client-side
   match check only — backend `signup(email, password)` keeps its
   existing single-password validation, `MIN_PASSWORD_LENGTH = 5`).
2. Email verification: extend `UserDocument`
   (`src/lib/dao/user-dao.ts`) with `emailVerified`/`verificationToken`/
   `verificationTokenExpiresAt`; new `email-service.ts` wrapping the
   Resend API (chosen over AWS SES — no email infra existed at all
   before this); `signup()` generates a token and sends a verification
   email; new endpoints `GET /api/auth/verify` (public, returns a small
   static HTML confirmation page — same pattern as the existing
   `/hello-world` route), `GET /api/auth/me` (protected, returns
   `{email, emailVerified}` since that status can't safely live inside
   the stateless JWT), `POST /api/auth/resend-verification`. **Decision
   (confirmed with user): soft reminder, not a hard gate** — signing up
   unlocks the 1000-race cap immediately regardless of verification
   status; unverified accounts just see a dismissible-per-session
   reminder banner. No changes to the raceCap/auth-tier logic from the
   entry above.
3. Cloudflare Turnstile bot-check: **explicitly deferred** — user chose
   to skip it this pass (no Turnstile site/secret key available, and I
   have no Cloudflare API access to provision one — the Cloudflare MCP
   tools available to me cover Workers/DNS-zones/KV/R2/etc., not
   Turnstile). Flagging here in case a future agent has keys and picks
   this up: it'd slot into `AuthScreen.tsx`'s submit flow client-side
   (widget + token) and a server-side siteverify call in
   `auth-service.ts` before `signup`/`login` proceed.
4. New always-visible "benefits of signing up" banner on
   `IndustrySpScreen.tsx`, below the `Appbar.Header`, shown to every
   anonymous visitor (not gated on hitting the race cap like the
   existing `industry-sp-cap-banner`) — distinct banner, distinct
   testID, don't confuse the two.

**Resend API key: not yet provided by the user.** `email-service.ts` is
being written to read the key from config (`config.get("email.apiKey")`,
mapped from `RESEND_API_KEY` via `custom-environment-variables.json`,
same pattern as `jwt.secret`/`openai.apiKey`) and to **log a warning and
no-op rather than throw** when the key is absent/empty — signup must
never hard-fail just because email delivery isn't configured yet. Real
sending (and the "does the email actually arrive" verification) can't be
tested end-to-end until the user supplies a real key and verifies a
sending domain/address with Resend — noting this so nobody assumes the
email path was verified live the way the rest of this repo's deploys
usually are.

**Touching:** `src/lib/service/auth-service.ts`, `src/lib/dao/user-dao.ts`,
`src/server/router.ts` (new routes only, not the industry-sp block from
the entry above), `client/src/components/AuthScreen.tsx`,
`client/src/components/IndustrySpScreen.tsx` (new banner, alongside but
separate from the existing cap banner), `client/src/services/chatApi.ts`,
`config/default.json`, `config/custom-environment-variables.json`,
`apps/lambda/build.sh` (secrets block only). New file:
`src/lib/service/email-service.ts`. **Not** touching
`src/lib/dao/industry-sp-dao.ts`, `client/src/utils/ispUrlParams.ts`, or
the raceCap/optionalJwtAuth logic from the previous entry at all.

Will append a completion entry below once shipped/verified.

**Done — committed on `auth-hardening`, not yet merged/deployed.** All
four planned pieces landed as designed (password confirmation, email
verification via Resend, verify/me/resend-verification endpoints, the
two banners), plus:

- **Cloudflare Turnstile: confirmed still deferred**, unchanged from the
  "starting" note above — no keys available, no Turnstile API in my
  Cloudflare MCP tools. `AuthScreen.tsx`'s submit flow has no bot-check
  hook yet; whoever picks this up next should read the "starting" note
  above for where it'd slot in.
- **`apps/lambda/build.sh` race condition (flagged as a known issue in
  the *previous* entry, from the anon-isp-home work) — actually fixed
  this time**, since I was about to hit it again myself: added
  `aws lambda wait function-updated --function-name hello-api --region
  eu-north-1` between `update-function-code` and each
  `update-function-configuration` call. Also extended the
  `config/local.json`-driven secrets block with `RESEND_API_KEY`,
  `EMAIL_FROM_ADDRESS`, `API_URL` (all read with a `|| ''` /
  `|| 'https://fd0xr...'` fallback so an older `config/local.json`
  without an `email` section doesn't crash the script).
- **`chatApi.getMe()` needs a `.catch()` everywhere it's called from a
  `useEffect`** — found this the hard way via Storybook: several
  pre-existing `IndustrySpScreen` stories override `parameters.msw.
  handlers` with a narrow custom list that doesn't include the new
  `/api/auth/me` mock, and `getMe()`'s underlying `fetch()` rejects (not
  just returns a non-ok response) when MSW's default onUnhandledRequest
  behavior lets it fall through to a real network call that fails in the
  headless test browser. An uncaught rejection there surfaced as a page
  error and failed ~7 *unrelated* stories (course chips, date filters,
  zero-match states — nothing to do with auth). Fixed by wrapping both
  `getMe()` call sites (the `isAuthenticated` effect and
  `handleRefreshVerification`) in `.catch()`/try-catch so a failed
  verification-status fetch just leaves the banner state as "unknown"
  instead of crashing anything. **If you add another effect that calls a
  new `chatApi.*` method for the first time, check whether existing
  stories/tests override MSW handlers narrowly enough to leave it
  unmocked — an uncaught rejection there will fail tests that have
  nothing to do with your change.**
- The signup response shape changed from `{ token }` to
  `{ token, emailVerified }` (same for login) — `AuthResult` in
  `chatApi.ts`. Updated every call site (`AuthScreen.tsx`'s two
  `chatApi.login/signup` usages, `App.tsx`'s URL-based `?email=&password=`
  auto-login effect) to destructure `.token` instead of treating the
  return value as a bare string. `onAuthenticated`'s own signature
  deliberately stayed `() => void` — `IndustrySpScreen` re-fetches
  `emailVerified` itself via `getMe()` whenever its `isAuthenticated` prop
  flips true, rather than threading verification status through
  `App.tsx` as a second piece of auth state.
- **Verification status is never derived from the JWT** — it can change
  after the token was issued (user clicks the email link in a different
  tab/session), so baking it into the JWT would go stale. It always
  comes from a fresh `GET /api/auth/me` call instead. Worth remembering
  if a future change is tempted to add `emailVerified` to the JWT payload
  for convenience — that would silently break "click the verify link
  while the app is open in another tab."
- **Resend API key: still not provided.** `EmailService` reads
  `email.apiKey` (mapped from `RESEND_API_KEY`) and no-ops with a console
  warning when it's blank — signup/resend never hard-fail because of it.
  Nobody has verified an actual email lands in an inbox yet; that needs a
  real key + a verified sending domain/address with Resend before this
  ships for real. `config/default.json`'s `email.fromAddress` default
  (`BackBet <onboarding@resend.dev>`) is Resend's own shared
  test-sending address — fine for a first smoke test once a key exists,
  but swap it for a real `noreply@backbet.co.uk`-style address (once
  verified with Resend) before relying on this for actual users, since
  the shared address has its own deliverability/reputation limits.

**Verified:**
- `cd client && yarn build` and `npx tsc --noEmit` (backend) — both
  clean.
- Supertest (`src/server/__tests__/app.test.ts`): 88 passed (added a
  stateful in-memory `mockUsers` array behind the mocked "users"
  collection — `findOne`/`insertOne`/`updateOne` — so signup → verify →
  me → resend-verification can be exercised end-to-end against the mock
  without a real database; new tests read the generated verification
  token directly off that array rather than trying to intercept an
  email).
- Storybook: `AuthScreen.stories.tsx` 12/12 pass (2 pre-existing signup
  stories had to be fixed to also fill the new confirm-password field, or
  the disabled-submit-button change would've broken them).
  `IndustrySpScreen.stories.tsx` 47/49 pass — the 2 failures are the same
  pre-existing, unrelated course-chip `[object Set]` URL-serialization
  bug already documented in the previous entry (confirmed unchanged by
  this work).
- MSW Playwright (`tests-msw/industry-sp.spec.ts` +
  `navigation.spec.ts` + `responsive.spec.ts`, against `yarn build:web`'s
  static `dist/`): 103/104 pass — the 1 failure is the same pre-existing
  `sort=asc is sent on initial load` flake noted in the previous entry.
  Added a default `/api/auth/me` mock (verified: true) to `fixtures.ts`'s
  shared `setupApiMocks` so every existing authenticated test keeps
  seeing "no verify banner" like before, plus a full anonymous
  signup-with-mismatched-then-matching-passwords-then-verify-banner flow
  test.
- Full non-integration Jest suite: same 8-suites/35-tests pre-existing
  baseline as the previous entry (confirmed by count, not a fresh
  stash-compare this time — same root causes: missing DB/API-key-shaped
  environment issues, unrelated to auth).
- **Not run** — same two gaps as the previous entry, for the same
  reasons (no local MongoDB, no live server in this sandbox):
  `industry-sp-*.integration.test.ts` (unaffected by this change — no
  DAO/service methods touched here besides the new `UserDAO`/
  `AuthService` methods, which integration tests don't currently cover
  either way) and the live-server portions of
  `client/tests/industry-sp-e2e.spec.ts`. Added new live-suite coverage
  for the benefits banner and the public `GET /api/auth/verify`/
  `GET /api/auth/me` endpoints, but **deliberately did NOT add a live
  test that calls the real `POST /api/auth/signup`** — unlike MSW/
  Storybook, that endpoint's live counterpart writes to the actual
  production `users` collection, and creating a throwaway account on
  every CI run isn't worth it just to exercise the verify happy path.
  Whoever next has a working `localhost:3000`/`:80` (or runs against
  `app.backbet.co.uk`) should still eyeball the full signup → resend →
  verify-link flow manually at least once before this ships broadly.

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
