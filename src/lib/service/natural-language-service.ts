import { BetfairService } from "./betfair-service";
import { OpenAIClient } from "./openai-client";
import { MongoScriptExecutor } from "./mongo-script-executor";
import { Db } from "mongodb";

export interface NaturalLanguageResponse {
  query: string;
  timestamp: Date;
  confidence: number;
  aiAnalysis?: string;
  mongoScript?: string;
  mongoResults?: any[];
  formattedResults?: string;
  naturalLanguageInterpretation?: string;
  noResultsFound?: boolean;
  noResultsMessage?: string;
  scriptGenerated?: boolean;
  databaseConnected?: boolean;
  scriptExecutionError?: string;
}

export class NaturalLanguageService {
  private betfairService?: BetfairService;
  private openaiClient: OpenAIClient;
  private db?: Db;
  private mongoScriptExecutor?: MongoScriptExecutor;

  constructor(betfairService?: BetfairService, db?: Db) {
    this.betfairService = betfairService;
    this.openaiClient = new OpenAIClient();
    this.db = db;
    if (db) {
      this.mongoScriptExecutor = new MongoScriptExecutor(db);
    }
  }

  private extractMongoScript(aiAnalysis: string): string | null {
    try {
      // Try to parse the entire response as JSON
      const parsed = JSON.parse(aiAnalysis.trim());
      return parsed.mongoScript || null;
    } catch (error) {
      // If parsing fails, look for JSON code blocks
      const codeBlockRegex = /```(?:json|javascript|js)?\s*\n([\s\S]*?)\n```/;
      const match = aiAnalysis.match(codeBlockRegex);

      if (match && match[1]) {
        try {
          const parsed = JSON.parse(match[1].trim());
          return parsed.mongoScript || null;
        } catch (parseError) {
          console.error("Failed to parse JSON from code block:", parseError);
          return null;
        }
      }

      // If no code block, try to find JSON in the text
      const jsonMatch = aiAnalysis.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          return parsed.mongoScript || null;
        } catch (parseError) {
          console.error("Failed to parse JSON from text:", parseError);
          return null;
        }
      }

