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
          error:
            "Only read-only find/findOne/aggregate/countDocuments/distinct queries are allowed",
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

  // Allowlist-first: the script must be a SINGLE expression whose leading
  // call is one of these 5 read-only methods — exactly the 5 the `dbProxy`
  // below implements. This is deliberately not a blocklist: a blocklist only
  // has to miss one dangerous spelling (e.g. `dropDatabase()` with no space,
  // or a non-empty-filter `deleteMany`) to let it through, whereas an
  // allowlist rejects everything by default and only lets through what's
  // explicitly recognized as safe.
  private static readonly ALLOWED_LEADING_CALL =
    /^db\.[A-Za-z_][A-Za-z0-9_]*\.(find|findOne|aggregate|countDocuments|distinct)\s*\(/;

  // Defense in depth in case the proxy or the allowed-method list ever
  // changes: even a script that matches the leading pattern above is
  // rejected if it also contains any of these, whole-word (so field names
  // like "updatedAt" aren't caught). Includes MongoDB's own server-side JS
  // execution operators (`$where`/`$function`/`$accumulator`) and the
  // write-capable aggregation stages (`$merge`/`$out`) — both are ways to
  // smuggle a write or arbitrary code execution inside an otherwise
  // "read-only" find/aggregate call.
  private static readonly FORBIDDEN_KEYWORDS = [
    "update",
    "delete",
    "remove",
    "insert",
    "drop",
    "rename",
    "create",
    "bulkWrite",
    "replaceOne",
    "findAndModify",
    "findOneAndUpdate",
    "findOneAndDelete",
    "findOneAndReplace",
    "mapReduce",
    "require",
    "process",
    "global",
    "import",
    "Function",
    "constructor",
    "__proto__",
    "eval",
  ];
  private static readonly FORBIDDEN_SUBSTRINGS = [
    "$where",
    "$function",
    "$accumulator",
    "$merge",
    "$out",
  ];

  private isScriptSafe(script: string): boolean {
    // cleanScript() can leave surrounding whitespace/newlines (e.g. after
    // stripping a markdown code fence) — the leading-call check must anchor
    // to the first real character, not column 0 of the raw string.
    const trimmed = script.trim();
    if (!MongoScriptExecutor.ALLOWED_LEADING_CALL.test(trimmed)) {
      return false;
    }

    // Reject a trailing `;` followed by more code — closes off chaining a
    // second (potentially destructive) statement after a valid-looking read.
    if (/;\s*\S/.test(script)) {
      return false;
    }

    // No legitimate query needs a template literal/backtick — reject
    // outright rather than try to reason about `${...}` expression injection.
    if (script.includes("`")) {
      return false;
    }

    const hasForbiddenKeyword = MongoScriptExecutor.FORBIDDEN_KEYWORDS.some(
      keyword => new RegExp(`\\b${keyword}\\b`, "i").test(script)
    );
    if (hasForbiddenKeyword) return false;

    const hasForbiddenSubstring = MongoScriptExecutor.FORBIDDEN_SUBSTRINGS.some(
      substring => script.toLowerCase().includes(substring.toLowerCase())
    );
    if (hasForbiddenSubstring) return false;

    return true;
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
