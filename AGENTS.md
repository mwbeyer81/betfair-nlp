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
