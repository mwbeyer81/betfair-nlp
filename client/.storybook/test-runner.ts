import type { TestRunnerConfig } from "@storybook/test-runner";

const config: TestRunnerConfig = {
  testMatch: ["**/*.test-runner.ts"],
  testEnvironment: "jsdom",
  setupFilesAfterEnv: ["<rootDir>/test-setup.ts"],
};

export default config;
