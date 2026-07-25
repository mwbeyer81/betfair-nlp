# MongoDB Integration Tests

Add a real-database integration test for a new DAO method.

## Instructions

Add a `describe` block to the appropriate file in `src/lib/dao/__tests__/`. Use the real dev database — **no mocks**.

### Connection config
```typescript
const MONGO_URI = "mongodb://localhost:27019";
const DB_NAME = "betfair_nlp_dev";
const EVENT_ID = "33858191"; // known Cheltenham event with real data
```

### Required test cases
1. Returns results for a known eventId (and runnerId if applicable)
2. Each document has required fields with correct types
3. All returned docs match the query filter (e.g. eventId, runnerId)
4. Respects the `limit` parameter
5. Returns empty array for unknown IDs
6. Results are sorted as expected (usually timestamp descending)

### Pattern
```typescript
describe("PriceUpdateDAO.getByEventIdAndRunnerId (integration)", () => {
  let client: MongoClient;
  let db: Db;
  let dao: PriceUpdateDAO;
  let knownRunnerId: number;

  beforeAll(async () => {
    client = new MongoClient(MONGO_URI);
    await client.connect();
    db = client.db(DB_NAME);
    dao = new PriceUpdateDAO(db);

    // Derive test data from the DB itself — don't hardcode IDs that may not exist
    const marketDao = new MarketDefinitionDAO(db);
    const runners = await marketDao.getUniqueRunnersByEventId(EVENT_ID);
    knownRunnerId = runners[0].id;
  }, 15000);

  afterAll(async () => { await client.close(); });
});
```

### Running tests
```bash
npx jest --testPathPattern="integration" --no-coverage --runInBand
```

Integration tests require MongoDB running at `localhost:27019` (the dev instance) — a
**plain local `mongod` process, not Docker**. If it's not already running:

```bash
# One-time setup (already done on this VM under /home/ubuntu/mongodb-local)
curl -sS -o mongodb.tgz https://fastdl.mongodb.org/linux/mongodb-linux-x86_64-ubuntu2204-7.0.14.tgz
mkdir -p /home/ubuntu/mongodb-local && tar xzf mongodb.tgz --strip-components=1 -C /home/ubuntu/mongodb-local

# Start it (background, persists until the VM reboots or it's killed)
mkdir -p /home/ubuntu/mongo-data-27019
/home/ubuntu/mongodb-local/bin/mongod --dbpath /home/ubuntu/mongo-data-27019 \
  --port 27019 --bind_ip 127.0.0.1 --fork --logpath /home/ubuntu/mongo-data-27019/mongod.log

# Verify
node -e "require('mongodb').MongoClient.connect('mongodb://localhost:27019').then(c => (console.log('ok'), c.close()))"
```

If the collection is empty (a fresh data directory has no seeded ISP data), most of these
tests short-circuit gracefully (`if (grand.total < N) return;`), but they won't actually
exercise the aggregation logic. `/home/ubuntu/mongodb-local/seed-local-mongo.js` inserts a
small synthetic `industry_starting_prices` dataset (30 races, with trainer-form/model
fields populated) so both the fast and slow aggregation paths get real coverage — run it
once with `node seed-local-mongo.js` from within a worktree that has the `mongodb` package
installed (it does a no-op if the collection already has documents).
