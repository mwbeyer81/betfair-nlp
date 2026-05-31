# Playwright E2E Tests

Write end-to-end Playwright tests for a new feature in this project.

## Instructions

Create `client/tests/<feature>-e2e.spec.ts`. Tests run against the live app at `localhost:8081` and API at `localhost:3000`.

### Setup helpers
```typescript
const APP_URL = "http://localhost:8081/";
const API_URL = "http://localhost:3000";
const AUTH = "Basic " + Buffer.from("matthew:beyer").toString("base64");

async function login(page: import("@playwright/test").Page) {
  await page.goto(APP_URL);
  await page.getByTestId("auth-username-input").fill("matthew");
  await page.getByTestId("auth-password-input").fill("beyer");
  await page.getByTestId("auth-login-button").click();
  await expect(page.getByTestId("events-button")).toBeVisible({ timeout: 5000 });
}
```

### Required test groups

#### 1. API tests (no browser, use `{ request }`)
- `GET /api/...` returns 200 with `success: true` and correct shape
- `count` equals `data.length`
- Returns 401 without auth
- Returns 400/404 for bad params

#### 2. UI tests (use `{ page }`)
- Badge/button is visible in the expected panel
- Clicking badge/button opens the new panel
- Panel loads records from the API (at least one item visible)
- Panel header shows correct title
- Close button dismisses the panel

### Waiting patterns
```typescript
// Wait for loading spinner to disappear
await expect(page.getByTestId("runners-loading")).not.toBeVisible({ timeout: 15000 });

// Wait for first item
const items = page.locator('[data-testid^="runner-item-"]');
await expect(items.first()).toBeVisible({ timeout: 10000 });
```

### testID conventions
- `event-group-loading` — events panel loading spinner
- `event-<thing>-badge-<eventId>` — badge in events panel
- `<thing>-panel` — the panel root
- `<thing>-loading` — loading spinner
- `<thing>-panel-close` or `<thing>-close` — close button
- `<thing>-item-{id}` or `<thing>-item-{index}` — per-item views

### Running tests
```bash
cd /Users/mwbeyer/betfair-nlp/client && npx playwright test tests/<feature>-e2e.spec.ts
```

Requires both the Expo dev server (`localhost:8081`) and the API server (`localhost:3000`) to be running.

---

## MSW mock suite (no live servers needed)

For navigation and UI tests that don't need the real API, use the MSW suite in `client/tests-msw/`. All API calls are intercepted by Playwright's `page.route()` via `client/tests-msw/fixtures.ts`.

```bash
cd /Users/mwbeyer/betfair-nlp/client
yarn build:web   # build static Expo web export to dist/ (~1s)
yarn test:msw    # run 19 tests against static dist on port 3737
```

- Config: `playwright.msw.config.ts` — `webServer` serves `dist/` with `npx serve -s`
- `metro.config.js` sets `resolver.useWatchman = false` so `expo export` never hangs
- Rebuild `dist/` after frontend code changes; tests need no rebuild themselves
