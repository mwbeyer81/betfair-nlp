# MSW Playwright Tests

Write Playwright tests that run against a **static build** of the Expo web app with every API call intercepted via `page.route()` — no backend, no MongoDB, no dev server. Fast and fully deterministic (mocked responses never change), which makes this the right home for navigation/routing tests and UI-state tests that don't need to prove the real API works.

## When to use this vs. `/playwright-e2e-tests`

- Proving a route renders the right screen, a panel opens/closes, or the UI reacts correctly to a *given* API response shape → this skill (fast, deterministic, no servers).
- Proving the real Express endpoint returns correct data end-to-end against the live app and live API → `/playwright-e2e-tests`.

New features usually want both: an MSW test for the UI wiring, and a live e2e test for the real request/response.

## Instructions

### 1. Add routes to the shared fixture

All mocked endpoints live in one place: `client/tests-msw/fixtures.ts`. Add a `page.route()` call inside `setupApiMocks()` for any new endpoint your test needs:

```typescript
await page.route((url) => url.pathname === "/api/your-new-endpoint", (route) =>
  route.fulfill({
    json: { success: true, data: [ /* representative mock rows */ ], count: 1 },
  })
);
```

Match on `url.pathname === "..."` for exact paths and `"**/api/foo/*/bar"` glob form when a path segment is dynamic (e.g. an id). Keep mock payloads realistic — reuse real field names/shapes from the actual API response (check the DAO/router code, not guesswork) since tests will assert on them.

`setupApiMocks()` is called automatically by the `test` fixture exported from `client/tests-msw/fixtures.ts` — individual spec files never call it directly, they just `import { test, expect } from "./fixtures"`.

### 2. Write the spec

Create `client/tests-msw/<feature>.spec.ts`:

```typescript
import { test, expect } from "./fixtures";

test.describe("<Feature> — MSW mocked network", () => {
  test("panel opens and shows loaded items", async ({ page }) => {
    await page.goto("/events");
    await expect(page.getByTestId("events-screen")).toBeVisible({ timeout: 10000 });

    await page.getByTestId("event-<thing>-badge-33858191").click();

    await expect(page.getByTestId("<thing>-panel")).toBeVisible();
    await expect(page.getByTestId("<thing>-item-12345")).toBeVisible();
  });
});
```

### Required coverage per feature

- Route/navigation: the screen or panel renders for its URL/entry point
- Loading → loaded transition: loading indicator disappears once mocked data resolves
- At least one item rendered by testID, sourced from the mock payload
- Close/back interaction returns to the prior screen or dismisses the panel
- If the endpoint can plausibly error, add a route that `route.fulfill`s a non-200 or `success: false` and assert the error state renders

### testID conventions (same as the other frontend skills)

- `<thing>-panel` — panel root
- `<thing>-loading` — loading indicator
- `<thing>-error` — error view
- `<thing>-item-{id}` — per-item views
- `event-<thing>-badge-<eventId>` — badge that opens the panel from Events

### Running tests

```bash
cd client && yarn build:web   # rebuild the static export — required after ANY client/src change (~1s)
cd client && yarn test:msw    # runs the whole tests-msw/ suite on port 3737
```

- Config: `client/playwright.msw.config.ts` — its `webServer` serves `dist/` with `npx serve -s`, no dev server needed.
- `metro.config.js` sets `resolver.useWatchman = false` so `expo export` never hangs during `build:web`.
- The build step does not need to be repeated between test runs unless you changed frontend code — but always rebuild before trusting a red/green result, since a stale `dist/` silently tests old code.

Run a single spec with `npx playwright test --config playwright.msw.config.ts tests-msw/<feature>.spec.ts`.
