# Worktree Ports

Claim a stable, collision-free set of local dev/test ports for a git worktree.

## Why this exists

This repo runs multiple concurrent agents in sibling worktrees (see
`AGENTS.md`'s "Working in a worktree" section), all sharing the same VM.
Every local dev/test port today is a **fixed literal** — backend 3000,
Expo web dev 8081, Storybook 6006/6007, MSW Playwright's static server 3737,
`local-ci-e2e.sh`'s throwaway mongo/backend/frontend 27020/3050/8090 — and
there was no automated way to avoid two worktrees binding the same one.
`AGENTS.md` logs several real collisions from exactly this (Storybook port
6007 contention on 2026-07-25, MSW port 3737 contention twice on 2026-07-26),
each resolved ad hoc by a human/agent picking a different port by hand after
running `ps aux | grep <thing>`.

This skill replaces the ad hoc part with a shared registry: each worktree
claims a small integer index once, and every port below is `base + index` —
deterministic, non-overlapping, and computed once per worktree rather than
negotiated live every time you start a server.

## Claim your ports

From inside your worktree:
```bash
eval "$(scripts/claim-worktree-ports.sh <your-worktree-slug>)"
```
Use the same slug you branched with (e.g. `daily-races` for
`~/betfair-nlp-daily-races`). This is idempotent — re-running for a slug
that's already claimed an index returns the exact same ports every time, so
it's safe to put at the top of a new shell session rather than tracking the
numbers yourself.

This exports (values below assume index `i`, filled in by the script):

| Env var | Port | Overrides |
|---|---|---|
| `NODE_CONFIG` | `3010+i` | backend dev server's `server.port` (already-supported override, see `config/default.json`) |
| `EXPO_WEB_PORT` | `8091+i` | Expo web dev server |
| `STORYBOOK_PORT` | `6100+i` | `yarn storybook` |
| `STORYBOOK_HEADLESS_PORT` | `6200+i` | `yarn storybook:headless` / `:test` / `:test-runner` |
| `MSW_PORT` | `3800+i` | `client/playwright.msw.config.ts`'s static-serve port |
| `LOCAL_CI_MONGO_PORT` | `27100+i` | `scripts/local-ci-e2e.sh`'s throwaway mongod |
| `LOCAL_CI_BACKEND_PORT` | `3100+i` | `scripts/local-ci-e2e.sh`'s throwaway backend |
| `LOCAL_CI_FRONTEND_PORT` | `8200+i` | `scripts/local-ci-e2e.sh`'s throwaway frontend |

All of the above bases are chosen clear of every port already reserved for
real shared dev infra (3000/8081/6006/6007/27019) and the existing
`local-ci-e2e.sh` defaults (27020/3050/8090) and MSW default (3737), so a
worktree that hasn't claimed ports (or a developer running plain default
commands) is never affected — every consuming script/config falls back to
its original literal default when these env vars aren't set.

## Using the claimed ports

```bash
eval "$(scripts/claim-worktree-ports.sh daily-races)"

# Backend dev server, on your claimed port instead of 3000:
npm run server

# Expo web dev server:
cd client && yarn web --port "$EXPO_WEB_PORT"

# Storybook:
cd client && yarn storybook

# Storybook headless (used by storybook:test-runner):
cd client && yarn storybook:headless

# MSW Playwright suite:
cd client && yarn build:web && yarn test:msw

# Full local-ci e2e suite, entirely on claimed ports:
bash scripts/local-ci-e2e.sh
```

## The registry

`~/.betfair-nlp-worktree-ports.json` (outside any worktree, so it survives
`git worktree remove` and stays visible to every concurrently-running
agent), `flock`-protected via `~/.betfair-nlp-worktree-ports.lock` so
concurrent claims from different agents never race. Schema:
```json
{ "slugs": { "daily-races": 0 }, "nextIndex": 1 }
```

Stale entries (from a removed worktree) aren't automatically cleaned up —
harmless, since indices are small integers and the registry only grows by
one per distinct slug ever used. If you need to reset it, delete the file;
the next claim recreates it from scratch.

## Scope

This is general-purpose infra, not specific to any one feature's worktree —
any worktree can (and should) claim ports with this before starting local
dev servers or test suites, the same way `AGENTS.md`'s existing "check
`ps aux` first" Storybook guidance was meant to be followed by everyone.
