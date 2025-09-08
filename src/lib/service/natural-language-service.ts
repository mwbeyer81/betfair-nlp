import { BetfairService } from "./betfair-service";
import { OpenAIClient } from "./openai-client";
import { MongoScriptExecutor } from "./mongo-script-executor";
import { Db } from "mongodb";

export interface Horse {
  id: string;
  name: string;
  odds: number;
  position: number;
  jockey: string;
  trainer: string;
  weight: number;
  age: number;
  form: string[];
}

export interface NaturalLanguageResponse {
  horses: Horse[];
  query: string;
  timestamp: Date;
  confidence: number;
  aiAnalysis?: string;
  mongoScript?: string;
  mongoResults?: any[];
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

    // Return the response with appropriate flags
    return {
      horses: [], // Empty since we're returning MongoDB results
      query: query,
      timestamp: new Date(),
      confidence: hasValidScript ? 0.95 : 0.7, // Lower confidence when no script
      aiAnalysis: aiResponse ? JSON.stringify(aiResponse) : undefined,
      mongoScript: mongoScript || undefined,
      mongoResults: mongoResults,
      naturalLanguageInterpretation: naturalLanguageInterpretation || undefined,
      noResultsFound: !hasValidScript || mongoResults.length === 0,
      noResultsMessage,
      scriptGenerated: !!mongoScript,
      databaseConnected: !!this.mongoScriptExecutor,
      scriptExecutionError,
    };
  }

  async getHorsesByQuery(query: string): Promise<Horse[]> {
    const response = await this.processQuery(query);
    return response.horses;
  }

  async getTopHorses(limit: number = 5): Promise<Horse[]> {
    const response = await this.processQuery("Show me the top horses");
    return response.horses.slice(0, limit);
  }

  async getHorsesByOdds(maxOdds: number): Promise<Horse[]> {
    const response = await this.processQuery(
      `Show horses with odds under ${maxOdds}`
    );
    return response.horses.filter(horse => horse.odds <= maxOdds);
  }
}
