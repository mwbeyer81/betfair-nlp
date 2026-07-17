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
