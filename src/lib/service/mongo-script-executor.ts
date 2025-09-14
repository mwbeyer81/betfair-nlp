import { Db } from "mongodb";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export interface MongoScriptResult {
  success: boolean;
  data?: any[];
  error?: string;
  executionTime?: number;
}

export class MongoScriptExecutor {
  private db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  /**
   * Executes a MongoDB script and returns the results
   */
  async executeScript(script: string): Promise<MongoScriptResult> {
    const startTime = Date.now();

    try {
      // Clean the script
      console.log(
        "🔍 Original script in executeScript:",
        JSON.stringify(script)
      );
      const cleanedScript = this.cleanScript(script);
      console.log(
        "🔍 Cleaned script in executeScript:",
        JSON.stringify(cleanedScript)
      );

      // Validate the script for security
      if (!this.isScriptSafe(cleanedScript)) {
        return {
          success: false,
          error: "Script contains potentially dangerous operations",
          executionTime: Date.now() - startTime,
        };
      }

      // Execute the script
      const result = await this.executeInContext(cleanedScript);

      return {
        success: true,
        data: Array.isArray(result) ? result : [result],
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        executionTime: Date.now() - startTime,
      };
    }
  }

  /**
   * Cleans the script by removing markdown code blocks and fixing quotes
   */
  private cleanScript(script: string): string {
    // Remove markdown code blocks
    let cleaned = script
      .replace(/```javascript\n?/g, "")
      .replace(/```\n?/g, "");

    // Remove outer quotes if present (handle both single and double quotes)
    // Keep removing quotes until none are left
    while (
      (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
      (cleaned.startsWith("'") && cleaned.endsWith("'"))
    ) {
      cleaned = cleaned.slice(1, -1).trim();
    }

    // Unescape inner quotes
    cleaned = cleaned.replace(/\\"/g, '"');
    cleaned = cleaned.replace(/\\'/g, "'");

    return cleaned;
  }

  /**
   * Validates that the script doesn't contain dangerous operations
   */
  private isScriptSafe(script: string): boolean {
    const dangerousPatterns = [
      /drop\s+database/i,
      /drop\s+collection/i,
      /remove\s*\(\s*\{\s*\}\s*\)/i,
      /deleteMany\s*\(\s*\{\s*\}\s*\)/i,
      /system\./i,
      /admin\./i,
      /eval\s*\(/i,
      /__proto__/i,
      /constructor/i,
    ];

    return !dangerousPatterns.some(pattern => pattern.test(script));
  }

  /**
   * Executes the MongoDB shell script using mongosh
   */
  private async executeInContext(script: string): Promise<any> {
    try {
      // Get the database name from the connection
      const dbName = this.db.databaseName;
      // Use localhost for local development (MongoDB running in Docker, Node.js on Mac)
      const mongoUri = `mongodb://localhost:27017/${dbName}`;

      // Create a temporary script file
      const fs = require("fs");
      const path = require("path");
      const os = require("os");

      const tempDir = os.tmpdir();
      const scriptPath = path.join(tempDir, `mongo-script-${Date.now()}.js`);

      // Script is already cleaned in executeScript method
      console.log("🔍 Script to write to file:", JSON.stringify(script));
      fs.writeFileSync(scriptPath, script);

      try {
        // Execute the script using mongosh with --eval and cat
        const command = `mongosh "${mongoUri}" --eval "$(cat "${scriptPath}")"`;
        const { stdout, stderr } = await execAsync(command);

        // Clean up the temporary file
        fs.unlinkSync(scriptPath);

        if (stderr) {
          console.error("MongoDB stderr:", stderr);
        }

        // Parse the output to extract the results
        const lines = stdout.split("\n");
        const resultLines = lines.filter(
          line =>
            line.trim() &&
            !line.includes("Current Mongosh Log ID:") &&
            !line.includes("Connecting to:") &&
            !line.includes("Using MongoDB:") &&
            !line.includes("Using Mongosh:") &&
            !line.includes("For mongosh info see:") &&
            !line.includes("To help improve our products,") &&
            !line.includes(
              "The server generated these startup warnings when booting:"
            ) &&
            !line.includes("---") &&
            !line.startsWith(">") &&
            !line.startsWith("...")
        );

        // Join all result lines and convert MongoDB format to valid JSON
        const resultText = resultLines.join("\n").trim();

        try {
          // Convert MongoDB output format to valid JSON
          let jsonText = resultText
            // Replace single quotes with double quotes
            .replace(/'/g, '"')
            // Add quotes around property names (but not around values that are already quoted)
            .replace(/(\w+):/g, '"$1":')
            // Fix any double quotes that got doubled up
            .replace(/""/g, '"');

          // Try to parse the converted JSON
          const parsed = JSON.parse(jsonText);
          return Array.isArray(parsed) ? parsed : [parsed];
        } catch (e) {
          // If parsing as complete JSON fails, try line by line
          const results = [];
          for (const line of resultLines) {
            try {
              const parsed = JSON.parse(line);
              results.push(parsed);
            } catch (lineError) {
              // If it's not JSON, just add as string
              if (line.trim()) {
                results.push(line.trim());
              }
            }
          }
          return results.length > 0 ? results : null;
        }
      } catch (execError) {
        // Clean up the temporary file even if there's an error
        try {
          fs.unlinkSync(scriptPath);
        } catch (cleanupError) {
          // Ignore cleanup errors
        }
        throw execError;
      }
    } catch (error) {
      throw new Error(
        `Script execution error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Executes a simple find query (for backward compatibility)
   */
  async executeFindQuery(
    collection: string,
    filter: any = {},
    options: any = {}
  ): Promise<MongoScriptResult> {
    const startTime = Date.now();

    try {
      const result = await this.db
        .collection(collection)
        .find(filter, options)
        .toArray();

      return {
        success: true,
        data: result,
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        executionTime: Date.now() - startTime,
      };
    }
  }

  /**
   * Executes an aggregation pipeline (for backward compatibility)
   */
  async executeAggregation(
    collection: string,
    pipeline: any[]
  ): Promise<MongoScriptResult> {
    const startTime = Date.now();

    try {
      const result = await this.db
        .collection(collection)
        .aggregate(pipeline)
        .toArray();

      return {
        success: true,
        data: result,
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        executionTime: Date.now() - startTime,
      };
    }
  }
}
