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
      const response = await this.client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "user",
            content: input,
          },
        ],
        temperature: 0.1,
      });

      return response.choices[0]?.message?.content || "";
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
      console.log("🔍 Raw OpenAI response:", response);
      const parsed = JSON.parse(response.trim());
      console.log("🔍 Parsed JSON:", JSON.stringify(parsed, null, 2));
      console.log("🔍 mongoScript value:", parsed.mongoScript);
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
          // Clean the JSON string before parsing
          let jsonString = match[1].trim();
          console.log("🔍 Extracted from code block:", jsonString);

          // Remove any extra quotes that might be wrapping the JSON
          if (jsonString.startsWith('"') && jsonString.endsWith('"')) {
            jsonString = jsonString.slice(1, -1);
            console.log("🔍 Removed outer quotes:", jsonString);
          }

          // Don't unescape - the JSON needs the escaped quotes to be valid
          console.log("🔍 JSON string ready for parsing:", jsonString);

          const parsed = JSON.parse(jsonString);
          console.log(
            "🔍 Parsed JSON from code block:",
            JSON.stringify(parsed, null, 2)
          );
          console.log("🔍 mongoScript from code block:", parsed.mongoScript);
          return {
            mongoScript: parsed.mongoScript,
            naturalLanguageInterpretation: parsed.naturalLanguageInterpretation,
          };
        } catch (parseError) {
          console.error("Failed to parse JSON from code block:", parseError);
          // Try to fix common JSON issues
          const fixedJson = this.fixJsonString(match[1].trim());
          try {
            const parsed = JSON.parse(fixedJson);
            return {
              mongoScript: parsed.mongoScript,
              naturalLanguageInterpretation:
                parsed.naturalLanguageInterpretation,
            };
          } catch (fixError) {
            console.error("Failed to parse fixed JSON:", fixError);
            throw new Error(
              "Could not extract MongoDB script and interpretation from AI response"
            );
          }
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
          // Try to fix common JSON issues
          const fixedJson = this.fixJsonString(jsonMatch[0]);
          try {
            const parsed = JSON.parse(fixedJson);
            return {
              mongoScript: parsed.mongoScript,
              naturalLanguageInterpretation:
                parsed.naturalLanguageInterpretation,
            };
          } catch (fixError) {
            console.error("Failed to parse fixed JSON:", fixError);
            throw new Error(
              "Could not extract MongoDB script and interpretation from AI response"
            );
          }
        }
      }

      console.error("Raw AI response:", response);
      throw new Error(
        "Could not extract MongoDB script and interpretation from AI response"
      );
    }
  }

  /**
   * Attempts to fix common JSON parsing issues by manually extracting values
   */
  private fixJsonString(jsonString: string): string {
    try {
      // Find the mongoScript value by looking for the pattern
      const mongoScriptStart = jsonString.indexOf('"mongoScript": "') + 15;

      // Find the end of mongoScript by looking for the closing quote before naturalLanguageInterpretation
      const interpretationStart = jsonString.indexOf(
        '"naturalLanguageInterpretation": "'
      );
      const mongoScriptEnd = jsonString.lastIndexOf('",', interpretationStart);

      // Find the naturalLanguageInterpretation value - look for the end of the JSON object
      const interpretationValueStart = interpretationStart + 35;

      // Find the end of the interpretation by looking for the closing brace of the JSON object
      const jsonEnd = jsonString.lastIndexOf("}");
      const interpretationEnd = jsonString.lastIndexOf('"', jsonEnd);

      if (
        mongoScriptStart > 14 &&
        mongoScriptEnd > mongoScriptStart &&
        interpretationValueStart > 34 &&
        interpretationEnd > interpretationValueStart
      ) {
        const mongoScript = jsonString.substring(
          mongoScriptStart,
          mongoScriptEnd
        );
        const interpretation = jsonString.substring(
          interpretationValueStart,
          interpretationEnd
        );

        // Create a properly formatted JSON object
        return JSON.stringify({
          mongoScript: mongoScript,
          naturalLanguageInterpretation: interpretation,
        });
      }
    } catch (error) {
      console.error("Error in fixJsonString:", error);
    }

    return jsonString;
  }
}
