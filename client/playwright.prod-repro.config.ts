import { defineConfig, devices } from "@playwright/test";

// For scripts/prod-repro/ only — see .claude/commands/prod-repro-scripts.md.
// Points at the real, currently-deployed app (never localhost, never a
// fresh local build) — the whole point of this config is exercising the
// bundle actually running for users right now. No webServer block: there
// is nothing to start, the target is already live.
export default defineConfig({
  testDir: "./scripts/prod-repro",
  timeout: 60000,
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  use: {
    baseURL: "https://app.backbet.co.uk",
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
