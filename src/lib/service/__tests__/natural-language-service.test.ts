import { NaturalLanguageService } from "../natural-language-service";
import { OpenAIClient } from "../openai-client";

// Mock the OpenAI client
jest.mock("../openai-client");

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

    service = new NaturalLanguageService();
  });

  describe("processQuery", () => {
    it("should process query and return horses with AI analysis", async () => {
      const mockAIResponse =
        "This query is looking for top-performing horses in the race.";
      mockOpenAIClient.createHorseQueryResponse.mockResolvedValue(
        mockAIResponse
      );

      const query = "Show me the top horses in the race";
      const result = await service.processQuery(query);

      expect(result).toHaveProperty("horses");
      expect(result).toHaveProperty("query", query);
      expect(result).toHaveProperty("timestamp");
      expect(result).toHaveProperty("confidence", 0.85);
      expect(result).toHaveProperty("aiAnalysis", mockAIResponse);
      expect(Array.isArray(result.horses)).toBe(true);
      expect(result.horses.length).toBeGreaterThan(0);
    });

    it("should handle OpenAI errors gracefully and continue with stubbed data", async () => {
      mockOpenAIClient.createHorseQueryResponse.mockRejectedValue(
        new Error("OpenAI API Error")
      );

      const query = "Show me the top horses";
      const result = await service.processQuery(query);

      expect(result).toHaveProperty("horses");
      expect(result).toHaveProperty("query", query);
      expect(result).toHaveProperty("aiAnalysis", undefined);
      expect(Array.isArray(result.horses)).toBe(true);
      expect(result.horses.length).toBeGreaterThan(0);
    });

    it("should return horses with correct structure", async () => {
      mockOpenAIClient.createHorseQueryResponse.mockResolvedValue(
        "AI analysis"
      );

      const result = await service.processQuery("test query");
      const horse = result.horses[0];

      expect(horse).toHaveProperty("id");
      expect(horse).toHaveProperty("name");
      expect(horse).toHaveProperty("odds");
      expect(horse).toHaveProperty("position");
      expect(horse).toHaveProperty("jockey");
      expect(horse).toHaveProperty("trainer");
      expect(horse).toHaveProperty("weight");
      expect(horse).toHaveProperty("age");
      expect(horse).toHaveProperty("form");
      expect(Array.isArray(horse.form)).toBe(true);
    });
  });

  describe("getHorsesByQuery", () => {
    it("should return horses from processQuery", async () => {
      mockOpenAIClient.createHorseQueryResponse.mockResolvedValue(
        "AI analysis"
      );

      const horses = await service.getHorsesByQuery("test query");

      expect(Array.isArray(horses)).toBe(true);
      expect(horses.length).toBeGreaterThan(0);
    });
  });

  describe("getTopHorses", () => {
    it("should return top horses with default limit", async () => {
      mockOpenAIClient.createHorseQueryResponse.mockResolvedValue(
        "AI analysis"
      );

      const horses = await service.getTopHorses();

      expect(Array.isArray(horses)).toBe(true);
      expect(horses.length).toBeLessThanOrEqual(5);
    });

    it("should return top horses with custom limit", async () => {
      mockOpenAIClient.createHorseQueryResponse.mockResolvedValue(
        "AI analysis"
      );

      const horses = await service.getTopHorses(3);

      expect(Array.isArray(horses)).toBe(true);
      expect(horses.length).toBeLessThanOrEqual(3);
    });
  });

  describe("getHorsesByOdds", () => {
    it("should return horses with odds under specified value", async () => {
      mockOpenAIClient.createHorseQueryResponse.mockResolvedValue(
        "AI analysis"
      );

      const horses = await service.getHorsesByOdds(5.0);

      expect(Array.isArray(horses)).toBe(true);
      horses.forEach(horse => {
        expect(horse.odds).toBeLessThanOrEqual(5.0);
      });
    });

    it("should return empty array when no horses meet criteria", async () => {
      mockOpenAIClient.createHorseQueryResponse.mockResolvedValue(
        "AI analysis"
      );

      const horses = await service.getHorsesByOdds(1.0);

      expect(Array.isArray(horses)).toBe(true);
      expect(horses.length).toBe(0);
    });
  });
});
