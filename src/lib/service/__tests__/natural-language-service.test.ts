import { NaturalLanguageService } from "../natural-language-service";
import { OpenAIClient } from "../openai-client";
import { Db } from "mongodb";

// Mock the OpenAI client
jest.mock("../openai-client");

// Mock MongoDB
const mockDb = {
  command: jest.fn().mockResolvedValue({ cursor: { id: 0 } }),
  collection: jest.fn().mockReturnValue({
    find: jest.fn().mockReturnValue({
      toArray: jest.fn().mockResolvedValue([{ id: 1, name: "Test Horse" }]),
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
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
      const mockAIResponse = {
        mongoQuery: '{"find": "market_definitions", "filter": {"name": "Cheltenham Chase"}, "projection": {"runners": 1, "name": 1}}',
        naturalLanguageInterpretation: "I'm searching for market definitions where the name matches 'Cheltenham Chase' and showing the runners and name fields."
      };
      mockOpenAIClient.createHorseQueryResponse.mockResolvedValue(
        mockAIResponse
      );

      const query = "Show me the top horses in the race";
      const result = await service.processQuery(query);

      expect(result).toHaveProperty("horses");
      expect(result).toHaveProperty("query", query);
      expect(result).toHaveProperty("timestamp");
      expect(result).toHaveProperty("confidence", 0.95);
      expect(result).toHaveProperty("aiAnalysis");
      expect(result).toHaveProperty("mongoQuery", mockAIResponse.mongoQuery);
      expect(result).toHaveProperty("naturalLanguageInterpretation", mockAIResponse.naturalLanguageInterpretation);
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
      const mockAIResponse = {
        mongoQuery: "",
        naturalLanguageInterpretation: "This is a response without any MongoDB query"
      };
      mockOpenAIClient.createHorseQueryResponse.mockResolvedValue(
        mockAIResponse
      );

      const query = "test query";

      await expect(service.processQuery(query)).rejects.toThrow(
        "Could not extract MongoDB query from AI analysis"
      );
    });

    it("should throw error when database is not available", async () => {
      const serviceWithoutDb = new NaturalLanguageService();
      const mockAIResponse = {
        mongoQuery: '{"find": "market_definitions", "filter": {}}',
        naturalLanguageInterpretation: "I'm searching for all market definitions."
      };
      mockOpenAIClient.createHorseQueryResponse.mockResolvedValue(
        mockAIResponse
      );

      const query = "test query";

      await expect(serviceWithoutDb.processQuery(query)).rejects.toThrow(
        "Database connection not available"
      );
    });

    it("should throw error when MongoDB query returns no results", async () => {
      const mockDbWithEmptyResults = {
        command: jest.fn().mockResolvedValue({ cursor: { id: 0 } }),
        collection: jest.fn().mockReturnValue({
          find: jest.fn().mockReturnValue({
            toArray: jest.fn().mockResolvedValue([]),
            sort: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
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
      const mockAIResponse = {
        mongoQuery: '{"find": "market_definitions", "filter": {"name": "NonExistentRace"}}',
        naturalLanguageInterpretation: "I'm searching for market definitions where the name matches 'NonExistentRace'."
      };
      mockOpenAIClient.createHorseQueryResponse.mockResolvedValue(
        mockAIResponse
      );

      const query = "test query";

      await expect(serviceWithEmptyResults.processQuery(query)).rejects.toThrow(
        "No results found for query"
      );
    });

    it("should return MongoDB results from processQuery", async () => {
      const mockDbWithResults = {
        command: jest.fn().mockResolvedValue({ cursor: { id: 0 } }),
        collection: jest.fn().mockReturnValue({
          find: jest.fn().mockReturnValue({
            toArray: jest
              .fn()
              .mockResolvedValue([{ id: 1, name: "Test Horse" }]),
            sort: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
          }),
          findOne: jest.fn().mockResolvedValue({ id: 1, name: "Test Horse" }),
          aggregate: jest.fn().mockReturnValue({
            toArray: jest
              .fn()
              .mockResolvedValue([{ id: 1, name: "Test Horse" }]),
          }),
        }),
      } as any;

      const serviceWithResults = new NaturalLanguageService(
        null as any,
        mockDbWithResults
      );
      const mockAIResponse = {
        mongoQuery: '{"find": "price_updates", "filter": {"lastTradedPrice": {"$lte": 5.0}}}',
        naturalLanguageInterpretation: "I'm searching for price updates where the last traded price is less than or equal to 5.0."
      };
      mockOpenAIClient.createHorseQueryResponse.mockResolvedValue(
        mockAIResponse
      );

      const result = await serviceWithResults.processQuery("test query");

      expect(result.mongoQuery).toBe(
        '{"find":"price_updates","filter":{"lastTradedPrice":{"$lte":5}}}'
      );
      expect(result.mongoResults).toBeDefined();
      expect(Array.isArray(result.mongoResults)).toBe(true);
      expect(result.mongoResults!).toHaveLength(1);
      expect(result.mongoResults![0]).toEqual({ id: 1, name: "Test Horse" });
    });

    it("should handle aggregation queries", async () => {
      const mockAIResponse = {
        mongoQuery: '{"aggregate": "market_definitions", "pipeline": [{"$match": {"name": "Cheltenham Chase"}}, {"$lookup": {"from": "event_definitions", "localField": "eventId", "foreignField": "eventId", "as": "event_details"}}]}',
        naturalLanguageInterpretation: "I'm performing an aggregation on market definitions to match 'Cheltenham Chase' and lookup event details."
      };
      mockOpenAIClient.createHorseQueryResponse.mockResolvedValue(
        mockAIResponse
      );

      const result = await service.processQuery("test query");

      expect(result.mongoQuery).toContain("aggregate");
      expect(result.mongoResults).toBeDefined();
      expect(result.mongoResults!.length).toBeGreaterThan(0);
    });

    it("should handle findOne queries", async () => {
      const mockAIResponse = {
        mongoQuery: '{"findOne": "market_definitions", "filter": {"name": "Cheltenham Chase"}}',
        naturalLanguageInterpretation: "I'm finding one market definition where the name matches 'Cheltenham Chase'."
      };
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
      mockOpenAIClient.createHorseQueryResponse.mockResolvedValue({
        mongoQuery: '{"find": "market_definitions", "filter": {}}',
        naturalLanguageInterpretation: "I'm searching for all market definitions."
      });

      const horses = await service.getHorsesByQuery("test query");

      expect(Array.isArray(horses)).toBe(true);
      expect(horses.length).toBe(0); // Empty since we return MongoDB results instead
    });
  });

  describe("getTopHorses", () => {
    it("should return top horses with default limit", async () => {
      mockOpenAIClient.createHorseQueryResponse.mockResolvedValue({
        mongoQuery: '{"find": "market_definitions", "filter": {}, "limit": 5}',
        naturalLanguageInterpretation: "I'm searching for market definitions with a limit of 5 results."
      });

      const horses = await service.getTopHorses();

      expect(Array.isArray(horses)).toBe(true);
      expect(horses.length).toBeLessThanOrEqual(5);
    });

    it("should return top horses with custom limit", async () => {
      mockOpenAIClient.createHorseQueryResponse.mockResolvedValue({
        mongoQuery: '{"find": "market_definitions", "filter": {}, "limit": 3}',
        naturalLanguageInterpretation: "I'm searching for market definitions with a limit of 3 results."
      });

      const horses = await service.getTopHorses(3);

      expect(Array.isArray(horses)).toBe(true);
      expect(horses.length).toBeLessThanOrEqual(3);
    });
  });

  describe("getHorsesByOdds", () => {
    it("should return horses with odds under specified value", async () => {
      mockOpenAIClient.createHorseQueryResponse.mockResolvedValue({
        mongoQuery: '{"find": "price_updates", "filter": {"lastTradedPrice": {"$lte": 5.0}}}',
        naturalLanguageInterpretation: "I'm searching for price updates where the last traded price is less than or equal to 5.0."
      });

      const horses = await service.getHorsesByOdds(5.0);

      expect(Array.isArray(horses)).toBe(true);
      horses.forEach(horse => {
        expect(horse.odds).toBeLessThanOrEqual(5.0);
      });
    });

    it("should return empty array when no horses meet criteria", async () => {
      mockOpenAIClient.createHorseQueryResponse.mockResolvedValue({
        mongoQuery: '{"find": "price_updates", "filter": {"lastTradedPrice": {"$lte": 1.0}}}',
        naturalLanguageInterpretation: "I'm searching for price updates where the last traded price is less than or equal to 1.0."
      });

      const horses = await service.getHorsesByOdds(1.0);

      expect(Array.isArray(horses)).toBe(true);
      expect(horses.length).toBe(0);
    });
  });
});
