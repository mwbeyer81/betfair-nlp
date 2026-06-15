# Seed Atlas

Seed MongoDB Atlas with a BSP-only dataset from the BASIC directory, then switch the app to point at Atlas and verify with smoke tests.

## Prerequisites

- BASIC data directory exists at `BASIC/` in the project root
- Atlas cluster is reachable (IP whitelisted in Atlas Network Access)
- Backend and Expo dev server are running for smoke tests

## Step 1 — Seed Atlas from a BASIC path (BSP-only)

Only runner updates where `bspReconciled=true` are persisted. All others are skipped.

```powershell
$env:MONGODB_URI = "mongodb+srv://mattbeyer81:Y7XrLqyVPhGn7X9dbhg3d7@cluster0.lxpmuim.mongodb.net/"
$env:MONGODB_DB_NAME = "betfair_nlp"
$env:BSP_ONLY = "true"
$env:NODE_ENV = "production"
npx ts-node src/commands/process-basic-files.ts BASIC/2025/Jan/1/33900286
```

Replace the path argument with any `BASIC/<year>/<month>/<day>/<eventId>` path.

`BSP_ONLY=true` is the default — set `BSP_ONLY=false` to import all runner updates.

## Step 2 — Start backend pointing at Atlas

Stop any existing backend, then:

```powershell
$env:MONGODB_URI = "mongodb+srv://mattbeyer81:Y7XrLqyVPhGn7X9dbhg3d7@cluster0.lxpmuim.mongodb.net/"
$env:MONGODB_DB_NAME = "betfair_nlp"
$env:NODE_ENV = "production"
npm run server
```

Health check:
```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/stats
```
Expect `200`.

## Step 3 — Run smoke tests

```bash
cd client && npx playwright test tests/app-smoke.spec.ts
```

All 3 tests must pass:
- App loads and renders root element
- Events screen (`events-screen` testID) is visible within 15 s
- No uncaught JS errors on load

## Switching back to local DB

```powershell
$env:MONGODB_URI = "mongodb://localhost:27019"
$env:MONGODB_DB_NAME = "betfair_nlp_dev"
$env:NODE_ENV = "development"
npm run server
```
