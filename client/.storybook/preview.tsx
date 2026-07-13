import React from "react";
import { Provider as PaperProvider } from "react-native-paper";
import { initialize, mswLoader } from "msw-storybook-addon";
import { INITIAL_VIEWPORTS } from "@storybook/addon-viewport";
import { theme } from "../src/theme";

const iphone12Viewport = {
  name: "iPhone 12",
  styles: { width: "390px", height: "844px" },
  type: "mobile" as const,
};

// Initialize MSW
initialize({ onUnhandledRequest: "bypass" });

// Initialize React Native Web
if (typeof window !== "undefined") {
  // Set up React Native Web environment
  (window as any).__REACT_NATIVE_WEB__ = true;

  // Add any missing React Native polyfills
  if (!(window as any).navigator) {
    (window as any).navigator = {};
  }

  console.log("🔧 React Native Web environment initialized");
}

const preview = {
  loaders: [mswLoader],
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
    viewport: {
      viewports: { ...INITIAL_VIEWPORTS, iphone12: iphone12Viewport },
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
      return (
        <PaperProvider theme={theme}>
          <Story />
        </PaperProvider>
      );
    },
  ],
};

export default preview;
