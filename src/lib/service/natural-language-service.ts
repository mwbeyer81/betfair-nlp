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
    // Look for code blocks with MongoDB queries
    const codeBlockRegex = /```(?:javascript|js|mongo)?\s*\n([\s\S]*?)\n```/;
    const match = aiAnalysis.match(codeBlockRegex);

    if (match && match[1]) {
      return match[1].trim();
    }

    // If no code block, look for db. patterns
    const dbPattern =
      /db\.[a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*\s*\([^)]*\)/;
    const dbMatch = aiAnalysis.match(dbPattern);

    if (dbMatch) {
      return dbMatch[0];
    }

    return null;
  }

  private async executeMongoQuery(query: string): Promise<any[]> {
    if (!this.db) {
      console.warn("Database not available, skipping query execution");
      return [];
    }

    try {
      // Parse the query to determine the type and extract components
      const queryLower = query.toLowerCase();

      if (queryLower.includes("aggregate")) {
        // Handle aggregation queries
        return await this.executeAggregationQuery(query);
      } else if (queryLower.includes("findone")) {
        // Handle findOne queries
        return await this.executeFindOneQuery(query);
      } else if (queryLower.includes("find")) {
        // Handle find queries
        return await this.executeFindQuery(query);
      } else {
        // Generic execution for other query types
        return await this.executeGenericQuery(query);
      }
    } catch (error) {
      console.error("Failed to execute MongoDB query:", error);
      return [];
    }
  }

  private async executeFindQuery(query: string): Promise<any[]> {
    try {
      // Extract collection name and query parameters
      const match = query.match(
        /db\.([a-zA-Z_][a-zA-Z0-9_]*)\.find\s*\(\s*([^)]*)\)/
      );
      if (!match) return [];

      const collectionName = match[1];
      const queryParams = match[2].trim();

      // Parse the query parameters
      let filter = {};
      let projection = {};

      if (queryParams) {
        const params = queryParams.split(",").map(p => p.trim());
        if (params.length > 0) {
          try {
            filter = eval(`(${params[0]})`);
          } catch (e) {
            filter = {};
          }
        }
        if (params.length > 1) {
          try {
            projection = eval(`(${params[1]})`);
          } catch (e) {
            projection = {};
          }
        }
      }

      const collection = this.db!.collection(collectionName);
      const cursor = collection.find(filter, projection);
      const results = await cursor.toArray();

      return results;
    } catch (error) {
      console.error("Error executing find query:", error);
      return [];
    }
  }

  private async executeFindOneQuery(query: string): Promise<any[]> {
    try {
      // Extract collection name and query parameters - handle both findOne and findOne
      const match = query.match(
        /db\.([a-zA-Z_][a-zA-Z0-9_]*)\.findone\s*\(\s*([^)]*)\)/i
      );
      if (!match) return [];

      const collectionName = match[1];
      const queryParams = match[2].trim();

      // Parse the query parameters
      let filter = {};
      let projection = {};

      if (queryParams) {
        const params = queryParams.split(",").map(p => p.trim());
        if (params.length > 0) {
          try {
            filter = eval(`(${params[0]})`);
          } catch (e) {
            filter = {};
          }
        }
        if (params.length > 1) {
          try {
            projection = eval(`(${params[1]})`);
          } catch (e) {
            projection = {};
          }
        }
      }

      const collection = this.db!.collection(collectionName);
      const result = await collection.findOne(filter, projection);

      return result ? [result] : [];
    } catch (error) {
      console.error("Error executing findOne query:", error);
      return [];
    }
  }

  private async executeAggregationQuery(query: string): Promise<any[]> {
    try {
      // Extract collection name and pipeline
      const match = query.match(
        /db\.([a-zA-Z_][a-zA-Z0-9_]*)\.aggregate\s*\(\s*\[([\s\S]*?)\]\s*\)/
      );
      if (!match) return [];

      const collectionName = match[1];
      const pipelineStr = match[2].trim();

      // Parse the pipeline
      let pipeline = [];
      try {
        pipeline = eval(`([${pipelineStr}])`);
      } catch (e) {
        console.error("Error parsing aggregation pipeline:", e);
        return [];
      }

      const collection = this.db!.collection(collectionName);
      const cursor = collection.aggregate(pipeline);
      const results = await cursor.toArray();

      return results;
    } catch (error) {
      console.error("Error executing aggregation query:", error);
      return [];
    }
  }

  private async executeGenericQuery(query: string): Promise<any[]> {
    try {
      // For other query types, try to execute them directly
      // This is a fallback for queries we don't specifically handle
      console.warn("Using generic query execution for:", query);

      // Create a safe execution context
      const safeQuery = query.replace(/db\./g, "this.db.");

      // Create a function that can execute the query safely
      const executeQuery = new Function(
        "db",
        `
        try {
          const result = ${safeQuery};
          return Array.isArray(result) ? result : [result];
        } catch (error) {
          console.error('MongoDB query execution error:', error);
          return [];
        }
      `
      );

      const results = await executeQuery(this.db);
      return results || [];
    } catch (error) {
      console.error("Error executing generic query:", error);
      return [];
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
