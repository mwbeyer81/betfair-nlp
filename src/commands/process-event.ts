#!/usr/bin/env ts-node

import { readdir, stat } from "fs/promises";
import { join } from "path";
import { DatabaseConnection } from "../config/database";
import { validateConfig, getAppEnvironment } from "../config";
import { MarketDefinitionDAO, PriceUpdateDAO } from "../lib/dao";
import { BetfairService } from "../lib/service/betfair-service";

async function processEvent() {
  const eventId = process.argv[2];

  if (!eventId) {
    console.error("Usage: yarn process:event <event-id>");
    console.error("Example: yarn process:event '33928245'");
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

    // Initialize service with DAOs
    const service = new BetfairService(marketDefinitionDAO, priceUpdateDAO);

    // Create database indexes
    await service.createIndexes();
    console.log("Database indexes created");

    // Find all files for the event
    console.log(`🔍 Searching for files with event ID: ${eventId}`);
    const files = await findEventFiles(eventId);

    if (files.length === 0) {
      console.log(`No files found for event ID: ${eventId}`);
      return;
    }

    console.log(`📁 Found ${files.length} files for event ${eventId}`);

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

    console.log(`\n🎉 Event processing completed!`);
    console.log(`📊 Summary for event ${eventId}:`);
    console.log(`   - Total files: ${files.length}`);
    console.log(`   - Successfully processed: ${processedCount}`);
    console.log(`   - Errors: ${errorCount}`);
    console.log(`   - Duration: ${duration.toFixed(2)} seconds`);
    console.log(
      `   - Average: ${(duration / processedCount).toFixed(2)} seconds per file`
    );

    // Get event summary
    try {
      const eventSummary = await service.getEventSummary(eventId);
      console.log(`\n📈 Event Summary:`);
      console.log(`   - Event Name: ${eventSummary.eventName}`);
      console.log(`   - Markets: ${eventSummary.markets.length}`);
      console.log(`   - Total Runners: ${eventSummary.totalRunners}`);
      console.log(`   - Active Markets: ${eventSummary.activeMarkets}`);
      console.log(`   - Suspended Markets: ${eventSummary.suspendedMarkets}`);
      console.log(`   - Closed Markets: ${eventSummary.closedMarkets}`);
    } catch (error) {
      console.error("Could not retrieve event summary:", error);
    }
  } catch (error) {
    console.error("❌ Event processing failed:", error);
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

async function findEventFiles(eventId: string): Promise<string[]> {
  const files: string[] = [];
  const basicDir = "BASIC";

  try {
    // Search through year directories
    const years = await readdir(basicDir);

    for (const year of years) {
      if (year.match(/^\d{4}$/)) {
        const yearPath = join(basicDir, year);

        // Search through month directories
        const months = await readdir(yearPath);

        for (const month of months) {
          const monthPath = join(yearPath, month);

          // Search through day directories
          const days = await readdir(monthPath);

          for (const day of days) {
            const dayPath = join(monthPath, day);

            // Search through event directories
            const events = await readdir(dayPath);

            for (const event of events) {
              if (event === eventId) {
                const eventPath = join(dayPath, event);

                // Get all .bz2 files in this event directory
                const eventFiles = await readdir(eventPath);

                for (const file of eventFiles) {
                  if (file.endsWith(".jsonl") || file.endsWith(".json")) {
                    files.push(join(eventPath, file));
                  }
                }
              }
            }
          }
        }
      }
    }
  } catch (error) {
    console.error(`Error searching for event files:`, error);
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
processEvent().catch(error => {
  console.error("Unhandled error:", error);
  process.exit(1);
});
