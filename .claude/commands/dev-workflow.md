# Dev Workflow

Start the required services for local development and testing.

## Services

| Service | Command | Port | Required by |
|---|---|---|---|
| Backend API | `npm run server` | 3000 | playwright-e2e, mongo-integration tests |
| Expo dev server | `cd client && yarn web` | 8081 | playwright-e2e tests |
| Storybook | `cd client && yarn storybook` | 6007 | storybook interaction tests |

Run each in a separate terminal. They are independent — start only what you need.

## Backend health check

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/stats
```

Returns `200` when healthy. If it fails, restart: `npm run server`

## Test suites and their prerequisites

### Unit tests (no running servers needed)
```bash
npx jest src/lib/service/<file>.test.ts --no-coverage
```
See `/unit-tests` for the plain-Jest pattern (pure functions and mocked-collaborator classes).

### Supertest API tests (no running servers needed)
```bash
npx jest src/server/__tests__/app.test.ts --no-coverage
```

### MongoDB integration tests (MongoDB at localhost:27019 needed)
```bash
npx jest --testPathPattern="integration" --no-coverage --runInBand
```

### Storybook interaction tests (Storybook at localhost:6007 needed)
```bash
cd client && yarn storybook:test-runner
```

### Playwright E2E tests (backend + Expo dev server needed)
```bash
cd client && npx playwright test tests/<feature>-e2e.spec.ts
```

### MSW static tests (no servers needed — uses static build)
```bash
cd client && yarn build:web   # rebuild after any frontend changes
cd client && yarn test:msw
```
See `/msw-playwright-tests` for the routing/fixture pattern.

## TypeScript build check

Run after every frontend change before committing:
```bash
cd client && yarn build
```

## Git worktree hygiene

This repo runs multiple concurrent agents in sibling git worktrees — see
`AGENTS.md`'s "Working in a worktree" section for how to create one. The
other half of that convention matters just as much: **once your branch is
merged (and, for anything user-facing, deployed), remove the worktree**
rather than leaving it on disk.

```bash
git worktree remove ~/betfair-nlp-<slug>   # after confirming git status is clean
git branch -d <slug>                       # -d (not -D) refuses if unmerged, as a safety check
```

A stale merged worktree isn't just clutter — it's a live, editable checkout
of old code that the next agent might stumble into and mistake for active
work, and it silently drifts as `develop` moves on without it. Check
`AGENTS.md`'s "Active worktrees" table before assuming a worktree is safe to
remove: if it shows uncommitted changes (`git status --short` inside it),
that's very likely someone's real in-progress work, not cruft — leave it
and flag it instead of removing it.
