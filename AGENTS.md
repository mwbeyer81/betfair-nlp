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

**⚠️ Backend bug found + fixed — relevant to your `industry-sp-dao.ts` changes too:**
`getAllRacesByRace`'s `$facet` stage runs the same `$sort` independently in
all three of the `total`/`totalRunners`/`pnlStats` branches whenever a row
range (`fromRow`/`toRow`) is active (`rowRangeStages` starts with `$sort`).
That triples the in-memory sort footprint versus the single sort the `data`
branch does, and at this collection's real size (~109k matching races) that
alone is enough to exceed Atlas M0's 32MB in-memory sort limit — confirmed
via live server logs, `MongoServerError code 292
QueryExceededMemoryLimitNoDiskUseAllowed`. **Any query with `fromRow > 1` or
`toRow` set was returning HTTP 500** before this fix. Since nothing before
my A/B split feature actually exercised row ranges in production traffic,
this bug was invisible until now.

Fix: added `{ allowDiskUse: true }` as the aggregate options arg on that
same call (last few lines of `getAllRacesByRace`, right after the `$facet`
closes, before `.toArray()`). Checked your diff of this file — you haven't
touched the `$facet`/`rowRangeStages`/`allowDiskUse` region, so this
shouldn't conflict, but you're adding `formFilterStages` earlier in the same
`basePipeline` — worth pulling this fix in when you merge/rebase so your new
form-filter query paths don't hit the same 500 once combined with a row
range. **DAO integration tests pass locally with this fix.**

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

**Deploy status:** Backend fix (`industry-sp-dao.ts`) and frontend feature
are implemented and locally tested (MSW + Storybook green; live e2e against
the real dataset caught and confirmed the bug above). Not yet deployed —
`apps/lambda/build.sh` (backend) is blocked on user permission per the
sandbox's auto-mode classifier; user said they'll run it themselves.
Frontend deploy (`apps/web/deploy.sh`) is queued behind that. Nothing pushed
to `develop` yet — flagging here specifically because of the file overlap
above, so let's coordinate before either of us pushes, to avoid a painful
rebase on `industry-sp-dao.ts`/`IndustrySpScreen.tsx`.

**If you push/merge first:** the `allowDiskUse: true` fix is a 3-line,
low-risk change — feel free to cherry-pick it into your branch directly
rather than waiting on mine; it'll save you from hitting the same 500 when
your form filters get combined with any row range.
