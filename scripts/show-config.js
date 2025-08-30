#!/usr/bin/env node

// Script to show configuration information
const config = require("config");

console.log("Full config:", JSON.stringify(config, null, 2));
console.log("MongoDB config:", config.mongodb);
console.log("Environment:", config.app?.environment || "not set");
