const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Disable watchman — it hangs during `expo export` because watchman
// tries to index the entire repo (including node_modules) before Metro
// can begin bundling. Native fs crawling is faster for a cold export.
config.resolver.useWatchman = false;

module.exports = config;
