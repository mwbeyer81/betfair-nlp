/**
 * MongoDB execution utility for running mongosh commands from Node.js on Mac
 * against MongoDB running in Docker container
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

export interface MongoExecOptions {
  database?: string;
  verbose?: boolean;
}

export class MongoExecutor {
  private containerName = "betfair-nlp-mongodb-local";
  private composeFile = "docker-compose.local.yml";

  /**
   * Execute a MongoDB command using docker exec
   */
  async executeCommand(
    command: string,
    options: MongoExecOptions = {}
  ): Promise<string> {
    const { database = "betfair_nlp_dev", verbose = false } = options;

    try {
      const dockerCommand = `docker-compose -f ${this.composeFile} exec -T mongodb mongosh ${database} --eval "${command}"`;

      if (verbose) {
        console.log(`Executing: ${dockerCommand}`);
      }

      const result = execSync(dockerCommand, {
        encoding: "utf8",
        stdio: verbose ? "inherit" : "pipe",
      });

      return result;
    } catch (error) {
      console.error("Error executing MongoDB command:", error);
      throw error;
    }
  }

  /**
   * Execute a MongoDB script file using docker exec
   */
  async executeScript(
    scriptPath: string,
    options: MongoExecOptions = {}
  ): Promise<string> {
    const { database = "betfair_nlp_dev", verbose = false } = options;

    try {
      const fullPath = path.resolve(scriptPath);

      if (!fs.existsSync(fullPath)) {
        throw new Error(`Script file not found: ${fullPath}`);
      }

      const scriptContent = fs.readFileSync(fullPath, "utf8");
      const dockerCommand = `docker-compose -f ${this.composeFile} exec -T mongodb mongosh ${database} --eval "${scriptContent}"`;

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
      console.error("Error executing MongoDB script:", error);
      throw error;
    }
  }

  /**
   * Check if MongoDB container is running
   */
  isContainerRunning(): boolean {
    try {
      execSync(`docker-compose -f ${this.composeFile} ps -q mongodb`, {
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
  async ensureContainerRunning(): Promise<void> {
    if (!this.isContainerRunning()) {
      console.log("Starting MongoDB container...");
      execSync(`docker-compose -f ${this.composeFile} up -d`, {
        stdio: "inherit",
      });

      // Wait for container to be ready
      console.log("Waiting for MongoDB to be ready...");
      try {
        execSync(
          `docker-compose -f ${this.composeFile} exec mongodb mongosh --eval "db.adminCommand('ping')"`,
          { stdio: "pipe" }
        );
        console.log("MongoDB is ready!");
      } catch (error) {
        console.log(
          "MongoDB container started but not yet ready. Please wait a moment and try again."
        );
      }
    }
  }

  /**
   * Get database statistics
   */
  async getDatabaseStats(database: string = "betfair_nlp_dev"): Promise<any> {
    const result = await this.executeCommand("db.stats()", { database });
    return this.parseMongoResult(result);
  }

  /**
   * List all collections in the database
   */
  async listCollections(
    database: string = "betfair_nlp_dev"
  ): Promise<string[]> {
    const result = await this.executeCommand(
      "db.runCommand({listCollections: 1}).cursor.firstBatch.map(c => c.name)",
      { database }
    );
    return this.parseMongoResult(result);
  }

  /**
   * Get collection count
   */
  async getCollectionCount(
    collection: string,
    database: string = "betfair_nlp_dev"
  ): Promise<number> {
    const result = await this.executeCommand(
      `db.${collection}.countDocuments()`,
      { database }
    );
    return this.parseMongoResult(result);
  }

  /**
   * Drop all collections in the database
   */
  async dropAllCollections(
    database: string = "betfair_nlp_dev"
  ): Promise<void> {
    const scriptPath = path.join(
      process.cwd(),
      "scripts",
      "drop-all-collections.js"
    );
    await this.executeScript(scriptPath, { database, verbose: true });
  }

  /**
   * Parse MongoDB result from mongosh output
   */
  private parseMongoResult(result: string): any {
    try {
      // Remove mongosh output formatting and extract JSON
      const lines = result.split("\n");
      const jsonLine = lines.find(
        line => line.trim().startsWith("{") || line.trim().startsWith("[")
      );

      if (jsonLine) {
        return JSON.parse(jsonLine.trim());
      }

      // If no JSON found, try to parse as number
      const numberMatch = result.match(/\d+/);
      if (numberMatch) {
        return parseInt(numberMatch[0], 10);
      }

      return result.trim();
    } catch (error) {
      return result.trim();
    }
  }
}

// Export a default instance
export const mongoExecutor = new MongoExecutor();
