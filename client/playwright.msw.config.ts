import { defineConfig, devices } from "@playwright/test";

const PORT = 3737;
const BASE_URL = `http://localhost:${PORT}`;

/**
 * Playwright config for MSW-powered tests.
 * Builds the Expo web export once then serves it statically — no dev server required.
 *
 * Run: npx playwright test --config playwright.msw.config.ts
 */
export default defineConfig({
  testDir: "./tests-msw",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `npx expo export --platform web --dev --output-dir dist && npx serve -s dist -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
