import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests-live",
  timeout: 120000,
  fullyParallel: true,
  workers: 1,
  reporter: "line",
  use: {
    baseURL: "https://app.backbet.co.uk",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
