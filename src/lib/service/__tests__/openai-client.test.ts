import { OpenAIClient } from "../openai-client";
import OpenAI from "openai";
import { readFileSync } from "fs";
import { join } from "path";

// Mock dependencies
jest.mock("openai");
jest.mock("fs");
jest.mock("config");

const MockedOpenAI = OpenAI as jest.MockedClass<typeof OpenAI>;
const MockedReadFileSync = readFileSync as jest.MockedFunction<
  typeof readFileSync
>;

describe("OpenAIClient", () => {
  let client: OpenAIClient;
  let mockOpenAI: jest.Mocked<OpenAI>;
  let mockCreate: jest.MockedFunction<any>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock config
    const mockConfig = {
      get: jest.fn().mockReturnValue("test-api-key"),
    };
    jest.doMock("config", () => mockConfig);

    // Mock file system
    MockedReadFileSync.mockReturnValue(`
      # Horse Racing MongoDB Assistant
      
      **User Query:** \${query}
      
      Return your response in this exact format:
      
      \`\`\`json
      {
        "mongoScript": "the MongoDB JavaScript script as a string",
        "naturalLanguageInterpretation": "a clear explanation of what the script does"
      }
      \`\`\`
    `);

    // Mock OpenAI
    mockCreate = jest.fn();
    mockOpenAI = {
      responses: {
        create: mockCreate,
      },
    } as any;
    MockedOpenAI.mockImplementation(() => mockOpenAI);

    client = new OpenAIClient();
  });

  describe("constructor", () => {
    it("should initialize with API key from config", () => {
      expect(MockedOpenAI).toHaveBeenCalledWith({
        apiKey: "test-api-key",
      });
    });

    it("should load instructions from markdown file", () => {
      expect(MockedReadFileSync).toHaveBeenCalledWith(
        expect.stringContaining("horse-racing-assistant.md"),
        "utf-8"
      );
    });

    it("should throw error if API key is not found", () => {
      const mockConfig = {
        get: jest.fn().mockReturnValue(undefined),
      };
      jest.doMock("config", () => mockConfig);

      expect(() => new OpenAIClient()).toThrow(
        "OpenAI API key not found in configuration"
      );
    });

    it("should throw error if instructions file cannot be loaded", () => {
      MockedReadFileSync.mockImplementation(() => {
        throw new Error("File not found");
      });

      expect(() => new OpenAIClient()).toThrow(
        "Could not load horse racing assistant instructions"
      );
    });
  });

  describe("createResponse", () => {
    it("should create a response successfully", async () => {
      const mockResponse = {
        output_text: "Test response",
      };

      mockCreate.mockResolvedValue(mockResponse);

      const result = await client.createResponse("Test input");

      expect(result).toBe("Test response");
      expect(mockCreate).toHaveBeenCalledWith({
        model: "gpt-4o-mini",
        input: "Test input",
        store: true,
      });
    });

    it("should handle API errors", async () => {
      mockCreate.mockRejectedValue(new Error("API Error"));

      await expect(client.createResponse("Test input")).rejects.toThrow(
        "Failed to get response from OpenAI: Error: API Error"
      );
    });
  });

  describe("createHorseQueryResponse", () => {
    it("should parse valid JSON response", async () => {
      const mockResponse = {
        output_text: JSON.stringify({
          mongoScript: 'db.price_updates.find({"runnerName": "Test Horse"})',
          naturalLanguageInterpretation: "Finding price updates for Test Horse",
        }),
      };

      mockCreate.mockResolvedValue(mockResponse);

      const result = await client.createHorseQueryResponse(
        "Show price updates for Test Horse"
      );

      expect(result.mongoScript).toBe(
        'db.price_updates.find({"runnerName": "Test Horse"})'
      );
      expect(result.naturalLanguageInterpretation).toBe(
        "Finding price updates for Test Horse"
      );
    });

    it("should parse JSON from code block", async () => {
      const mockResponse = {
        output_text: `
          Here's the MongoDB script:
          \`\`\`json
          {
            "mongoScript": "db.price_updates.find({\\"runnerName\\": \\"Test Horse\\"})",
            "naturalLanguageInterpretation": "Finding price updates for Test Horse"
          }
          \`\`\`
        `,
      };

      mockCreate.mockResolvedValue(mockResponse);

      const result = await client.createHorseQueryResponse(
        "Show price updates for Test Horse"
      );

      expect(result.mongoScript).toBe(
        'db.price_updates.find({"runnerName": "Test Horse"})'
      );
      expect(result.naturalLanguageInterpretation).toBe(
        "Finding price updates for Test Horse"
      );
    });

    it("should parse JSON from text without code blocks", async () => {
      const mockResponse = {
        output_text: `
          The script is: {"mongoScript": "db.price_updates.find({\\"runnerName\\": \\"Test Horse\\"})", "naturalLanguageInterpretation": "Finding price updates for Test Horse"}
        `,
      };

      mockCreate.mockResolvedValue(mockResponse);

      const result = await client.createHorseQueryResponse(
        "Show price updates for Test Horse"
      );

      expect(result.mongoScript).toBe(
        'db.price_updates.find({"runnerName": "Test Horse"})'
      );
      expect(result.naturalLanguageInterpretation).toBe(
        "Finding price updates for Test Horse"
      );
    });

    it("should handle complex scripts with multiple operations", async () => {
      const complexScript = `
        var market = db.market_definitions.findOne({"name": "Test Race"});
        if (market) {
          db.price_updates.find({"marketId": market.marketId}).sort({"timestamp": -1})
        }
      `;

      const mockResponse = {
        output_text: JSON.stringify({
          mongoScript: complexScript,
          naturalLanguageInterpretation:
            "Finding market and then price updates",
        }),
      };

      mockCreate.mockResolvedValue(mockResponse);

      const result = await client.createHorseQueryResponse(
        "Show price updates for Test Race"
      );

      expect(result.mongoScript).toBe(complexScript);
      expect(result.naturalLanguageInterpretation).toBe(
        "Finding market and then price updates"
      );
    });

    it("should handle JavaScript code blocks", async () => {
      const mockResponse = {
        output_text: `
          \`\`\`javascript
          {
            "mongoScript": "db.price_updates.find({\\"runnerName\\": \\"Test Horse\\"})",
            "naturalLanguageInterpretation": "Finding price updates for Test Horse"
          }
          \`\`\`
        `,
      };

      mockCreate.mockResolvedValue(mockResponse);

      const result = await client.createHorseQueryResponse(
        "Show price updates for Test Horse"
      );

      expect(result.mongoScript).toBe(
        'db.price_updates.find({"runnerName": "Test Horse"})'
      );
      expect(result.naturalLanguageInterpretation).toBe(
        "Finding price updates for Test Horse"
      );
    });

    it("should handle invalid JSON in code block", async () => {
      const mockResponse = {
        output_text: `
          \`\`\`json
          {
            "mongoScript": "db.price_updates.find({\\"runnerName\\": \\"Test Horse\\"})",
            "naturalLanguageInterpretation": "Finding price updates for Test Horse"
            // Missing closing brace
          }
          \`\`\`
        `,
      };

      mockCreate.mockResolvedValue(mockResponse);

      await expect(
        client.createHorseQueryResponse("Show price updates for Test Horse")
      ).rejects.toThrow(
        "Could not extract MongoDB script and interpretation from AI response"
      );
    });

    it("should handle invalid JSON in text", async () => {
      const mockResponse = {
        output_text: `
          Invalid JSON: {"mongoScript": "db.price_updates.find({\\"runnerName\\": \\"Test Horse\\"})", "naturalLanguageInterpretation": "Finding price updates for Test Horse"
        `,
      };

      mockCreate.mockResolvedValue(mockResponse);

      await expect(
        client.createHorseQueryResponse("Show price updates for Test Horse")
      ).rejects.toThrow(
        "Could not extract MongoDB script and interpretation from AI response"
      );
    });

    it("should handle response without JSON", async () => {
      const mockResponse = {
        output_text: "This is just plain text without any JSON",
      };

      mockCreate.mockResolvedValue(mockResponse);

      await expect(
        client.createHorseQueryResponse("Show price updates for Test Horse")
      ).rejects.toThrow(
        "Could not extract MongoDB script and interpretation from AI response"
      );
    });

    it("should replace query placeholder in instructions", async () => {
      const mockResponse = {
        output_text: JSON.stringify({
          mongoScript: 'db.price_updates.find({"runnerName": "Test Horse"})',
          naturalLanguageInterpretation: "Finding price updates for Test Horse",
        }),
      };

      mockCreate.mockResolvedValue(mockResponse);

      await client.createHorseQueryResponse(
        "Show price updates for Test Horse"
      );

      expect(mockCreate).toHaveBeenCalledWith({
        model: "gpt-4o-mini",
        input: expect.stringContaining("Show price updates for Test Horse"),
        store: true,
      });
    });

    it("should handle API errors during response creation", async () => {
      mockCreate.mockRejectedValue(new Error("API Error"));

      await expect(
        client.createHorseQueryResponse("Test query")
      ).rejects.toThrow("Failed to get response from OpenAI: Error: API Error");
    });
  });
});
