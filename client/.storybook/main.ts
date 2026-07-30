import type { StorybookConfig } from "@storybook/react-webpack5";
import webpack from "webpack";
const config: StorybookConfig = {
  stories: [
    "../src/**/*.mdx",
    "../src/**/*.stories.@(js|jsx|mjs|ts|tsx)",
  ],
  addons: ["@storybook/addon-links"],
  staticDirs: ["../public"],
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
            // Deliberately NOT loose. Loose mode compiles array spread to
            // `[].concat(x)`, which wraps a non-array iterable instead of
            // iterating it — so `[...someSet]` silently evaluated to
            // `[theSetObject]` in every story. That's not a cosmetic
            // difference: IspRacesScreen derives a year's earliest data
            // month via `[...startMonths].sort()[0]`, which under loose
            // mode yielded the Set itself, poisoning the month range with
            // "[object Set]-01" so no month/day/meeting/race row ever
            // rendered under Storybook (24 of its stories failed on that
            // alone, while the real Metro/Expo build — which has its own
            // Babel config and never had loose set — worked fine).
            loose: false,
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
      // Some node_modules ship raw TypeScript/JSX ��� use function include for cross-platform path matching
      config.module.rules.push({
        test: /\.(ts|tsx|js|jsx)$/,
        include: (p: string) =>
          /expo-modules-core|expo-linking|react-native-markdown-display|react-native-paper|react-native-safe-area-context/.test(p),
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
      new webpack.NormalModuleReplacementPlugin(
        /react-native-vector-icons|@react-native-vector-icons|@expo\/vector-icons/,
        require.resolve("./mocks/react-native-vector-icons.js")
      ),
    ];
    return config;
  },
};
export default config;
