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

  async executeScript(script: string): Promise<MongoScriptResult> {
    const startTime = Date.now();

    try {
      console.log("🔍 Original script in executeScript:", JSON.stringify(script));
      const cleanedScript = this.cleanScript(script);
      console.log("🔍 Cleaned script in executeScript:", JSON.stringify(cleanedScript));

      if (!this.isScriptSafe(cleanedScript)) {
        return {
          success: false,
          error: "Script contains potentially dangerous operations",
          executionTime: Date.now() - startTime,
        };
      }

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

  private cleanScript(script: string): string {
    let cleaned = script
      .replace(/```javascript\n?/g, "")
      .replace(/```\n?/g, "");

    while (
      (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
      (cleaned.startsWith("'") && cleaned.endsWith("'"))
    ) {
      cleaned = cleaned.slice(1, -1).trim();
    }

    cleaned = cleaned.replace(/\\"/g, '"');
    cleaned = cleaned.replace(/\\'/g, "'");

    return cleaned;
  }

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
   * Executes the script using the live MongoDB driver connection — no mongosh required.
   * Builds a `db` proxy that maps shell-style expressions to driver calls,
   * then evaluates the script via AsyncFunction so await works naturally.
   */
  private async executeInContext(script: string): Promise<any> {
    try {
      const realDb = this.db;

      // Proxy each property access on `db` to the real collection
      const dbProxy = new Proxy(
        {},
        {
          get(_target, collectionName: string) {
            const coll = realDb.collection(collectionName);
            return {
              find: (filter: any = {}, options: any = {}) =>
                coll.find(filter, options),
              findOne: (filter: any = {}, options: any = {}) =>
                coll.findOne(filter, options),
              aggregate: (pipeline: any[]) => coll.aggregate(pipeline),
              countDocuments: (filter: any = {}) =>
                coll.countDocuments(filter),
              distinct: (field: string, filter: any = {}) =>
                coll.distinct(field, filter),
            };
          },
        }
      );

      // eslint-disable-next-line no-new-func
      const AsyncFunction = Object.getPrototypeOf(
        async function () {}
      ).constructor as new (...args: string[]) => (...a: any[]) => Promise<any>;

      const fn = new AsyncFunction("db", `return await (${script})`);
      let result = await fn(dbProxy);

      // If the script returned a cursor (find/aggregate without .toArray()), resolve it
      if (result != null && typeof result.toArray === "function") {
        result = await result.toArray();
      }

      if (result == null) return [];
      return Array.isArray(result) ? result : [result];
    } catch (error) {
      throw new Error(
        `Script execution error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

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
