import type { StorybookConfig } from "@storybook/react-webpack5";

const config: StorybookConfig = {
  stories: [
    "../src/**/*.mdx",
    "../src/**/*.stories.@(js|jsx|mjs|ts|tsx)",
    "../.rnstorybook/stories/**/*.stories.@(js|jsx|mjs|ts|tsx)",
  ],
  addons: ["@storybook/addon-links"],
  framework: {
    name: "@storybook/react-webpack5",
    options: {},
  },
  typescript: {
    check: false,
    checkOptions: {},
    reactDocgen: "react-docgen-typescript",
    reactDocgenTypescriptOptions: {
      shouldExtractLiteralValuesFromEnum: true,
      propFilter: prop =>
        prop.parent ? !/node_modules/.test(prop.parent.fileName) : true,
    },
  },
  webpackFinal: async config => {
    // Add regenerator-runtime to entry point
    if (config.entry) {
      if (typeof config.entry === "string") {
        config.entry = ["regenerator-runtime/runtime", config.entry];
      } else if (Array.isArray(config.entry)) {
        config.entry = ["regenerator-runtime/runtime", ...config.entry];
      } else if (typeof config.entry === "function") {
        const originalEntry = config.entry;
        config.entry = async () => {
          const entry = await originalEntry();
          if (typeof entry === "string") {
            return ["regenerator-runtime/runtime", entry];
          } else if (Array.isArray(entry)) {
            return ["regenerator-runtime/runtime", ...entry];
          }
          return entry;
        };
      }
    }

    // Add regenerator-runtime as a fallback
    if (config.resolve && config.resolve.fallback) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        "regenerator-runtime": require.resolve("regenerator-runtime/runtime"),
      };
    }

    // Add support for React Native components
    if (config.resolve) {
      config.resolve.alias = {
        ...config.resolve.alias,
        "react-native$": "react-native-web",
        "react-native": "react-native-web",
      };
    }

    // Add babel-loader for TypeScript and JSX
    if (config.module && config.module.rules) {
      config.module.rules.push({
        test: /\.(ts|tsx|js|jsx)$/,
        exclude: /node_modules/,
        use: {
          loader: "babel-loader",
          options: {
            presets: [
              [
                "@babel/preset-env",
                {
                  loose: true,
                  targets: {
                    browsers: ["last 2 versions", "ie >= 11"],
                  },
                },
              ],
              ["@babel/preset-react", { runtime: "automatic" }],
              "@babel/preset-typescript",
            ],
            plugins: [
              ["@babel/plugin-transform-react-jsx", { runtime: "automatic" }],
              ["@babel/plugin-transform-class-properties", { loose: true }],
              ["@babel/plugin-transform-private-methods", { loose: true }],
              [
                "@babel/plugin-transform-private-property-in-object",
                { loose: true },
              ],
              "@babel/plugin-transform-runtime",
            ],
          },
        },
      });
    }

    // Handle React Native specific extensions
    if (config.resolve && config.resolve.extensions) {
      config.resolve.extensions = [
        ".web.tsx",
        ".web.ts",
        ".web.jsx",
        ".web.js",
        ".tsx",
        ".ts",
        ".jsx",
        ".js",
        ...(Array.isArray(config.resolve.extensions)
          ? config.resolve.extensions
          : []),
      ];
    }

    return config;
  },
};

export default config;
