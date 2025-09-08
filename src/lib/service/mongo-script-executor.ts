import { Db } from "mongodb";

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
   * Executes a MongoDB JavaScript script
   * @param script The JavaScript script to execute
   * @returns Promise<MongoScriptResult>
   */
  async executeScript(script: string): Promise<MongoScriptResult> {
    const startTime = Date.now();

    try {
      // Clean the script - remove any markdown code blocks
      const cleanScript = this.cleanScript(script);

      // Validate the script
      if (!this.isValidScript(cleanScript)) {
        return {
          success: false,
          error: "Invalid MongoDB script format",
          executionTime: Date.now() - startTime,
        };
      }

      // Execute the script using eval in a controlled environment
      const result = await this.executeInContext(cleanScript);

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
   * Cleans the script by removing markdown code blocks and extra whitespace
   */
  private cleanScript(script: string): string {
    // Remove markdown code blocks
    const codeBlockRegex = /```(?:javascript|js|mongo)?\s*\n([\s\S]*?)\n```/;
    const match = script.match(codeBlockRegex);

    if (match && match[1]) {
      return match[1].trim();
    }

    return script.trim();
  }

  /**
   * Validates that the script is a valid MongoDB JavaScript script
   */
  private isValidScript(script: string): boolean {
    // Basic validation - should contain db. references
    if (!script.includes("db.")) {
      return false;
    }

    // Should not contain dangerous operations
    const dangerousPatterns = [
      /db\.dropDatabase/,
      /db\.dropCollection/,
      /db\.createCollection/,
      /db\.admin/,
      /db\.system/,
      /eval\s*\(/,
      /Function\s*\(/,
      /setTimeout/,
      /setInterval/,
      /require\s*\(/,
      /import\s+/,
      /process\./,
      /global\./,
      /__dirname/,
      /__filename/,
    ];

    return !dangerousPatterns.some(pattern => pattern.test(script));
  }

  /**
   * Executes the script in a controlled context with access to the db object
   */
  private async executeInContext(script: string): Promise<any> {
    // Create a safe execution context
    const context = {
      db: this.db,
      // Add any other safe globals that might be needed
      print: console.log,
      printjson: (obj: any) => console.log(JSON.stringify(obj, null, 2)),
    };

    // Create a function that executes the script
    const executeFunction = new Function(
      "db",
      "print",
      "printjson",
      `
      try {
        return ${script};
      } catch (error) {
        throw new Error('Script execution error: ' + error.message);
      }
      `
    );

    // Execute the function with the context
    return await executeFunction.call(
      context,
      context.db,
      context.print,
      context.printjson
    );
  }

  /**
   * Executes a simple find query (for backward compatibility)
   */
  async executeFindQuery(
    collection: string,
    filter: any = {},
    options: any = {}
  ): Promise<MongoScriptResult> {
    const script = this.buildFindScript(collection, filter, options);
    return this.executeScript(script);
  }

  /**
   * Executes an aggregation pipeline (for backward compatibility)
   */
  async executeAggregation(
    collection: string,
    pipeline: any[]
  ): Promise<MongoScriptResult> {
    const script = this.buildAggregationScript(collection, pipeline);
    return this.executeScript(script);
  }

  /**
   * Builds a find script from parameters
   */
  private buildFindScript(
    collection: string,
    filter: any,
    options: any
  ): string {
    let script = `db.${collection}.find(${JSON.stringify(filter)}`;

    if (options.projection) {
      script += `, ${JSON.stringify(options.projection)}`;
    }

    script += ")";

    if (options.sort) {
      script += `.sort(${JSON.stringify(options.sort)})`;
    }

    if (options.limit) {
      script += `.limit(${options.limit})`;
    }

    if (options.skip) {
      script += `.skip(${options.skip})`;
    }

    return script;
  }

  /**
   * Builds an aggregation script from parameters
   */
  private buildAggregationScript(collection: string, pipeline: any[]): string {
    return `db.${collection}.aggregate(${JSON.stringify(pipeline)})`;
  }
}
