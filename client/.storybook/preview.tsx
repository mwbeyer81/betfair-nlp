import React from "react";
import { Provider as PaperProvider } from "react-native-paper";
import { initialize, mswLoader } from "msw-storybook-addon";
import { theme } from "../src/theme";

// @storybook/addon-viewport is incompatible with Storybook 9 (package removed) —
// define the small set of viewports this project's stories actually reference
// (mobile1, iphone12) instead of importing its INITIAL_VIEWPORTS.
const mobile1Viewport = {
  name: "Small mobile",
  styles: { width: "375px", height: "667px" },
  type: "mobile" as const,
};

const iphone12Viewport = {
  name: "iPhone 12",
  styles: { width: "390px", height: "844px" },
  type: "mobile" as const,
};

const ipadViewport = {
  name: "iPad (portrait)",
  styles: { width: "768px", height: "1024px" },
  type: "tablet" as const,
};

const laptopViewport = {
  name: "Laptop / MacBook (landscape)",
  styles: { width: "1440px", height: "900px" },
  type: "desktop" as const,
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
  loaders: [
    mswLoader,
    // IndustrySpScreen caches its /splits result in sessionStorage, keyed
    // by filter params — since most stories share the same default filter
    // args, a cache entry written by one story would otherwise leak into
    // the next one's mount and mask whatever that story's own MSW handler
    // returns. Clearing before every story keeps each one's mocked
    // response the actual source of truth.
    async () => {
      if (typeof window !== "undefined") {
        window.sessionStorage.clear();
      }
      return {};
    },
  ],
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
      viewports: {
        mobile1: mobile1Viewport,
        iphone12: iphone12Viewport,
        ipad: ipadViewport,
        laptop: laptopViewport,
      },
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
