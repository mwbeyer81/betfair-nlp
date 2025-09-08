import { NaturalLanguageService } from "../natural-language-service";
import { OpenAIClient } from "../openai-client";
import { MongoScriptExecutor } from "../mongo-script-executor";
import { Db } from "mongodb";

// Mock dependencies
jest.mock("../openai-client");
jest.mock("../mongo-script-executor");

const MockedOpenAIClient = OpenAIClient as jest.MockedClass<
  typeof OpenAIClient
>;
const MockedMongoScriptExecutor = MongoScriptExecutor as jest.MockedClass<
  typeof MongoScriptExecutor
>;

describe("NaturalLanguageService", () => {
  let service: NaturalLanguageService;
  let mockDb: jest.Mocked<Db>;
  let mockOpenAIClient: jest.Mocked<OpenAIClient>;
  let mockMongoScriptExecutor: jest.Mocked<MongoScriptExecutor>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock database
    mockDb = {} as jest.Mocked<Db>;

    // Mock OpenAI client
    mockOpenAIClient = {
      createHorseQueryResponse: jest.fn(),
    } as any;
    MockedOpenAIClient.mockImplementation(() => mockOpenAIClient);

    // Mock MongoDB script executor
    mockMongoScriptExecutor = {
      executeScript: jest.fn(),
    } as any;
    MockedMongoScriptExecutor.mockImplementation(() => mockMongoScriptExecutor);

    service = new NaturalLanguageService(undefined, mockDb);
  });

  describe("processQuery", () => {
    it("should process a query successfully with script execution", async () => {
      const mockAIResponse = {
        mongoScript: 'db.price_updates.find({"runnerName": "Test Horse"})',
        naturalLanguageInterpretation: "Finding price updates for Test Horse",
      };

      const mockScriptResult = {
        success: true,
        data: [
          {
            _id: "1",
            runnerName: "Test Horse",
            lastTradedPrice: 2.5,
            timestamp: new Date(),
          },
        ],
      };

      mockOpenAIClient.createHorseQueryResponse.mockResolvedValue(
        mockAIResponse
      );
      mockMongoScriptExecutor.executeScript.mockResolvedValue(mockScriptResult);

      const result = await service.processQuery(
        "Show price updates for Test Horse"
      );

      expect(result.query).toBe("Show price updates for Test Horse");
      expect(result.mongoScript).toBe(mockAIResponse.mongoScript);
      expect(result.naturalLanguageInterpretation).toBe(
        mockAIResponse.naturalLanguageInterpretation
      );
      expect(result.mongoResults).toEqual(mockScriptResult.data);
      expect(result.scriptGenerated).toBe(true);
      expect(result.databaseConnected).toBe(true);
      expect(result.noResultsFound).toBe(false);
      expect(result.confidence).toBe(0.95);
    });

    it("should handle script execution errors gracefully", async () => {
      const mockAIResponse = {
        mongoScript: 'db.price_updates.find({"runnerName": "Test Horse"})',
        naturalLanguageInterpretation: "Finding price updates for Test Horse",
      };

      const mockScriptResult = {
        success: false,
        error: "Script execution failed",
      };

      mockOpenAIClient.createHorseQueryResponse.mockResolvedValue(
        mockAIResponse
      );
      mockMongoScriptExecutor.executeScript.mockResolvedValue(mockScriptResult);

      const result = await service.processQuery(
        "Show price updates for Test Horse"
      );

      expect(result.mongoScript).toBe(mockAIResponse.mongoScript);
      expect(result.scriptExecutionError).toBe("Script execution failed");
      expect(result.noResultsMessage).toContain("Script execution failed");
      expect(result.mongoResults).toEqual([]);
    });

    it("should handle no results found scenario", async () => {
      const mockAIResponse = {
        mongoScript:
          'db.price_updates.find({"runnerName": "NonExistent Horse"})',
        naturalLanguageInterpretation:
          "Finding price updates for NonExistent Horse",
      };

      const mockScriptResult = {
        success: true,
        data: [],
      };

      mockOpenAIClient.createHorseQueryResponse.mockResolvedValue(
        mockAIResponse
      );
      mockMongoScriptExecutor.executeScript.mockResolvedValue(mockScriptResult);

      const result = await service.processQuery(
        "Show price updates for NonExistent Horse"
      );

      expect(result.noResultsFound).toBe(true);
      expect(result.noResultsMessage).toContain(
        "No data found matching your query"
      );
      expect(result.mongoResults).toEqual([]);
    });

    it("should handle AI response without script generation", async () => {
      const mockAIResponse = {
        mongoScript: "",
        naturalLanguageInterpretation:
          "I cannot generate a database query for this question",
      };

      mockOpenAIClient.createHorseQueryResponse.mockResolvedValue(
        mockAIResponse
      );

      const result = await service.processQuery("What is the weather like?");

      expect(result.mongoScript).toBeUndefined();
      expect(result.scriptGenerated).toBe(false);
      expect(result.noResultsMessage).toContain(
        "I couldn't generate a database script"
      );
      expect(result.confidence).toBe(0.7);
    });

    it("should handle database connection unavailable", async () => {
      const serviceWithoutDb = new NaturalLanguageService();
      const mockAIResponse = {
        mongoScript: 'db.price_updates.find({"runnerName": "Test Horse"})',
        naturalLanguageInterpretation: "Finding price updates for Test Horse",
      };

      mockOpenAIClient.createHorseQueryResponse.mockResolvedValue(
        mockAIResponse
      );

      const result = await serviceWithoutDb.processQuery(
        "Show price updates for Test Horse"
      );

      expect(result.databaseConnected).toBe(false);
      expect(result.noResultsMessage).toContain(
        "Database connection is not available"
      );
      expect(result.mongoResults).toEqual([]);
    });

    it("should handle OpenAI API errors gracefully", async () => {
      mockOpenAIClient.createHorseQueryResponse.mockRejectedValue(
        new Error("OpenAI API error")
      );

      const result = await service.processQuery(
        "Show price updates for Test Horse"
      );

      expect(result.aiAnalysis).toBeUndefined();
      expect(result.mongoScript).toBeUndefined();
      expect(result.scriptGenerated).toBe(false);
      expect(result.confidence).toBe(0.7);
    });

    it("should handle complex scripts with multiple operations", async () => {
      const complexScript = `
        var market = db.market_definitions.findOne({"name": "Test Race"});
        if (market) {
          db.price_updates.find({"marketId": market.marketId}).sort({"timestamp": -1})
        }
      `;

      const mockAIResponse = {
        mongoScript: complexScript,
        naturalLanguageInterpretation: "Finding market and then price updates",
      };

      const mockScriptResult = {
        success: true,
        data: [{ _id: "1", marketId: "market1", lastTradedPrice: 2.5 }],
      };

      mockOpenAIClient.createHorseQueryResponse.mockResolvedValue(
        mockAIResponse
      );
      mockMongoScriptExecutor.executeScript.mockResolvedValue(mockScriptResult);

      const result = await service.processQuery(
        "Show price updates for Test Race"
      );

      expect(result.mongoScript).toBe(complexScript);
      expect(result.mongoResults).toEqual(mockScriptResult.data);
      expect(result.scriptGenerated).toBe(true);
    });

    it("should handle empty or invalid scripts", async () => {
      const mockAIResponse = {
        mongoScript: "{}",
        naturalLanguageInterpretation: "Empty script",
      };

      mockOpenAIClient.createHorseQueryResponse.mockResolvedValue(
        mockAIResponse
      );

      const result = await service.processQuery("Invalid query");

      expect(result.noResultsMessage).toContain(
        "I couldn't generate a database script"
      );
      expect(result.scriptGenerated).toBe(false);
    });
  });

  describe("extractMongoScript", () => {
    it("should extract script from valid JSON response", () => {
      const aiAnalysis = JSON.stringify({
        mongoScript: "db.test.find({})",
        naturalLanguageInterpretation: "Test query",
      });

      const script = (service as any).extractMongoScript(aiAnalysis);
      expect(script).toBe("db.test.find({})");
    });

    it("should extract script from JSON code block", () => {
      const aiAnalysis = `
        Here's the MongoDB script:
        \`\`\`json
        {
          "mongoScript": "db.test.find({})",
          "naturalLanguageInterpretation": "Test query"
        }
        \`\`\`
      `;

      const script = (service as any).extractMongoScript(aiAnalysis);
      expect(script).toBe("db.test.find({})");
    });

    it("should return null for invalid JSON", () => {
      const aiAnalysis = "Invalid JSON response";
      const script = (service as any).extractMongoScript(aiAnalysis);
      expect(script).toBeNull();
    });

    it("should return null when mongoScript field is missing", () => {
      const aiAnalysis = JSON.stringify({
        naturalLanguageInterpretation: "Test query",
      });

      const script = (service as any).extractMongoScript(aiAnalysis);
      expect(script).toBeNull();
    });
  });

  describe("executeMongoScript", () => {
    it("should execute script successfully", async () => {
      const mockScriptResult = {
        success: true,
        data: [{ _id: "1", name: "Test" }],
      };

      mockMongoScriptExecutor.executeScript.mockResolvedValue(mockScriptResult);

      const result = await (service as any).executeMongoScript(
        "db.test.find({})"
      );

      expect(result.data).toEqual(mockScriptResult.data);
      expect(result.error).toBeUndefined();
    });

    it("should handle script execution failure", async () => {
      const mockScriptResult = {
        success: false,
        error: "Script execution failed",
      };

      mockMongoScriptExecutor.executeScript.mockResolvedValue(mockScriptResult);

      const result = await (service as any).executeMongoScript(
        "db.test.find({})"
      );

      expect(result.data).toEqual([]);
      expect(result.error).toBe("Script execution failed");
    });

    it("should throw error when executor is not available", async () => {
      const serviceWithoutDb = new NaturalLanguageService();

      await expect(
        (serviceWithoutDb as any).executeMongoScript("db.test.find({})")
      ).rejects.toThrow("MongoDB script executor not available");
    });
  });

  describe("getHorsesByQuery", () => {
    it("should return horses from processQuery response", async () => {
      const mockResponse = {
        horses: [
          {
            id: "1",
            name: "Test Horse",
            odds: 2.5,
            position: 1,
            jockey: "J. Smith",
            trainer: "T. Jones",
            weight: 60,
            age: 4,
            form: ["1", "2", "3"],
          },
        ],
        query: "Test query",
        timestamp: new Date(),
        confidence: 0.95,
      };

      jest.spyOn(service, "processQuery").mockResolvedValue(mockResponse);

      const result = await service.getHorsesByQuery("Test query");

      expect(result).toEqual(mockResponse.horses);
    });
  });

  describe("getTopHorses", () => {
    it("should return top horses with limit", async () => {
      const mockResponse = {
        horses: [
          {
            id: "1",
            name: "Horse 1",
            odds: 1.5,
            position: 1,
            jockey: "J1",
            trainer: "T1",
            weight: 60,
            age: 4,
            form: ["1"],
          },
          {
            id: "2",
            name: "Horse 2",
            odds: 2.0,
            position: 2,
            jockey: "J2",
            trainer: "T2",
            weight: 61,
            age: 5,
            form: ["2"],
          },
          {
            id: "3",
            name: "Horse 3",
            odds: 3.0,
            position: 3,
            jockey: "J3",
            trainer: "T3",
            weight: 62,
            age: 6,
            form: ["3"],
          },
        ],
        query: "Show me the top horses",
        timestamp: new Date(),
        confidence: 0.95,
      };

      jest.spyOn(service, "processQuery").mockResolvedValue(mockResponse);

      const result = await service.getTopHorses(2);

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("Horse 1");
      expect(result[1].name).toBe("Horse 2");
    });
  });

  describe("getHorsesByOdds", () => {
    it("should filter horses by maximum odds", async () => {
      const mockResponse = {
        horses: [
          {
            id: "1",
            name: "Horse 1",
            odds: 1.5,
            position: 1,
            jockey: "J1",
            trainer: "T1",
            weight: 60,
            age: 4,
            form: ["1"],
          },
          {
            id: "2",
            name: "Horse 2",
            odds: 2.0,
            position: 2,
            jockey: "J2",
            trainer: "T2",
            weight: 61,
            age: 5,
            form: ["2"],
          },
          {
            id: "3",
            name: "Horse 3",
            odds: 3.0,
            position: 3,
            jockey: "J3",
            trainer: "T3",
            weight: 62,
            age: 6,
            form: ["3"],
          },
        ],
        query: "Show horses with odds under 2.5",
        timestamp: new Date(),
        confidence: 0.95,
      };

      jest.spyOn(service, "processQuery").mockResolvedValue(mockResponse);

      const result = await service.getHorsesByOdds(2.5);

      expect(result).toHaveLength(2);
      expect(result[0].odds).toBeLessThanOrEqual(2.5);
      expect(result[1].odds).toBeLessThanOrEqual(2.5);
    });
  });
});
