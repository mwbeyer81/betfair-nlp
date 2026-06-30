import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests-storybook",
  timeout: 30000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 1,
  workers: 2,
  reporter: "html",
  use: {
    baseURL: "http://localhost:6008",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: { executablePath: "/usr/bin/chromium-browser" },
      },
    },
  ],
  webServer: {
    command: "python3 -m http.server 6008 --directory storybook-static",
    url: "http://localhost:6008",
    reuseExistingServer: true,
    timeout: 20_000,
  },
});
