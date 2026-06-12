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

## TypeScript build check

Run after every frontend change before committing:
```bash
cd client && yarn build
```
