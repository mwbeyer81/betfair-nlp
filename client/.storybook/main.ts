import type { StorybookConfig } from "@storybook/react-webpack5";
import webpack from "webpack";

const config: StorybookConfig = {
  stories: [
    "../src/**/*.mdx",
    "../src/**/*.stories.@(js|jsx|mjs|ts|tsx)",
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
    // Add support for React Native components
    if (config.resolve) {
      config.resolve.alias = {
        ...config.resolve.alias,
        "react-native$": "react-native-web",
        "react-native": "react-native-web",
      };

      // Add React Native polyfills
      config.resolve.fallback = {
        ...config.resolve.fallback,
        crypto: false,
        stream: false,
        util: false,
        buffer: false,
        fs: false,
        path: false,
        os: false,
      };
    }

    const babelOptions = {
      presets: [
        [
          "@babel/preset-env",
          {
            loose: true,
            targets: {
              browsers: ["last 2 versions"],
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
    };

    // Add babel-loader for TypeScript and JSX
    if (config.module && config.module.rules) {
      config.module.rules.push({
        test: /\.(ts|tsx|js|jsx)$/,
        exclude: /node_modules/,
        use: { loader: "babel-loader", options: babelOptions },
      });

      // Some node_modules ship raw TypeScript/JSX and need transpilation
      config.module.rules.push({
        test: /\.(ts|tsx|js|jsx)$/,
        include: [
          /node_modules\/expo-modules-core/,
          /node_modules\/expo-linking/,
          /node_modules\/react-native-markdown-display/,
        ],
        use: { loader: "babel-loader", options: babelOptions },
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

    // Define React Native globals missing in browser/webpack
    config.plugins = [
      ...(config.plugins || []),
      new webpack.DefinePlugin({ __DEV__: JSON.stringify(true) }),
    ];

    return config;
  },
};

export default config;
