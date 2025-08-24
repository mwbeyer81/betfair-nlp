#!/usr/bin/env ts-node

import { readdir, stat } from "fs/promises";
import { join } from "path";
import { DatabaseConnection } from "../config/database";
import { validateConfig, getAppEnvironment } from "../config";
import {
  MarketDefinitionDAO,
  PriceUpdateDAO,
  MarketStatusDAO,
} from "../lib/dao";
import { BetfairService } from "../lib/service/betfair-service";

async function processDirectory() {
  const directoryPath = process.argv[2];

  if (!directoryPath) {
    console.error("Usage: yarn process:directory <directory-path>");
    console.error(
      "Example: yarn process:directory 'BASIC/2025/Feb/1/33928245'"
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

    // Find all JSONL files in the directory
    console.log(`Scanning directory: ${directoryPath}`);
    const files = await findJsonlFiles(directoryPath);

    if (files.length === 0) {
      console.log("No JSONL files found in directory");
      return;
    }

    console.log(`Found ${files.length} JSONL files to process`);

    // Process files
    const startTime = Date.now();
    let processedCount = 0;
    let errorCount = 0;

    for (const file of files) {
      try {
        console.log(
          `\n📁 Processing file ${processedCount + 1}/${files.length}: ${file}`
        );
        await service.processDataFile(file);
        processedCount++;
        console.log(`✅ Successfully processed: ${file}`);
      } catch (error) {
        console.error(`❌ Failed to process ${file}:`, error);
        errorCount++;
      }
    }

    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;

    console.log(`\n🎉 Directory processing completed!`);
    console.log(`📊 Summary:`);
    console.log(`   - Total files: ${files.length}`);
    console.log(`   - Successfully processed: ${processedCount}`);
    console.log(`   - Errors: ${errorCount}`);
    console.log(`   - Duration: ${duration.toFixed(2)} seconds`);
    console.log(
      `   - Average: ${(duration / processedCount).toFixed(2)} seconds per file`
    );
  } catch (error) {
    console.error("❌ Directory processing failed:", error);
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

async function findJsonlFiles(directoryPath: string): Promise<string[]> {
  const files: string[] = [];

  try {
    const items = await readdir(directoryPath);

    for (const item of items) {
      const fullPath = join(directoryPath, item);
      const stats = await stat(fullPath);

      if (stats.isDirectory()) {
        // Recursively search subdirectories
        const subFiles = await findJsonlFiles(fullPath);
        files.push(...subFiles);
      } else if (
        stats.isFile() &&
        (item.endsWith(".jsonl") || item.endsWith(".json"))
      ) {
        // Add JSONL/JSON files
        files.push(fullPath);
      }
    }
  } catch (error) {
    console.error(`Error reading directory ${directoryPath}:`, error);
  }

  return files;
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
processDirectory().catch(error => {
  console.error("Unhandled error:", error);
  process.exit(1);
});
