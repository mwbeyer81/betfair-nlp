import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for MSW-powered tests.
 * These tests run against the Expo dev server (localhost:8081) with MSW
 * activated via ?msw=1, so no live backend is required.
 *
 * Run: npx playwright test --config playwright.msw.config.ts
 * (Requires: Expo dev server running on port 8081)
 */
export default defineConfig({
  testDir: "./tests-msw",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: "http://localhost:8081",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
