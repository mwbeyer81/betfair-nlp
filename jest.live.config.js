// Runs *.live.test.ts suites that hit real external services (currently
// just RacingAPI) — excluded from the default `npm test` sweep in
// jest.config.js so CI and every other test run doesn't burn rate-limited
// API calls or fail for lack of credentials. Invoke explicitly:
//   npm run test:racing-api-live
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.live.test.ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  setupFiles: ['<rootDir>/src/test-env.js'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testTimeout: 30000,
};
