#!/usr/bin/env ts-node

import { readdir, stat } from "fs/promises";
import { join } from "path";
import { DatabaseConnection } from "../config/database";
import { validateConfig, getAppEnvironment } from "../config";
import { BetfairService } from "../lib/service/betfair-service";

async function processBasicFiles() {
  const directoryPath = process.argv[2] || "BASIC/2025/Jan/1/33858191";

  try {
    // Validate configuration before starting
    validateConfig();
    console.log(`Starting ${getAppEnvironment()} environment...`);

    const dbConnection = DatabaseConnection.getInstance();

    // Connect to MongoDB
    await dbConnection.connect();
    console.log("Connected to MongoDB");

    // Initialize service
    const service = new BetfairService();

    // Create database indexes
    await service.initialize();
    console.log("Database indexes created");

    // Find all files in the directory (excluding .bz2 files)
    console.log(`Scanning directory: ${directoryPath}`);
    const files = await findProcessableFiles(directoryPath);

    if (files.length === 0) {
      console.log("No processable files found in directory");
      return;
    }

    console.log(
      `Found ${files.length} files to process (excluding .bz2 files)`
    );

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

    console.log(`\n🎉 File processing completed!`);
    console.log(`📊 Summary:`);
    console.log(`   - Total files: ${files.length}`);
    console.log(`   - Successfully processed: ${processedCount}`);
    console.log(`   - Errors: ${errorCount}`);
    console.log(`   - Duration: ${duration.toFixed(2)} seconds`);
    if (processedCount > 0) {
      console.log(
        `   - Average: ${(duration / processedCount).toFixed(2)} seconds per file`
      );
    }
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

async function findProcessableFiles(directoryPath: string): Promise<string[]> {
  const files: string[] = [];

  try {
    const items = await readdir(directoryPath);

    for (const item of items) {
      const fullPath = join(directoryPath, item);
      const stats = await stat(fullPath);

      if (stats.isDirectory()) {
        // Recursively search subdirectories
        const subFiles = await findProcessableFiles(fullPath);
        files.push(...subFiles);
      } else if (stats.isFile()) {
        // Include all files except .bz2 files
        if (!item.endsWith(".bz2") && !item.startsWith(".")) {
          files.push(fullPath);
        }
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
processBasicFiles().catch(error => {
  console.error("Unhandled error:", error);
  process.exit(1);
});