      return null;
    }
  }

  private async executeMongoScript(
    script: string
  ): Promise<{ data: any[]; error?: string }> {
    if (!this.mongoScriptExecutor) {
      throw new Error("MongoDB script executor not available");
    }

    try {
      const result = await this.mongoScriptExecutor.executeScript(script);

      if (result.success) {
        return { data: result.data || [] };
      } else {
        return { data: [], error: result.error };
      }
    } catch (error) {
      console.error("Error executing MongoDB script:", error);
      return {
        data: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async processQuery(query: string): Promise<NaturalLanguageResponse> {
    // Simulate processing delay
    await new Promise(resolve => setTimeout(resolve, 500));

    // Call OpenAI for analysis
    let aiAnalysis: string | undefined;
    let mongoScript: string | null = null;
    let mongoResults: any[] = [];
    let naturalLanguageInterpretation: string | undefined;
    let aiResponse: any = null;
    let scriptExecutionError: string | undefined;

    try {
      // Always try to get AI response first
      aiResponse = await this.openaiClient.createHorseQueryResponse(query);

      if (aiResponse) {
        mongoScript = aiResponse.mongoScript || null;
        naturalLanguageInterpretation =
          aiResponse.naturalLanguageInterpretation || undefined;

        // Execute the MongoDB script if found and database is available
        if (mongoScript && this.mongoScriptExecutor) {
          console.log("Executing MongoDB script:", mongoScript);
          const scriptResult = await this.executeMongoScript(mongoScript);
          mongoResults = scriptResult.data;
          scriptExecutionError = scriptResult.error;
          console.log("MongoDB script results:", mongoResults);

          // If script execution failed, try to get a corrected query from AI
          if (scriptExecutionError && this.openaiClient) {
            console.log(
              "Script execution failed, requesting corrected query from AI"
            );
            console.log("Original script that failed:", mongoScript);
            console.log("Error details:", scriptExecutionError);

            try {
              const correctedResponse = await this.requestCorrectedQuery(
                query,
                mongoScript,
                scriptExecutionError
              );

              if (correctedResponse && correctedResponse.mongoScript) {
                console.log(
                  "Retrying with corrected script:",
                  correctedResponse.mongoScript
                );
                const correctedScriptResult = await this.executeMongoScript(
                  correctedResponse.mongoScript
                );
                mongoResults = correctedScriptResult.data;
                scriptExecutionError = correctedScriptResult.error;
                mongoScript = correctedResponse.mongoScript; // Update to use corrected script
                naturalLanguageInterpretation =
                  correctedResponse.naturalLanguageInterpretation ||
                  naturalLanguageInterpretation;
                console.log("Corrected MongoDB script results:", mongoResults);
              }
            } catch (error) {
              console.error("Error getting corrected query:", error);
              // Continue with original error
            }
          }

          // If no results found, we'll handle this gracefully instead of throwing an error
          if (mongoResults.length === 0 && !scriptExecutionError) {
            console.log(
              "No results found for script, continuing with empty results"
            );
          }
        } else if (mongoScript && !this.mongoScriptExecutor) {
          console.log(
            "Database connection not available, but AI response received"
          );
        } else if (!mongoScript) {
          console.log("No MongoDB script generated, but AI response received");
        }
      } else {
        console.log("Failed to get AI analysis from OpenAI");
      }
    } catch (error) {
      console.error("Error in processQuery:", error);
      // Don't throw error - we want to return the AI response if available
    }

    // Determine if we have a valid database script scenario
    const hasValidScript =
      mongoScript &&
      this.mongoScriptExecutor &&
      mongoScript !== "{}" &&
      mongoScript !== "null";
    const scriptExecuted = hasValidScript && mongoResults.length > 0;

    // Generate appropriate message based on the scenario
    let noResultsMessage: string | undefined;
    if (!mongoScript || mongoScript === "{}" || mongoScript === "null") {
      noResultsMessage =
        "I couldn't generate a database script for your question, but I can still help with general information about horse racing!";
    } else if (!this.mongoScriptExecutor) {
      noResultsMessage =
        "Database connection is not available right now, but I can still provide general assistance.";
    } else if (scriptExecutionError) {
      noResultsMessage = `Script execution failed: ${scriptExecutionError}`;
    } else if (hasValidScript && mongoResults.length === 0) {
      // Only show "no results" message when we actually have a valid script but no results
      noResultsMessage =
        "No data found matching your query. This could mean the horse name doesn't exist in our database, or there are no records for the specified criteria.";
    }

    // Format MongoDB results using AI if we have results
    let formattedResults = undefined;
    if (mongoResults && mongoResults.length > 0 && this.openaiClient) {
      try {
        formattedResults = await this.formatMongoResultsWithAI(
          query,
          mongoResults,
          mongoScript || undefined
        );
      } catch (error) {
        console.error("Error formatting results with AI:", error);
        // Fall back to raw results if AI formatting fails
        formattedResults = JSON.stringify(mongoResults, null, 2);
      }
    }

    // Return the response with appropriate flags
    return {
      query: query,
      timestamp: new Date(),
      confidence: hasValidScript ? 0.95 : 0.7, // Lower confidence when no script
      aiAnalysis: aiResponse ? JSON.stringify(aiResponse) : undefined,
      mongoScript: mongoScript || undefined,
      mongoResults: mongoResults,
      formattedResults: formattedResults,
      naturalLanguageInterpretation: naturalLanguageInterpretation || undefined,
      noResultsFound: !hasValidScript || mongoResults.length === 0,
      noResultsMessage,
      scriptGenerated: !!mongoScript,
      databaseConnected: !!this.mongoScriptExecutor,
      scriptExecutionError,
    };
  }

  /**
   * Requests a corrected MongoDB query from AI when script execution fails
   */
  private async requestCorrectedQuery(
    originalQuery: string,
    failedScript: string,
    errorMessage: string
  ): Promise<any> {
    const prompt = `You are a MongoDB expert helping to fix a failed database query.

Original User Query: "${originalQuery}"

Failed MongoDB Script:
${failedScript}

Error Message: ${errorMessage}

Please provide a corrected MongoDB script that will work properly. The script should:
1. Use correct MongoDB syntax and methods
2. Access the appropriate collections (market_definitions, price_updates, etc.)
3. Use proper aggregation pipelines or find operations
4. Handle the specific query requirements

Return your response in JSON format with:
- mongoScript: the corrected MongoDB script
- naturalLanguageInterpretation: explanation of what the corrected script does

Example response format:
{
  "mongoScript": "db.market_definitions.find({\"marketId\": \"1.238051516\"}).sort({\"timestamp\": -1}).limit(1)",
  "naturalLanguageInterpretation": "This corrected script finds the most recent market definition for the specified market ID."
}`;

    try {
      const response = await this.openaiClient.createResponse(prompt);
      console.log("Raw corrected query response:", response);

      // Clean the response to extract JSON
      let jsonString = response.trim();

      // Remove markdown code blocks if present
      const codeBlockMatch = jsonString.match(/```json\s*([\s\S]*?)\s*```/);
      if (codeBlockMatch) {
        jsonString = codeBlockMatch[1].trim();
        console.log("Extracted JSON from code block:", jsonString);
      }

      // Try to parse the cleaned JSON
      try {
        const parsed = JSON.parse(jsonString);
        console.log("Successfully parsed corrected query:", parsed);
        return parsed;
      } catch (parseError) {
        console.error(
          "Failed to parse corrected query response as JSON:",
          parseError
        );
        console.error("JSON string that failed to parse:", jsonString);

        // Try to extract just the mongoScript if full JSON parsing fails
        const scriptMatch = jsonString.match(/"mongoScript":\s*"([^"]+)"/);
        if (scriptMatch) {
          console.log(
            "Extracted mongoScript from failed JSON:",
            scriptMatch[1]
          );
          return {
            mongoScript: scriptMatch[1],
            naturalLanguageInterpretation:
              "Corrected MongoDB script generated by AI",
          };
        }

        throw new Error("Could not parse corrected query response");
      }
    } catch (error) {
      console.error("Error requesting corrected query:", error);
      throw error;
    }
  }

  /**
   * Formats MongoDB results using AI to create human-readable text
   */
  private async formatMongoResultsWithAI(
    query: string,
    mongoResults: any[],
    mongoScript?: string
  ): Promise<string> {
    const prompt = `You are a data formatting assistant for a horse racing database. 

User Query: "${query}"

MongoDB Script Used: ${mongoScript || "N/A"}

Raw MongoDB Results:
${JSON.stringify(mongoResults, null, 2)}

Please format these results into a clear, human-readable response that directly answers the user's query. 

Guidelines:
1. Use clear, conversational language
2. Organize the data in a logical way (e.g., by race, by horse, by time)
3. Include relevant details like race names, dates, status, number of runners, etc.
4. Use bullet points or numbered lists for multiple items
5. Highlight important information
6. If there are multiple races, group them appropriately
7. Use emojis sparingly but effectively (e.g., 🏇 for races, 🟢 for active status)
8. Make it easy to scan and understand quickly

Format the response as plain text (no markdown formatting).`;

    try {
      const response = await this.openaiClient.createResponse(prompt);
      return response.trim();
    } catch (error) {
      console.error("Error calling OpenAI for result formatting:", error);
      throw error;
    }
  }
}
