import OpenAI from "openai";
import config from "config";
import { readFileSync } from "fs";
import { join } from "path";

export class OpenAIClient {
  private client: OpenAI;
  private instructions: string;

  constructor() {
    const apiKey = config.get<string>("openai.apiKey");
    if (!apiKey) {
      throw new Error("OpenAI API key not found in configuration");
    }

    this.client = new OpenAI({
      apiKey: apiKey,
    });

    // Load instructions from markdown file
    try {
      const instructionsPath = join(
        __dirname,
        "prompts",
        "horse-racing-assistant.md"
      );
      this.instructions = readFileSync(instructionsPath, "utf-8");
    } catch (error) {
      console.error("Failed to load instructions file:", error);
      throw new Error("Could not load horse racing assistant instructions");
    }
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

  async createHorseQueryResponse(
    query: string
  ): Promise<{ mongoScript: string; naturalLanguageInterpretation: string }> {
    const combinedInstructions = this.instructions.replace("${query}", query);

    const response = await this.createResponse(combinedInstructions);

    try {
      // Try to parse the response as JSON
      const parsed = JSON.parse(response.trim());
      return {
        mongoScript: parsed.mongoScript,
        naturalLanguageInterpretation: parsed.naturalLanguageInterpretation,
      };
    } catch (error) {
      // If parsing fails, try to extract JSON from markdown code blocks
      const codeBlockRegex = /```(?:json|javascript|js)?\s*\n([\s\S]*?)\n```/;
      const match = response.match(codeBlockRegex);

      if (match && match[1]) {
        try {
          const parsed = JSON.parse(match[1].trim());
          return {
            mongoScript: parsed.mongoScript,
            naturalLanguageInterpretation: parsed.naturalLanguageInterpretation,
          };
        } catch (parseError) {
          console.error("Failed to parse JSON from code block:", parseError);
          throw new Error(
            "Could not extract MongoDB script and interpretation from AI response"
          );
        }
      }

      // If no code block, try to find JSON in the text
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          return {
            mongoScript: parsed.mongoScript,
            naturalLanguageInterpretation: parsed.naturalLanguageInterpretation,
          };
        } catch (parseError) {
          console.error("Failed to parse JSON from text:", parseError);
          throw new Error(
            "Could not extract MongoDB script and interpretation from AI response"
          );
        }
      }

      console.error("Raw AI response:", response);
      throw new Error(
        "Could not extract MongoDB script and interpretation from AI response"
      );
    }
  }
}
