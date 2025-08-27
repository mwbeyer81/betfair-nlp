import React from "react";

// Add regeneratorRuntime polyfill
if (typeof window !== "undefined") {
  // Browser environment
  if (!(window as any).regeneratorRuntime) {
    console.log("🔧 Adding regeneratorRuntime polyfill...");
    // Create a simple regeneratorRuntime if it doesn't exist
    (window as any).regeneratorRuntime = {
      mark: function (genFun: any) {
        return genFun;
      },
      wrap: function (genFun: any) {
        return genFun;
      },
    };
  }
}

const preview = {
  parameters: {
    actions: { argTypesRegex: "^on[A-Z].*" },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/,
      },
    },
    backgrounds: {
      default: "light",
      values: [
        {
          name: "light",
          value: "#f5f5f5",
        },
        {
          name: "dark",
          value: "#333333",
        },
      ],
    },
    // Enable interaction testing logging in headless mode
    test: {
      // This ensures interaction tests run in headless mode
      mode:
        typeof process !== "undefined" && process.env.CI === "true"
          ? "ci"
          : "development",
    },
  },
  // Global decorator to set up logging environment
  decorators: [
    (Story, context) => {
      // Set environment variable for headless detection (only in Node.js environment)
      if (
        typeof process !== "undefined" &&
        (process.env.CI === "true" || process.argv.includes("--ci"))
      ) {
        process.env.STORYBOOK_HEADLESS = "true";
      }
      return <Story />;
    },
  ],
};

export default preview;
