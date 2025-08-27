import { OpenAIClient } from "../openai-client";

// This is a real integration test that will call the actual OpenAI API
// Only run this test when you want to verify the API key works
describe("OpenAI Integration Test", () => {
  let openaiClient: OpenAIClient;

  beforeAll(() => {
    openaiClient = new OpenAIClient();
  });

  it("should successfully call OpenAI API with the provided key", async () => {
    const input = "write a haiku about ai";

    try {
      const result = await openaiClient.createResponse(input);

      expect(result).toBeDefined();
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);

      console.log("OpenAI API Response:", result);
    } catch (error) {
      console.error("OpenAI API Error:", error);
      throw error;
    }
  }, 30000); // 30 second timeout for API call

  it("should create horse racing specific response", async () => {
    const query = "Show me the top horses in the race";

    try {
      const result = await openaiClient.createHorseQueryResponse(query);

      expect(result).toBeDefined();
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);

      console.log("Horse Racing AI Response:", result);
    } catch (error) {
      console.error("OpenAI API Error:", error);
      throw error;
    }
  }, 30000); // 30 second timeout for API call
});
