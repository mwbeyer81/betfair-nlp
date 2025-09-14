#!/usr/bin/env node

/**
 * MongoDB execution utility for running mongosh commands from Node.js on Mac
 * against MongoDB running in Docker container
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

/**
 * Execute a MongoDB command using docker exec
 * @param {string} command - The MongoDB command to execute
 * @param {string} database - The database name (default: betfair_nlp_dev)
 * @param {boolean} verbose - Whether to show verbose output
 */
function executeMongoCommand(
  command,
  database = "betfair_nlp_dev",
  verbose = false
) {
  try {
    const dockerCommand = `docker-compose -f docker-compose.local.yml exec -T mongodb mongosh ${database} --eval "${command}"`;

    if (verbose) {
      console.log(`Executing: ${dockerCommand}`);
    }

    const result = execSync(dockerCommand, {
      encoding: "utf8",
      stdio: verbose ? "inherit" : "pipe",
    });

    return result;
  } catch (error) {
    console.error("Error executing MongoDB command:", error.message);
    throw error;
  }
}

/**
 * Execute a MongoDB script file using docker exec
 * @param {string} scriptPath - Path to the JavaScript file containing MongoDB commands
 * @param {string} database - The database name (default: betfair_nlp_dev)
 * @param {boolean} verbose - Whether to show verbose output
 */
function executeMongoScript(
  scriptPath,
  database = "betfair_nlp_dev",
  verbose = false
) {
  try {
    const fullPath = path.resolve(scriptPath);

    if (!fs.existsSync(fullPath)) {
      throw new Error(`Script file not found: ${fullPath}`);
    }

    const scriptContent = fs.readFileSync(fullPath, "utf8");
    const dockerCommand = `docker-compose -f docker-compose.local.yml exec -T mongodb mongosh ${database} --eval "${scriptContent}"`;

    if (verbose) {
      console.log(`Executing script: ${fullPath}`);
      console.log(`Command: ${dockerCommand}`);
    }

    const result = execSync(dockerCommand, {
      encoding: "utf8",
      stdio: verbose ? "inherit" : "pipe",
    });

    return result;
  } catch (error) {
    console.error("Error executing MongoDB script:", error.message);
    throw error;
  }
}

/**
 * Check if MongoDB container is running
 * @returns {boolean} True if container is running
 */
function isMongoContainerRunning() {
  try {
    execSync("docker-compose -f docker-compose.local.yml ps -q mongodb", {
      stdio: "pipe",
    });
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Start MongoDB container if not running
 */
function ensureMongoContainerRunning() {
  if (!isMongoContainerRunning()) {
    console.log("Starting MongoDB container...");
    execSync("docker-compose -f docker-compose.local.yml up -d mongodb", {
      stdio: "inherit",
    });

    // Wait for container to be ready
    console.log("Waiting for MongoDB to be ready...");
    execSync(
      "docker-compose -f docker-compose.local.yml exec mongodb mongosh --eval \"db.adminCommand('ping')\"",
      { stdio: "pipe" }
    );
    console.log("MongoDB is ready!");
  }
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(`
Usage: node scripts/mongo-exec.js <command> [options]

Commands:
  <mongo-command>     Execute a MongoDB command directly
  --script <path>     Execute a MongoDB script file
  --check             Check if MongoDB container is running
  --start             Start MongoDB container if not running

Examples:
  node scripts/mongo-exec.js "db.stats()"
  node scripts/mongo-exec.js "db.collections.find().count()"
  node scripts/mongo-exec.js --script scripts/drop-all-collections.js
  node scripts/mongo-exec.js --check
  node scripts/mongo-exec.js --start
    `);
    process.exit(1);
  }

  const command = args[0];

  if (command === "--check") {
    const isRunning = isMongoContainerRunning();
    console.log(
      `MongoDB container is ${isRunning ? "running" : "not running"}`
    );
    process.exit(isRunning ? 0 : 1);
  }

  if (command === "--start") {
    ensureMongoContainerRunning();
    process.exit(0);
  }

  if (command === "--script") {
    const scriptPath = args[1];
    if (!scriptPath) {
      console.error("Error: Script path is required");
      process.exit(1);
    }

    ensureMongoContainerRunning();
    executeMongoScript(scriptPath, "betfair_nlp_dev", true);
  } else {
    // Execute direct MongoDB command
    ensureMongoContainerRunning();
    executeMongoCommand(command, "betfair_nlp_dev", true);
  }
}

module.exports = {
  executeMongoCommand,
  executeMongoScript,
  isMongoContainerRunning,
  ensureMongoContainerRunning,
};
