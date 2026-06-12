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

Integration tests require MongoDB running at `localhost:27019` (the dev instance).
