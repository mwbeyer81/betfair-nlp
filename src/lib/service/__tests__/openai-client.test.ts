import { OpenAIClient } from "../openai-client";

// Mock the OpenAI module
jest.mock("openai", () => {
  const mockClient = {
    responses: {
      create: jest.fn().mockResolvedValue({
        output_text: "Mocked AI response",
      }),
    },
  };

  const MockOpenAI = jest.fn().mockImplementation(() => mockClient) as any;

  // The default export is the OpenAI class itself
  MockOpenAI.default = MockOpenAI;
  MockOpenAI.OpenAI = MockOpenAI;

  return MockOpenAI;
});

// Mock the config module
jest.mock("config", () => ({
  get: jest.fn().mockReturnValue("test-api-key"),
}));

describe("OpenAIClient", () => {
  let openaiClient: OpenAIClient;

  beforeEach(() => {
    openaiClient = new OpenAIClient();
  });

  describe("constructor", () => {
    it("should initialize with API key from config", () => {
      expect(openaiClient).toBeInstanceOf(OpenAIClient);
    });

    it("should throw error if API key is not found", () => {
      // Mock config to return undefined
      const config = require("config");
      config.get.mockReturnValueOnce(undefined);

      expect(() => new OpenAIClient()).toThrow(
        "OpenAI API key not found in configuration"
      );
    });
  });

  describe("createResponse", () => {
    it("should create a response successfully", async () => {
      const input = "write a haiku about ai";
      const result = await openaiClient.createResponse(input);

      expect(result).toBe("Mocked AI response");
    });

    it("should handle API errors gracefully", async () => {
      // Mock OpenAI to throw an error
      const OpenAI = require("openai");
      const mockClient = {
        responses: {
          create: jest.fn().mockRejectedValue(new Error("API Error")),
        },
      };
      OpenAI.mockImplementationOnce(() => mockClient);

      const newClient = new OpenAIClient();
      await expect(newClient.createResponse("test")).rejects.toThrow(
        "Failed to get response from OpenAI: Error: API Error"
      );
    });
  });

  describe("createHorseQueryResponse", () => {
    it("should create a MongoDB-focused response", async () => {
      const query = "Show me the top horses";
      const result = await openaiClient.createHorseQueryResponse(query);

      expect(result).toBe("Mocked AI response");
    });

    it("should include the query and MongoDB instructions in the prompt", async () => {
      const query = "Show me horses with low odds";
      const mockCreate = jest.fn().mockResolvedValue({
        output_text: "Mocked MongoDB query",
      });

      const OpenAI = require("openai");
      const mockClient = {
        responses: {
          create: mockCreate,
        },
      };
      OpenAI.mockImplementationOnce(() => mockClient);

      const newClient = new OpenAIClient();
      await newClient.createHorseQueryResponse(query);

      expect(mockCreate).toHaveBeenCalledWith({
        model: "gpt-4o-mini",
        input: expect.stringContaining("You are a MongoDB assistant"),
        store: true,
      });

      // Check that the prompt includes MongoDB schema and instructions
      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.input).toContain("event_definitions");
      expect(callArgs.input).toContain("market_definitions");
      expect(callArgs.input).toContain("price_updates");
      expect(callArgs.input).toContain("mongosh");
      expect(callArgs.input).toContain(query);
    });
  });
});
