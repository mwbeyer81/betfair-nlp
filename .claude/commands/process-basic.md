# Process BASIC Data → Atlas

Upload and process Betfair market files from the `BASIC/` directory into MongoDB Atlas (prod). Only BSP-settled records are persisted (`BSP_ONLY=true`). Existing records are upserted by `marketId` — safe to re-run.

## Prerequisites

- BASIC data exists at `BASIC/` in the project root
- Atlas cluster is reachable (IP whitelisted in Atlas Network Access)

## Step 1 — Choose scope

Ask the user which path to process. Supported forms:

| Scope | Path example |
|---|---|
| Full tree | `BASIC/` |
| By year | `BASIC/2025/` |
| By month | `BASIC/2025/Jan/` |
| By day | `BASIC/2025/Jan/1/` |
| By event | `BASIC/2025/Jan/1/33858191` |

## Step 2 — Check for decompressed files

The import script skips `.bz2` files. Verify decompressed files exist in the target path:

```bash
find <path> -not -name "*.bz2" -not -name ".*" -type f | head -5
```

If the output is empty, decompress first (this may take a while for large trees):

```bash
npx ts-node src/commands/uncompress-bz2.ts <path>
```

Then re-check before continuing.

## Step 3 — Run import

```bash
MONGODB_URI="mongodb+srv://mattbeyer81:Y7XrLqyVPhGn7X9dbhg3d7@cluster0.lxpmuim.mongodb.net/" \
  MONGODB_DB_NAME=betfair_nlp \
  BSP_ONLY=true \
  NODE_ENV=production \
  npx ts-node src/commands/process-basic-files.ts <path>
```

**What to expect while it runs:**
- Startup: logs total files found and any already-processed (resume) count
- Every 60 s: `⏱  [12.3%] 1230/10000 — 18 files/s — ~8min left (ETA 14:35:22)`
- Finish: `🎉 File processing completed! Total: N | Done: N | Errors: N | Time: Ns`

If interrupted (Ctrl-C), re-running the same command resumes automatically — already-processed files are tracked in the `import_progress` collection and skipped.

## Step 4 — Verify

Check document counts landed on Atlas:

```bash
MONGODB_URI="mongodb+srv://mattbeyer81:Y7XrLqyVPhGn7X9dbhg3d7@cluster0.lxpmuim.mongodb.net/" \
  MONGODB_DB_NAME=betfair_nlp \
  NODE_ENV=production \
  npx ts-node -e "
    const { DatabaseConnection } = require('./src/config/database');
    (async () => {
      await DatabaseConnection.getInstance().connect();
      const db = DatabaseConnection.getInstance().getDb();
      console.log('market_definitions:', await db.collection('market_definitions').countDocuments());
      console.log('price_updates:', await db.collection('price_updates').countDocuments());
      await DatabaseConnection.getInstance().disconnect();
    })();
  "
```

Then health-check the backend (must be running with Atlas env vars):

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/stats
```

Expect `200`.
