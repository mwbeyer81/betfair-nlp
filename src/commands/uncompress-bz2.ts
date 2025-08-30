#!/usr/bin/env ts-node

import { readdir, stat } from "fs/promises";
import { join } from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

async function uncompressBz2Files() {
  const directoryPath = process.argv[2];

  if (!directoryPath) {
    console.error("Usage: yarn uncompress:bz2 <directory-path>");
    console.error("Example: yarn uncompress:bz2 'BASIC/2025/Feb/2'");
    process.exit(1);
  }

  try {
    console.log(`🔍 Scanning directory: ${directoryPath}`);

    // Check if directory exists
    try {
      await stat(directoryPath);
    } catch (error) {
      console.error(`❌ Directory not found: ${directoryPath}`);
      process.exit(1);
    }

    // Find all .bz2 files
    const bz2Files = await findBz2Files(directoryPath);

    if (bz2Files.length === 0) {
      console.log("✅ No .bz2 files found in directory");
      return;
    }

    console.log(`📁 Found ${bz2Files.length} .bz2 files to uncompress`);

    // Uncompress files
    const startTime = Date.now();
    let successCount = 0;
    let errorCount = 0;

    for (const file of bz2Files) {
      try {
        console.log(`\n📦 Uncompressing: ${file}`);
        await execAsync(`bunzip2 -v "${file}"`);
        successCount++;
        console.log(`✅ Successfully uncompressed: ${file}`);
      } catch (error) {
        console.error(`❌ Failed to uncompress ${file}:`, error);
        errorCount++;
      }
    }

    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;

    console.log(`\n🎉 Uncompression completed!`);
    console.log(`📊 Summary:`);
    console.log(`   ✅ Successfully uncompressed: ${successCount}`);
    console.log(`   ❌ Failed: ${errorCount}`);
    console.log(`   ⏱️  Total time: ${duration.toFixed(2)} seconds`);
  } catch (error) {
    console.error("❌ Uncompression process failed:", error);
    process.exit(1);
  }
}

async function findBz2Files(directoryPath: string): Promise<string[]> {
  const files: string[] = [];

  try {
    const items = await readdir(directoryPath);

    for (const item of items) {
      const fullPath = join(directoryPath, item);
      const stats = await stat(fullPath);

      if (stats.isDirectory()) {
        // Recursively search subdirectories
        const subFiles = await findBz2Files(fullPath);
        files.push(...subFiles);
      } else if (stats.isFile() && item.endsWith(".bz2")) {
        // Add .bz2 files
        files.push(fullPath);
      }
    }
  } catch (error) {
    console.error(`Error reading directory ${directoryPath}:`, error);
  }

  return files;
}

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("\n⚠️  Process interrupted by user");
  process.exit(0);
});

// Run the main function
uncompressBz2Files().catch(error => {
  console.error("❌ Unexpected error:", error);
  process.exit(1);
});
