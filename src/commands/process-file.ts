#!/usr/bin/env ts-node

import { DatabaseConnection } from "../config/database";
import { validateConfig, getAppEnvironment } from "../config";
import {
  MarketDefinitionDAO,
  PriceUpdateDAO,
  MarketStatusDAO,
} from "../lib/dao";
import { BetfairService } from "../lib/service/betfair-service";

async function processFile() {
  const filePath = process.argv[2];

  if (!filePath) {
    console.error("Usage: yarn process:file <file-path>");
    console.error(
      "Example: yarn process:file 'BASIC/2025/Feb/1/33928245/1.237066150.jsonl'"
    );
    process.exit(1);
  }

  try {
    // Validate configuration before starting
    validateConfig();
    console.log(`Starting ${getAppEnvironment()} environment...`);

    const dbConnection = DatabaseConnection.getInstance();

    // Connect to MongoDB
    await dbConnection.connect();
    console.log("Connected to MongoDB");

    // Initialize DAOs
    const db = dbConnection.getDb();
    const marketDefinitionDAO = new MarketDefinitionDAO(db);
    const priceUpdateDAO = new PriceUpdateDAO(db);
    const marketStatusDAO = new MarketStatusDAO(db);

    // Initialize service with DAOs
    const service = new BetfairService(
      marketDefinitionDAO,
      priceUpdateDAO,
      marketStatusDAO
    );

    // Create database indexes
    await service.createIndexes();
    console.log("Database indexes created");

    // Process the file
    console.log(`Processing file: ${filePath}`);
    const startTime = Date.now();

    await service.processDataFile(filePath);

    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;

    console.log(
      `✅ File processing completed in ${duration.toFixed(2)} seconds`
    );
  } catch (error) {
    console.error("❌ File processing failed:", error);
    process.exit(1);
  } finally {
    try {
      await DatabaseConnection.getInstance().disconnect();
      console.log("Disconnected from MongoDB");
    } catch (error) {
      console.error("Error during disconnect:", error);
    }
  }
}

// Handle graceful shutdown
process.on("SIGINT", async () => {
  console.log("\nShutting down gracefully...");
  try {
    await DatabaseConnection.getInstance().disconnect();
    process.exit(0);
  } catch (error) {
    console.error("Error during shutdown:", error);
    process.exit(1);
  }
});

// Start processing
processFile().catch(error => {
  console.error("Unhandled error:", error);
  process.exit(1);
});
