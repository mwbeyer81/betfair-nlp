import { defineConfig, devices } from "@playwright/test";

// Overridable per worktree via MSW_PORT (see .claude/commands/worktree-ports.md)
// so concurrent agents' MSW Playwright runs don't collide on the same fixed
// port — falls back to the original literal default when unset.
const PORT = Number(process.env.MSW_PORT) || 3737;
const BASE_URL = `http://localhost:${PORT}`;

/**
 * Playwright config for MSW-powered tests.
 * Serves the pre-built Expo web export statically — no dev server required.
 * Build once with: yarn build:web
 *
 * Run: npx playwright test --config playwright.msw.config.ts
 */
export default defineConfig({
  testDir: "./tests-msw",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  // "list" streams per-test progress to the console as the run happens —
  // without it, a local run gives zero visibility until everything's done.
  // The html reporter defaults to open:"on-failure", which starts a report
  // server and then `await`s a promise that never resolves — the process
  // never exits on its own after any failure (confirmed the hard way: an
  // 18+-minute "hang" that turned out to be ~3 minutes of real test time
  // followed by an indefinite wait for a Ctrl-C that never came). open:
  // "never" keeps the report available for post-mortem debugging
  // (`npx playwright show-report`) without ever blocking the CLI exit.
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: BASE_URL,
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
  webServer: {
    command: `npx serve -s dist -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
