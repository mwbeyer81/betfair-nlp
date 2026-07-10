import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests-storybook-live",
  timeout: 60000,
  fullyParallel: true,
  workers: 1,
  reporter: "line",
  use: {
    baseURL: "https://punt-storybook.pages.dev",
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
