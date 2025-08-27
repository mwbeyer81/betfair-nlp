import { BetfairService } from "./betfair-service";
import { OpenAIClient } from "./openai-client";
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
  mongoQuery?: string;
  mongoResults?: any[];
}

export class NaturalLanguageService {
  private betfairService?: BetfairService;
  private openaiClient: OpenAIClient;
  private db?: Db;

  constructor(betfairService?: BetfairService, db?: Db) {
    this.betfairService = betfairService;
    this.openaiClient = new OpenAIClient();
    this.db = db;
  }

  private extractMongoQuery(aiAnalysis: string): string | null {
    try {
      // Try to parse the entire response as JSON
      const parsed = JSON.parse(aiAnalysis.trim());
      return JSON.stringify(parsed);
    } catch (error) {
      // If parsing fails, look for JSON code blocks
      const codeBlockRegex = /```(?:json|javascript|js)?\s*\n([\s\S]*?)\n```/;
      const match = aiAnalysis.match(codeBlockRegex);

      if (match && match[1]) {
        try {
          const parsed = JSON.parse(match[1].trim());
          return JSON.stringify(parsed);
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
          return JSON.stringify(parsed);
        } catch (parseError) {
          console.error("Failed to parse JSON from text:", parseError);
          return null;
        }
      }

      return null;
    }
  }

  private async executeMongoQuery(query: string): Promise<any[]> {
    try {
      // Parse the JSON command
      const command = JSON.parse(query);

      // Handle different command types
      if (command.find) {
        // Handle find operations
        const collection = this.db!.collection(command.find);
        let cursor = collection.find(
          command.filter || {},
          command.projection || {}
        );

        if (command.sort) {
          cursor = cursor.sort(command.sort);
        }

        if (command.limit) {
          cursor = cursor.limit(command.limit);
        }

        return await cursor.toArray();
      } else if (command.findOne) {
        // Handle findOne operations
        const collection = this.db!.collection(command.findOne);
        const result = await collection.findOne(
          command.filter || {},
          command.projection || {}
        );
        return result ? [result] : [];
      } else if (command.aggregate) {
        // Handle aggregation operations
        const collection = this.db!.collection(command.aggregate);
        const cursor = collection.aggregate(command.pipeline || []);
        return await cursor.toArray();
      } else {
        // For other commands, try using db.command()
        const result = await this.db!.command(command);

        // Handle different result formats
        if (result.cursor) {
          // For find operations, we need to iterate through the cursor
          const cursor = this.db!.collection(
            command.find || command.collection
          ).find(command.filter || {}, command.projection || {});

          if (command.sort) {
            cursor.sort(command.sort);
          }

          if (command.limit) {
            cursor.limit(command.limit);
          }

          return await cursor.toArray();
        } else if (result.documents) {
          // For some commands, results might be in documents field
          return result.documents;
        } else {
          // For other commands, return the result directly
          return [result];
        }
      }
    } catch (error) {
      console.error("Error executing MongoDB command:", error);
      throw error;
    }
  }

  async processQuery(query: string): Promise<NaturalLanguageResponse> {
    // Simulate processing delay
    await new Promise(resolve => setTimeout(resolve, 500));

    // Call OpenAI for analysis
    let aiAnalysis: string | undefined;
    let mongoQuery: string | null = null;
    let mongoResults: any[] = [];

    try {
      aiAnalysis = await this.openaiClient.createHorseQueryResponse(query);

      // Extract MongoDB query from AI analysis
      if (aiAnalysis) {
        mongoQuery = this.extractMongoQuery(aiAnalysis);

        // Execute the MongoDB query if found
        if (mongoQuery && this.db) {
          console.log("Executing MongoDB query:", mongoQuery);
          mongoResults = await this.executeMongoQuery(mongoQuery);
          console.log("MongoDB query results:", mongoResults);

          // If no results found, throw an error
          if (mongoResults.length === 0) {
            throw new Error(`No results found for query: ${mongoQuery}`);
          }
        } else if (mongoQuery && !this.db) {
          throw new Error("Database connection not available");
        } else if (!mongoQuery) {
          throw new Error("Could not extract MongoDB query from AI analysis");
        }
      } else {
        throw new Error("Failed to get AI analysis from OpenAI");
      }
    } catch (error) {
      console.error("Error in processQuery:", error);
      throw error; // Re-throw the error instead of continuing with stubbed data
    }

    // Return the MongoDB results directly
    return {
      horses: [], // Empty since we're returning MongoDB results
      query: query,
      timestamp: new Date(),
      confidence: 0.95, // Higher confidence since we have real data
      aiAnalysis,
      mongoQuery: mongoQuery || undefined,
      mongoResults: mongoResults,
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
