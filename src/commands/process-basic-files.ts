#!/usr/bin/env ts-node

import { readdir, stat } from "fs/promises";
import { join } from "path";
import { DatabaseConnection } from "../config/database";
import { validateConfig, getAppEnvironment } from "../config";
import { BetfairService } from "../lib/service/betfair-service";

const CONCURRENCY = parseInt(process.env.WORKERS || "8", 10);

async function processBasicFiles() {
  const inputPath = process.argv[2] || "BASIC/2025/Jan/1/33858191";

  try {
    validateConfig();
    console.log(`Starting ${getAppEnvironment()} environment...`);
    console.log(`Workers: ${CONCURRENCY}`);

    const dbConnection = DatabaseConnection.getInstance();
    await dbConnection.connect();
    console.log("Connected to MongoDB");

    const bspOnly = process.env.BSP_ONLY !== "false";
    console.log(`BSP-only mode: ${bspOnly}`);
    const service = new BetfairService(undefined, undefined, bspOnly);
    await service.initialize();
    console.log("Database indexes created");

    const db = dbConnection.getDb();
    const progressCol = db.collection("import_progress");
    await progressCol.createIndex({ filePath: 1 }, { unique: true });

    const stats = await stat(inputPath);
    let files: string[] = [];

    if (stats.isFile()) {
      if (inputPath.endsWith(".bz2") || inputPath.split("/").pop()?.startsWith(".")) {
        console.log("❌ File is not processable (compressed or hidden)");
        return;
      }
      files = [inputPath];
      console.log(`📄 Processing single file: ${inputPath}`);
    } else if (stats.isDirectory()) {
      console.log(`📁 Scanning directory: ${inputPath}`);
      files = await findProcessableFiles(inputPath);
      if (files.length === 0) {
        console.log("No processable files found in directory");
        return;
      }
      console.log(`Found ${files.length} files to process`);
    } else {
      console.log("❌ Input path is neither a file nor a directory");
      return;
    }

    // Resume: skip already-processed files
    const alreadyDone = await progressCol.countDocuments();
    if (alreadyDone > 0) {
      console.log(`🔄 Resume mode: ${alreadyDone} files already processed, loading skip list...`);
      const processedDocs = await progressCol
        .find({}, { projection: { filePath: 1, _id: 0 } })
        .toArray();
      const processedSet = new Set(processedDocs.map((d: any) => d.filePath));
      const before = files.length;
      files = files.filter(f => !processedSet.has(f));
      console.log(`⏩ Skipping ${before - files.length} files, ${files.length} remaining`);
    }

    if (files.length === 0) {
      console.log("✅ All files already processed");
      return;
    }

    // Parallel worker pool
    const startTime = Date.now();
    let completedCount = 0;
    let errorCount = 0;
    const total = files.length;
    let idx = 0;

    async function worker(workerId: number) {
      while (true) {
        const fileIdx = idx++;
        if (fileIdx >= files.length) break;
        const file = files[fileIdx];
        try {
          await service.processDataFile(file);
          try {
            await progressCol.insertOne({ filePath: file, processedAt: new Date() });
          } catch {
            // duplicate key — already processed by another worker, safe to ignore
          }
          completedCount++;
          if (completedCount % 500 === 0 || completedCount === total) {
            const pct = ((completedCount / total) * 100).toFixed(1);
            const elapsed = (Date.now() - startTime) / 1000;
            const rate = completedCount / elapsed;
            const remaining = Math.round((total - completedCount) / rate);
            console.log(`✅ [${pct}%] ${completedCount}/${total} — ~${Math.round(remaining / 60)}min left`);
          }
        } catch (error) {
          console.error(`❌ [W${workerId}] Failed: ${file}`, error);
          errorCount++;
        }
      }
    }

    console.log(`\n🚀 Starting parallel import with ${CONCURRENCY} workers...`);
    await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i + 1)));

    const duration = (Date.now() - startTime) / 1000;
    console.log(`\n🎉 File processing completed!`);
    console.log(`   Total: ${total} | Done: ${completedCount} | Errors: ${errorCount} | Time: ${duration.toFixed(0)}s`);
  } catch (error) {
    console.error("❌ File processing failed:", error);
    process.exit(1);
  } finally {
    try {
      await DatabaseConnection.getInstance().disconnect();
    } catch {}
  }
}

async function findProcessableFiles(rootPath: string): Promise<string[]> {
  const files: string[] = [];
  const queue: string[] = [rootPath];

  while (queue.length > 0) {
    const dirPath = queue.shift()!;
    try {
      const items = await readdir(dirPath);
      for (const item of items) {
        const fullPath = join(dirPath, item);
        const stats = await stat(fullPath);
        if (stats.isDirectory()) {
          queue.push(fullPath);
        } else if (stats.isFile() && !item.endsWith(".bz2") && !item.startsWith(".")) {
          files.push(fullPath);
        }
      }
    } catch (error) {
      console.error(`Error reading directory ${dirPath}:`, error);
    }
  }

  return files;
}

process.on("SIGINT", async () => {
  console.log("\n⚠️  Interrupted — progress saved, restart to resume from this point");
  try {
    await DatabaseConnection.getInstance().disconnect();
  } catch {}
  process.exit(0);
});

processBasicFiles().catch(error => {
  console.error("Unhandled error:", error);
  process.exit(1);
});
