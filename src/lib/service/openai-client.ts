import OpenAI from "openai";
import config from "config";

export class OpenAIClient {
  private client: OpenAI;

  constructor() {
    const apiKey = config.get<string>("openai.apiKey");
    if (!apiKey) {
      throw new Error("OpenAI API key not found in configuration");
    }

    this.client = new OpenAI({
      apiKey: apiKey,
    });
  }

  async createResponse(input: string): Promise<string> {
    try {
      const response = await this.client.responses.create({
        model: "gpt-4o-mini",
        input: input,
        store: true,
      });

      return response.output_text;
    } catch (error) {
      console.error("OpenAI API error:", error);
      throw new Error(`Failed to get response from OpenAI: ${error}`);
    }
  }

  async createHorseQueryResponse(query: string): Promise<string> {
    const prompt = `You are a horse racing expert. Given this query: "${query}", provide a brief analysis of what the user is looking for in horse racing data. Keep your response concise and focused on horse racing insights.`;
    
    return this.createResponse(prompt);
  }
}
