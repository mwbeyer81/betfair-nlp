# Supertest API Tests

Add Supertest tests for a new API endpoint in `src/server/__tests__/app.test.ts`.

## Instructions

Add a `describe` block for the new endpoint inside the outer `describe("API Endpoints", ...)`.

### Required test cases
1. Returns 200 with `success: true` and a `data` array
2. Each item in `data` has the required fields (check shape)
3. Returns 401 without auth
4. `count` equals `data.length`
5. (If applicable) Returns 400 for invalid path params

### Pattern
```typescript
describe("GET /api/events/:eventId/runners/:runnerId/price-updates", () => {
  it("should return data for known params", async () => {
    const response = await request(app)
      .get("/api/events/33858191/runners/12345/price-updates")
      .auth("matthew", "beyer")
      .expect(200);

    expect(response.body).toHaveProperty("success", true);
    expect(Array.isArray(response.body.data)).toBe(true);
    expect(typeof response.body.count).toBe("number");
  });

  it("each document has required fields", async () => { ... });
  it("returns 401 without auth", async () => { ... });
  it("returns count matching data length", async () => { ... });
});
```

### Mock awareness
The test file mocks `collection.find().sort().limit().toArray()` to return a shared fixture object. That fixture already contains:
- `eventId`, `marketId`, `changeId`, `runnerId: 12345`, `runnerName`, `lastTradedPrice`, `eventName`

If your new endpoint uses `aggregate`, add its expected shape to the `aggregate.toArray` mock array.

### Running tests
```bash
cd /Users/mwbeyer/betfair-nlp && npx jest src/server/__tests__/app.test.ts --no-coverage
```
