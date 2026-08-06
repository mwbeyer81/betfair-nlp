import { defineConfig, devices } from "@playwright/test";

// Runs against a fully self-contained local stack (throwaway mongod +
// backend + frontend) started/torn down by scripts/local-ci-e2e.sh — there
// is no webServer block here because the orchestrator has already started
// everything by the time Playwright runs. See
// .claude/commands/local-ci-e2e-tests.md.
export default defineConfig({
  testDir: "./tests-local-ci",
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  use: {
    baseURL: process.env.LOCAL_CI_APP_URL ?? "http://localhost:8090",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Playwright's bundled Chromium doesn't support this VM's Ubuntu
        // release (confirmed: "Playwright does not support chromium on
        // ubuntu26.04-x64") — same workaround as playwright.production.config.ts
        // and friends: fall back to a system Chromium when
        // PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH is set.
        launchOptions: {
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
          args: ["--no-sandbox", "--disable-setuid-sandbox"],
        },
      },
    },
  ],
});
