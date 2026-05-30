# Claude guidance for betfair-nlp

## Project overview
Full-stack TypeScript app: Express/MongoDB backend + Expo (React Native Web) frontend.
Backend: `src/` · Frontend: `client/src/` · Tests: `src/**/__tests__/` and `client/tests/`.

---

## Adding a new panel/button to the EventGroupsPanel

Follow these steps every time you introduce a new action badge on an event row (e.g. "runners", "markets", "results"). Each step maps to a concrete file.

### 1. Backend — DAO method
Add a query method to the relevant DAO in `src/lib/dao/`.
- Prefer MongoDB aggregations for complex cross-document lookups.
- Name the method `get<Thing>ByEventId(eventId: string)`.

### 2. Backend — Service method
Expose the DAO method via `BetfairService` (`src/lib/service/betfair-service.ts`).
- Thin wrapper: `return this.<dao>.get<Thing>ByEventId(eventId)`.

### 3. Backend — API endpoint
Add a GET route in `src/server/app.ts`:
```
GET /api/events/:eventId/<thing>
```
Return `{ success: true, data: [...], count: number }`.

### 4. Frontend — API client
Add an interface and a `get<Thing>(eventId)` method to `client/src/services/chatApi.ts`.

### 5. Frontend — Panel component
Create `client/src/components/<Thing>Panel.tsx`.
Required `testID` attributes:
- `<thing>-panel` — root view
- `<thing>-loading` — loading indicator
- `<thing>-error` — error view
- `<thing>-list` — scroll view
- `<thing>-panel-close` — close button
- `<thing>-item-{id}` — per-item views

### 6. Frontend — EventGroupsPanel badge
In `client/src/components/EventGroupsPanel.tsx`:
- Add `onView<Thing>: (eventId, eventName) => void` to the props interface.
- Add a `TouchableOpacity` with `testID={`event-<thing>-badge-${group.eventId}`}`.
- Pick a distinct badge colour; add it to `StyleSheet`.

### 7. Frontend — ChatScreen wiring
In `client/src/components/ChatScreen.tsx`:
- Add state: `show<Thing>Panel`, `<thing>EventId`, `<thing>EventName`, `<thing>s`, `<thing>sLoading`, `<thing>sError`.
- Add a `load<Thing>s(eventId, eventName)` async function.
- Pass `onView<Thing>={load<Thing>s}` to `<EventGroupsPanel>`.
- Conditionally render `<<Thing>Panel>` when `show<Thing>Panel` is true.

---

## Required tests for every new feature

### A. Storybook interaction tests (`client/src/components/<Thing>Panel.stories.tsx`)
Cover these scenarios with `play` functions:
- `PanelVisible` — panel mounts and list is in DOM
- `ItemsRendered` — each mock item appears by testID
- `CloseButton` — clicking close calls `onClose` once
- `LoadingState` — loading indicator visible, list absent
- `ErrorState` — error message visible, list absent
- `EmptyState` — empty-state text visible

Also add a `<Thing>BadgeClick` story to `EventGroupsPanel.stories.tsx` that verifies `onView<Thing>` is called with the correct `(eventId, eventName)`.

Remember to add `onView<Thing>: fn()` to the `meta.args` in `EventGroupsPanel.stories.tsx`.

### B. Supertest tests (`src/server/__tests__/app.test.ts`)
Add a `describe` block for `GET /api/events/:eventId/<thing>`:
- Returns 200 with `success: true` and `data` array.
- Each item has required fields.
- Returns 401 without auth.
- `count` matches `data.length`.

Update the `aggregate` mock if the new endpoint uses aggregation — add the new shape's fields to the shared mock object so both the existing grouped-events tests and the new tests pass.

### C. Playwright e2e tests (`client/tests/<thing>-e2e.spec.ts`)
Cover end-to-end with a running app (`localhost:8081`) and real API:
- Badge is visible in the Events panel.
- Clicking badge opens the panel.
- Panel loads records from the API (at least one item visible).
- Panel header shows event name.
- Close button dismisses the panel.

### D. MongoDB integration tests (`src/lib/dao/__tests__/market-definition-dao.integration.test.ts` or a new file)
Add a `describe` block for the new DAO method:
- Returns results for the known `eventId 33858191`.
- Each document has correct field types.
- Deduplication invariant holds (e.g. unique IDs).
- Returns empty array for an unknown eventId.
- Results are sorted as expected.
