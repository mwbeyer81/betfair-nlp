import { NaturalLanguageService } from "../natural-language-service";
import { OpenAIClient } from "../openai-client";
import { Db } from "mongodb";

// Mock the OpenAI client
jest.mock("../openai-client");

// Mock MongoDB
const mockDb = {
  collection: jest.fn().mockReturnValue({
    find: jest.fn().mockReturnValue({
      toArray: jest.fn().mockResolvedValue([{ id: 1, name: "Test Horse" }]),
    }),
    findOne: jest.fn().mockResolvedValue({ id: 1, name: "Test Horse" }),
    aggregate: jest.fn().mockReturnValue({
      toArray: jest.fn().mockResolvedValue([{ id: 1, name: "Test Horse" }]),
    }),
  }),
} as any;

describe("NaturalLanguageService", () => {
  let service: NaturalLanguageService;
  let mockOpenAIClient: jest.Mocked<OpenAIClient>;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create mock OpenAI client
    mockOpenAIClient = {
      createResponse: jest.fn(),
      createHorseQueryResponse: jest.fn(),
    } as any;

    // Mock the OpenAIClient constructor
    (OpenAIClient as jest.MockedClass<typeof OpenAIClient>).mockImplementation(
      () => mockOpenAIClient
    );

    service = new NaturalLanguageService(null as any, mockDb);
  });

  describe("processQuery", () => {
    it("should process query and return horses with MongoDB analysis and results", async () => {
      const mockAIResponse =
        '```javascript\ndb.market_definitions.find({"name": "Cheltenham Chase"}, {"runners": 1, "name": 1})\n```';
      mockOpenAIClient.createHorseQueryResponse.mockResolvedValue(
        mockAIResponse
      );

      const query = "Show me the top horses in the race";
      const result = await service.processQuery(query);

      expect(result).toHaveProperty("horses");
      expect(result).toHaveProperty("query", query);
      expect(result).toHaveProperty("timestamp");
      expect(result).toHaveProperty("confidence", 0.95);
      expect(result).toHaveProperty("aiAnalysis", mockAIResponse);
      expect(result).toHaveProperty("mongoQuery");
      expect(result).toHaveProperty("mongoResults");
      expect(Array.isArray(result.horses)).toBe(true);
      expect(result.horses.length).toBe(0); // Empty since we return MongoDB results
    });

    it("should throw error when OpenAI fails", async () => {
      mockOpenAIClient.createHorseQueryResponse.mockRejectedValue(
        new Error("OpenAI API Error")
      );

      const query = "Show me the top horses";

      await expect(service.processQuery(query)).rejects.toThrow(
        "OpenAI API Error"
      );
    });

    it("should throw error when no MongoDB query can be extracted", async () => {
      mockOpenAIClient.createHorseQueryResponse.mockResolvedValue(
        "This is not a valid MongoDB query"
      );

      const query = "test query";

      await expect(service.processQuery(query)).rejects.toThrow(
        "Could not extract MongoDB query from AI analysis"
      );
    });

    it("should throw error when database is not available", async () => {
      const serviceWithoutDb = new NaturalLanguageService();
      const mockAIResponse =
        "```javascript\ndb.market_definitions.find({})\n```";
      mockOpenAIClient.createHorseQueryResponse.mockResolvedValue(
        mockAIResponse
      );

      const query = "test query";

      await expect(serviceWithoutDb.processQuery(query)).rejects.toThrow(
        "Database connection not available"
      );
    });

    it("should throw error when MongoDB query returns no results", async () => {
      // Mock empty results
      const mockDbWithEmptyResults = {
        collection: jest.fn().mockReturnValue({
          find: jest.fn().mockReturnValue({
            toArray: jest.fn().mockResolvedValue([]),
          }),
          findOne: jest.fn().mockResolvedValue(null),
          aggregate: jest.fn().mockReturnValue({
            toArray: jest.fn().mockResolvedValue([]),
          }),
        }),
      } as any;

      const serviceWithEmptyResults = new NaturalLanguageService(
        null as any,
        mockDbWithEmptyResults
      );
      const mockAIResponse =
        '```javascript\ndb.market_definitions.find({"name": "NonExistentRace"})\n```';
      mockOpenAIClient.createHorseQueryResponse.mockResolvedValue(
        mockAIResponse
      );

      const query = "test query";

      await expect(serviceWithEmptyResults.processQuery(query)).rejects.toThrow(
        "No results found for query"
      );
    });

    it("should extract and execute MongoDB queries from AI analysis", async () => {
      const mockAIResponse =
        '```javascript\ndb.price_updates.find({"lastTradedPrice": {$lte: 5.0}})\n```';
      mockOpenAIClient.createHorseQueryResponse.mockResolvedValue(
        mockAIResponse
      );

      const result = await service.processQuery("test query");

      expect(result.mongoQuery).toBe(
        'db.price_updates.find({"lastTradedPrice": {$lte: 5.0}})'
      );
      expect(result.mongoResults).toBeDefined();
      expect(Array.isArray(result.mongoResults)).toBe(true);
      expect(result.mongoResults!.length).toBeGreaterThan(0);
    });

    it("should handle aggregation queries", async () => {
      const mockAIResponse = `\`\`\`javascript
db.market_definitions.aggregate([
  { $match: { name: "Cheltenham Chase" } },
  { $lookup: { from: "event_definitions", localField: "eventId", foreignField: "eventId", as: "event_details" } }
])
\`\`\``;
      mockOpenAIClient.createHorseQueryResponse.mockResolvedValue(
        mockAIResponse
      );

      const result = await service.processQuery("test query");

      expect(result.mongoQuery).toContain("aggregate");
      expect(result.mongoResults).toBeDefined();
      expect(result.mongoResults!.length).toBeGreaterThan(0);
    });

    it("should handle findOne queries", async () => {
      const mockAIResponse =
        '```javascript\ndb.market_definitions.findOne({ name: "Cheltenham Chase" })\n```';
      mockOpenAIClient.createHorseQueryResponse.mockResolvedValue(
        mockAIResponse
      );

      const result = await service.processQuery("test query");

      expect(result.mongoQuery).toContain("findOne");
      expect(result.mongoResults).toBeDefined();
      expect(result.mongoResults!.length).toBeGreaterThan(0);
    });
  });

  describe("getHorsesByQuery", () => {
    it("should return empty horses array since we now return MongoDB results", async () => {
      mockOpenAIClient.createHorseQueryResponse.mockResolvedValue(
        "db.market_definitions.find({})"
      );

      const horses = await service.getHorsesByQuery("test query");

      expect(Array.isArray(horses)).toBe(true);
      expect(horses.length).toBe(0); // Empty since we return MongoDB results instead
    });
  });

  describe("getTopHorses", () => {
    it("should return top horses with default limit", async () => {
      mockOpenAIClient.createHorseQueryResponse.mockResolvedValue(
        "db.market_definitions.find({}).limit(5)"
      );

      const horses = await service.getTopHorses();

      expect(Array.isArray(horses)).toBe(true);
      expect(horses.length).toBeLessThanOrEqual(5);
    });

    it("should return top horses with custom limit", async () => {
      mockOpenAIClient.createHorseQueryResponse.mockResolvedValue(
        "db.market_definitions.find({}).limit(3)"
      );

      const horses = await service.getTopHorses(3);

      expect(Array.isArray(horses)).toBe(true);
      expect(horses.length).toBeLessThanOrEqual(3);
    });
  });

  describe("getHorsesByOdds", () => {
    it("should return horses with odds under specified value", async () => {
      mockOpenAIClient.createHorseQueryResponse.mockResolvedValue(
        'db.price_updates.find({"lastTradedPrice": {$lte: 5.0}})'
      );

      const horses = await service.getHorsesByOdds(5.0);

      expect(Array.isArray(horses)).toBe(true);
      horses.forEach(horse => {
        expect(horse.odds).toBeLessThanOrEqual(5.0);
      });
    });

    it("should return empty array when no horses meet criteria", async () => {
      mockOpenAIClient.createHorseQueryResponse.mockResolvedValue(
        'db.price_updates.find({"lastTradedPrice": {$lte: 1.0}})'
      );

      const horses = await service.getHorsesByOdds(1.0);

      expect(Array.isArray(horses)).toBe(true);
      expect(horses.length).toBe(0);
    });
  });
});
