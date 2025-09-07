import { DatabaseConnection } from "./config/database";
import { validateConfig, getAppEnvironment } from "./config";
import { MarketDefinitionDAO, PriceUpdateDAO } from "./lib/dao";
import { BetfairService } from "./lib/service/betfair-service";

async function main() {
  try {
    // Validate configuration before starting
    validateConfig();
    console.log(`Starting ${getAppEnvironment()} environment...`);

    const dbConnection = DatabaseConnection.getInstance();

    // Connect to MongoDB
    await dbConnection.connect();

    // Initialize DAOs
    const db = dbConnection.getDb();
    const marketDefinitionDAO = new MarketDefinitionDAO(db);
    const priceUpdateDAO = new PriceUpdateDAO(db);

    // Initialize service with DAOs
    const service = new BetfairService(marketDefinitionDAO, priceUpdateDAO);

    // Create database indexes
    await service.createIndexes();

    console.log("Betfair NLP application started successfully");
    console.log("Ready to process data files...");

    // Example: Process a specific file
    // await service.processDataFile("BASIC/2025/Jan/1/33858191/1.237066150");

    // Example: Get market analysis
    // const analysis = await service.getMarketAnalysis("1.237066150");
    // console.log("Market analysis:", analysis);
  } catch (error) {
    console.error("Application startup failed:", error);
    process.exit(1);
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

process.on("SIGTERM", async () => {
  console.log("\nReceived SIGTERM, shutting down...");
  try {
    await DatabaseConnection.getInstance().disconnect();
    process.exit(0);
  } catch (error) {
    console.error("Error during shutdown:", error);
    process.exit(1);
  }
});

// Start the application
main().catch(error => {
  console.error("Unhandled error:", error);
  process.exit(1);
});
