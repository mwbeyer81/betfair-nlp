#!/usr/bin/env ts-node

/**
 * Test script to demonstrate MongoDB execution from Node.js on Mac
 * against MongoDB running in Docker container
 */

import { mongoExecutor } from "../src/lib/service/mongo-exec";

async function testMongoExecution() {
  try {
    console.log("🚀 Testing MongoDB execution from Node.js on Mac...\n");

    // Ensure MongoDB container is running
    console.log("1. Checking MongoDB container status...");
    const isRunning = mongoExecutor.isContainerRunning();
    console.log(
      `   MongoDB container is ${isRunning ? "running" : "not running"}`
    );

    if (!isRunning) {
      console.log("   Starting MongoDB container...");
      await mongoExecutor.ensureContainerRunning();
    }

    // Test basic connection
    console.log("\n2. Testing basic connection...");
    const stats = await mongoExecutor.getDatabaseStats();
    console.log("   Database stats:", JSON.stringify(stats, null, 2));

    // List collections
    console.log("\n3. Listing collections...");
    const collections = await mongoExecutor.listCollections();
    console.log("   Collections:", collections);

    // Test custom command
    console.log("\n4. Testing custom MongoDB command...");
    const result = await mongoExecutor.executeCommand(
      "db.runCommand({ping: 1})",
      { verbose: true }
    );
    console.log("   Ping result:", result);

    // Test script execution
    console.log("\n5. Testing script execution...");
    await mongoExecutor.executeCommand(
      "db.test_collection.insertOne({name: 'test_document', timestamp: new Date(), value: 42})",
      { verbose: true }
    );

    const countResult = await mongoExecutor.executeCommand(
      "db.test_collection.find().count()",
      { verbose: true }
    );
    console.log("   Test collection count:", countResult);

    // Clean up test data
    console.log("\n6. Cleaning up test data...");
    await mongoExecutor.executeCommand("db.test_collection.drop()", {
      verbose: true,
    });
    console.log("   Test collection dropped");

    console.log("\n✅ All tests completed successfully!");
  } catch (error) {
    console.error("❌ Test failed:", error);
    process.exit(1);
  }
}

// Run the test
if (require.main === module) {
  testMongoExecution();
}
