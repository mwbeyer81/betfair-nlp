# Prod Repro Scripts

Write a one-off script that reproduces a reported bug against the real,
currently-deployed app — a diagnostic snapshot at a moment in time, not a
repeatable regression suite. Use this when a user reports something broken
live and reproducing it against a fresh local build wouldn't prove the bug
is actually present in what's deployed right now (stale cache, a fix that
landed locally but wasn't deployed yet, environment-specific config, etc.).

## How this differs from every other test category in this repo

| | Repeatable? | Target | Purpose |
|---|---|---|---|
| `client/tests-msw/*.spec.ts` / Storybook | Yes, every change | Local static build, mocked network | Primary regression-prevention layer |
| `client/tests-live/*.spec.ts` | Yes, after any related change | Real deployed app, real network | Ongoing confidence a live flow still works (e.g. `email-verification-live.spec.ts`) |
| `client/tests-local-ci/*.spec.ts` | Yes, via `yarn test:e2e:local-ci` | Fully self-contained throwaway stack | Real backend/DB behavior without touching shared/live infra |
| **`client/scripts/prod-repro/*.spec.ts` (this)** | **No — run once** | Real deployed app, real or mocked network | Prove a *specific reported bug* exists in the bundle that's live right now, at the moment it was reported |

A prod-repro script is not meant to keep passing or failing meaningfully
after the fix ships — the exact condition it exercises may not be
reachable again (e.g. a specific legacy data shape). It's kept as a
historical record of what was checked and when, the same way a commit
message or an `AGENTS.md` entry is a historical record — not maintained
going forward, not added to any `yarn test:*` script or CI config.

## Instructions

1. **Name it for the bug and the date**: `client/scripts/prod-repro/<short-bug-slug>-<YYYY-MM-DD>.spec.ts`.
2. **Point at the real deployed URL** (`https://app.backbet.co.uk`), never
   localhost and never a fresh local build — use
   `client/playwright.prod-repro.config.ts` (already wired to that
   `baseURL`, no `webServer` block since there's nothing to start).
3. **No real credentials needed, usually.** This agent doesn't have
   production login credentials. If the bug depends on authenticated state
   or a specific data shape, use Playwright's `page.route()` to intercept
   just enough of the API surface to reproduce the exact reported
   condition (e.g. inject a legacy-shaped API response) — same technique
   `tests-msw` uses, just layered on top of the *real* prod bundle instead
   of a local static build, so the JS actually being exercised is the one
   really running for users right now.
4. **The script should FAIL on this first run.** That failure — the
   assertion diff, the timeout, the exact error — is the point: it's the
   evidence root cause was confirmed, not a bug in the test to fix. Quote
   or summarize the real failure output in `AGENTS.md`'s dated entry for
   the fix.
5. **Run it directly**, not through any package script:
   ```bash
   cd client && npx playwright test --config playwright.prod-repro.config.ts scripts/prod-repro/<file>.spec.ts
   ```
6. **After the fix deploys**, optionally re-run the same script once more
   to confirm it now passes against the live bundle — then leave the file
   in place. Don't delete it and don't try to keep it green forever; git
   history plus the file itself are the record of what was checked and
   when. The actual regression-prevention test belongs in `tests-msw`/
   Storybook/`tests-live` as usual — this script's job ends once it's
   confirmed the fix reached production.

## Worked example

`client/scripts/prod-repro/results-white-screen-2026-07-27.spec.ts` —
reproduces the Saved Results list going blank for a `saved_filter_sets`
document saved before the Split A/B schema change (no `splitA`/`splitB`
fields), by intercepting `/api/saved-filter-sets` against the real
`app.backbet.co.uk` bundle and asserting the list screen is still present
after the fetch resolves. No production credentials or real data touched —
the interception alone is enough to prove the *deployed* code crashes on
that shape.
