# Unit Tests

Write plain Jest unit tests for a function, class, or service in `src/`. No live servers, no database, no browser — just `jest`.

## When to use this vs. the other test skills

- Testing a pure function or small module in isolation (parsing, formatting, math) → this skill.
- Testing a service/class whose collaborators (DAOs, DB, fs, network) should be mocked → this skill.
- Testing an Express route end-to-end with `supertest` → `/supertest-api-tests`.
- Testing a DAO against a real MongoDB instance → `/mongo-integration-tests`.

## Instructions

Add the test file next to its module's existing `__tests__/` directory (e.g. `src/lib/dao/__tests__/`, `src/lib/service/__tests__/`), named `<module>.test.ts`.

### Pattern A — pure functions (no mocking)

Prefer table-style `it` blocks that name the *behavior*, not the input. See `src/lib/dao/__tests__/parse-isp.test.ts` for the house style: group by function with `describe`, one `it` per behavior/edge case, plain `toEqual` assertions.

```typescript
import { parseIsp } from "../parse-isp";

describe("parseIsp", () => {
  it("parses a plain fraction", () => {
    expect(parseIsp("5/1")).toEqual({ odds: 6, isFavourite: false, fraction: "5/1" });
  });

  it("returns null odds and fraction for blank input", () => {
    expect(parseIsp("")).toEqual({ odds: null, isFavourite: false, fraction: null });
  });
});
```

Always cover: the happy path, empty/null/undefined input, and at least one malformed/edge-case input (zero denominators, garbage strings, boundary values).

### Pattern B — classes/services with collaborators (mocked)

See `src/lib/service/__tests__/betfair-service.test.ts`. Mock every collaborator at the module boundary, construct the unit under test with mock instances injected, and reset mocks in `beforeEach`.

```typescript
import { BetfairService } from "../betfair-service";
import { MarketDefinitionDAO, PriceUpdateDAO } from "../../dao";

jest.mock("../../dao");
// Mock anything that touches config/DB/fs at module load time
jest.mock("../../../config/database", () => ({
  DatabaseConnection: { getInstance: jest.fn() },
}));

describe("BetfairService", () => {
  let service: BetfairService;
  let mockMarketDefinitionDAO: jest.Mocked<MarketDefinitionDAO>;
  let mockPriceUpdateDAO: jest.Mocked<PriceUpdateDAO>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockMarketDefinitionDAO = { getByEventId: jest.fn(), /* ...every method the class calls */ } as any;
    mockPriceUpdateDAO = { getByEventId: jest.fn(), /* ... */ } as any;
    service = new BetfairService(mockMarketDefinitionDAO, mockPriceUpdateDAO);
  });

  describe("someMethod", () => {
    it("returns the expected shape on success", async () => { /* ... */ });
    it("propagates errors from the DAO", async () => { /* ... */ });
  });
});
```

Mock every DAO/service method the class under test actually calls, not just the ones exercised by the first test — later `it` blocks in the same file rely on the full mock shape being present.

### Required coverage per unit

1. Happy path — correct output/shape for valid input
2. Each documented edge case (nulls, empty collections, boundary values)
3. Error propagation — if the unit calls a mocked collaborator that can reject/throw, assert the error surfaces (or is handled) correctly
4. Any branching logic — one test per branch

### Running tests

```bash
npx jest src/lib/service/<file>.test.ts --no-coverage
npx jest src/lib/dao/__tests__/<file>.test.ts --no-coverage

# Whole suite (unit + supertest; excludes MongoDB integration tests, which need -testPathPattern="integration")
npx jest --no-coverage
```

`jest.config.js` already excludes `test-utils.ts` and `setup.ts` from being treated as test files, and integration tests live under the same `__tests__/` dirs — use `--testPathPattern` to scope a run when needed.
