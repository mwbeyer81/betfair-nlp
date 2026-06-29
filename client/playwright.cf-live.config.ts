import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests-cf-live",
  timeout: 120000,
  fullyParallel: true,
  workers: 1,
  reporter: "line",
  use: {
    baseURL: "https://cf.backbet.co.uk",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
          args: ["--no-sandbox", "--disable-setuid-sandbox"],
        },
      },
    },
  ],
});
