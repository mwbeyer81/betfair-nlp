import { MongoScriptExecutor } from "../mongo-script-executor";
import { Db, Collection } from "mongodb";

// Mock MongoDB
const mockCollection = {
  find: jest.fn(),
  findOne: jest.fn(),
  aggregate: jest.fn(),
} as any;

const mockDb = {
  collection: jest.fn().mockReturnValue(mockCollection),
} as any;

describe("MongoScriptExecutor", () => {
  let executor: MongoScriptExecutor;

  beforeEach(() => {
    jest.clearAllMocks();
    executor = new MongoScriptExecutor(mockDb);
  });

  describe("executeScript", () => {
    it("should execute a simple find script successfully", async () => {
      const mockResults = [{ _id: "1", name: "Test Horse" }];
      const mockCursor = {
        toArray: jest.fn().mockResolvedValue(mockResults),
      };
      mockCollection.find.mockReturnValue(mockCursor);

      const script = 'db.test.find({"name": "Test Horse"})';
      const result = await executor.executeScript(script);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockResults);
      expect(result.error).toBeUndefined();
      expect(result.executionTime).toBeGreaterThan(0);
    });

    it("should execute a script with projection", async () => {
      const mockResults = [{ name: "Test Horse" }];
      const mockCursor = {
        toArray: jest.fn().mockResolvedValue(mockResults),
      };
      mockCollection.find.mockReturnValue(mockCursor);

      const script =
        'db.test.find({"name": "Test Horse"}, {"name": 1, "_id": 0})';
      const result = await executor.executeScript(script);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockResults);
    });

    it("should execute a script with sorting and limiting", async () => {
      const mockResults = [{ _id: "1", name: "Test Horse" }];
      const mockCursor = {
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockResolvedValue(mockResults),
      };
      mockCollection.find.mockReturnValue(mockCursor);

      const script = 'db.test.find({}).sort({"name": 1}).limit(10)';
      const result = await executor.executeScript(script);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockResults);
      expect(mockCursor.sort).toHaveBeenCalledWith({ name: 1 });
      expect(mockCursor.limit).toHaveBeenCalledWith(10);
    });

    it("should execute an aggregation script", async () => {
      const mockResults = [{ _id: "group1", count: 5 }];
      const mockCursor = {
        toArray: jest.fn().mockResolvedValue(mockResults),
      };
      mockCollection.aggregate.mockReturnValue(mockCursor);

      const script =
        'db.test.aggregate([{"$group": {"_id": "$category", "count": {"$sum": 1}}}])';
      const result = await executor.executeScript(script);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockResults);
    });

    it("should handle scripts with variables and multiple operations", async () => {
      const mockResults = [{ _id: "1", name: "Test Horse" }];
      const mockCursor = {
        toArray: jest.fn().mockResolvedValue(mockResults),
      };
      mockCollection.find.mockReturnValue(mockCursor);

      const script = `
        var horseName = "Test Horse";
        db.test.find({"name": horseName})
      `;
      const result = await executor.executeScript(script);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockResults);
    });

    it("should clean markdown code blocks from scripts", async () => {
      const mockResults = [{ _id: "1", name: "Test Horse" }];
      const mockCursor = {
        toArray: jest.fn().mockResolvedValue(mockResults),
      };
      mockCollection.find.mockReturnValue(mockCursor);

      const script = `
        \`\`\`javascript
        db.test.find({"name": "Test Horse"})
        \`\`\`
      `;
      const result = await executor.executeScript(script);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockResults);
    });

    it("should reject dangerous scripts", async () => {
      const dangerousScripts = [
        "db.dropDatabase()",
        'db.dropCollection("test")',
        'db.createCollection("test")',
        'db.admin.command("ping")',
        'eval("malicious code")',
        'require("fs")',
        "process.exit()",
        "global.process.exit()",
      ];

      for (const script of dangerousScripts) {
        const result = await executor.executeScript(script);
        expect(result.success).toBe(false);
        expect(result.error).toBe("Invalid MongoDB script format");
      }
    });

    it("should handle script execution errors gracefully", async () => {
      mockCollection.find.mockImplementation(() => {
        throw new Error("Database connection failed");
      });

      const script = "db.test.find({})";
      const result = await executor.executeScript(script);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Database connection failed");
    });

    it("should handle invalid script syntax", async () => {
      const script = "db.test.find({invalid syntax}";
      const result = await executor.executeScript(script);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should reject scripts without db references", async () => {
      const script = 'console.log("Hello World")';
      const result = await executor.executeScript(script);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Invalid MongoDB script format");
    });
  });

  describe("executeFindQuery", () => {
    it("should build and execute a find query", async () => {
      const mockResults = [{ _id: "1", name: "Test Horse" }];
      const mockCursor = {
        toArray: jest.fn().mockResolvedValue(mockResults),
      };
      mockCollection.find.mockReturnValue(mockCursor);

      const result = await executor.executeFindQuery(
        "test",
        { name: "Test Horse" },
        { projection: { name: 1 }, sort: { name: 1 }, limit: 10 }
      );

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockResults);
    });
  });

  describe("executeAggregation", () => {
    it("should build and execute an aggregation", async () => {
      const mockResults = [{ _id: "group1", count: 5 }];
      const mockCursor = {
        toArray: jest.fn().mockResolvedValue(mockResults),
      };
      mockCollection.aggregate.mockReturnValue(mockCursor);

      const pipeline = [{ $group: { _id: "$category", count: { $sum: 1 } } }];
      const result = await executor.executeAggregation("test", pipeline);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockResults);
    });
  });
});
