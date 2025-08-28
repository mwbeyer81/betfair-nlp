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

  async createHorseQueryResponse(
    query: string
  ): Promise<{ mongoQuery: string; naturalLanguageInterpretation: string }> {
    const combinedInstructions = `You are a MongoDB assistant with expertise in horse racing data. The database contains 3 collections: market_definitions, market_statuses, and price_updates. A **runner** means a horse. A **market** means a horse race. An **event** means a race day (like "Cheltenham 1st Jan"). Below is the schema for each collection:

### market_definitions
Represents a horse race (market) with all its details and runners.
- _id (ObjectId) → MongoDB document ID
- marketId (string) → unique identifier for the market (horse race)
- eventId (string) → links to the parent event
- eventTypeId (string) → type of event (e.g., "7" for horse racing)
- name (string) → name of the market (e.g., "Betfair Exchange Handicap Chase")
- eventName (string) → name of the event (e.g., "Cheltenham 1st Jan")
- marketTime (string) → scheduled start time of the race (ISO string)
- suspendTime (string) → when betting is suspended (ISO string)
- status (string) → market status: "OPEN", "SUSPENDED", "CLOSED"
- numberOfActiveRunners (number) → number of active horses
- numberOfWinners (number) → number of winners (usually 1)
- runners (array of objects) → list of horses running in this market
  - id (number) → unique runner (horse) ID
  - name (string) → horse name
  - status (string) → runner status: "ACTIVE", "HIDDEN", "WINNER", "LOSER"
  - sortPriority (number) → position/priority of the horse
  - adjustmentFactor (number) → handicap adjustment
- countryCode (string) → country code (e.g., "GB")
- timezone (string) → timezone (e.g., "Europe/London")
- marketType (string) → type of market (e.g., "ANTEPOST_WIN")
- bettingType (string) → type of betting (e.g., "ODDS")
- bspMarket (boolean) → whether it's a BSP market
- turnInPlayEnabled (boolean) → whether in-play betting is enabled
- persistenceEnabled (boolean) → whether persistence is enabled
- marketBaseRate (number) → base commission rate
- bspReconciled (boolean) → whether BSP is reconciled
- complete (boolean) → whether market is complete
- inPlay (boolean) → whether market is in-play
- crossMatching (boolean) → whether cross matching is enabled
- runnersVoidable (boolean) → whether runners can be voided
- betDelay (number) → bet delay in seconds
- regulators (array of strings) → regulatory bodies
- discountAllowed (boolean) → whether discounts are allowed
- openDate (string) → when the event opens (ISO string)
- version (number) → version number
- settledTime (string, optional) → when the market was settled (ISO string)
- timestamp (Date) → when this definition was recorded
- changeId (string) → identifier for this update
- publishTime (Date) → when this was published

### market_statuses
Represents status changes for horse races (markets).
- _id (ObjectId) → MongoDB document ID
- marketId (string) → unique identifier for the market (horse race)
- status (string) → market status: "OPEN", "SUSPENDED", "CLOSED"
- eventId (string) → links to the parent event
- eventName (string) → name of the event (e.g., "Cheltenham 1st Jan")
- numberOfActiveRunners (number) → number of active horses
- timestamp (Date) → when this status change was recorded
- changeId (string) → identifier for this update
- publishTime (Date) → when this was published

### price_updates
Represents live odds updates for each horse.
- _id (ObjectId) → MongoDB document ID
- marketId (string) → the race this update belongs to
- runnerId (number) → horse ID (matches market_definitions.runners.id)
- runnerName (string) → horse name
- lastTradedPrice (number) → most recent traded price (odds)
- eventId (string) → links to the parent event
- eventName (string) → name of the event (e.g., "Cheltenham 1st Jan")
- timestamp (Date) → when the update was recorded
- changeId (string) → identifier for this update
- publishTime (Date) → when this was published

### Instructions
When the user gives a **natural language query**, you need to:

1. **Generate a MongoDB query**: Convert the natural language query into a valid MongoDB command object that can be passed to db.command().
2. **Provide a natural language interpretation**: Explain what the MongoDB query does in simple, user-friendly terms.

### MongoDB Query Generation
- Return a valid JSON string that represents the MongoDB command object
- Use the correct collection names: market_definitions, market_statuses, price_updates
- Example mappings:
  - "List all runners in race X" → {"find": "market_definitions", "filter": {"name": "X"}, "projection": {"runners": 1}}
  - "Show price changes for horse Y in race Z" → {"find": "price_updates", "filter": {"runnerName": "Y", "marketId": "Z"}}
  - "Show status changes for race X" → {"find": "market_statuses", "filter": {"marketId": "X"}}
  - "Show all open markets" → {"find": "market_definitions", "filter": {"status": "OPEN"}}
  - "Show latest prices for all horses" → {"find": "price_updates", "sort": {"timestamp": -1}}
  - "Show races with more than 10 runners" → {"find": "market_definitions", "filter": {"numberOfActiveRunners": {"$gt": 10}}}

### Natural Language Interpretation
- Explain what the MongoDB query is doing in simple, conversational terms
- Use the schema knowledge to provide context about what data is being retrieved
- Keep it user-friendly for someone who doesn't know MongoDB syntax

### Response Format
Return your response in this exact format:
{
  "mongoQuery": "the MongoDB query as a JSON string",
  "naturalLanguageInterpretation": "a clear explanation of what the query does"
}

User Query: "${query}"`;

    const response = await this.createResponse(combinedInstructions);

    try {
      // Try to parse the response as JSON
      const parsed = JSON.parse(response.trim());
      return {
        mongoQuery: parsed.mongoQuery,
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
            mongoQuery: parsed.mongoQuery,
            naturalLanguageInterpretation: parsed.naturalLanguageInterpretation,
          };
        } catch (parseError) {
          console.error("Failed to parse JSON from code block:", parseError);
          throw new Error(
            "Could not extract MongoDB query and interpretation from AI response"
          );
        }
      }

      // If no code block, try to find JSON in the text
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          return {
            mongoQuery: parsed.mongoQuery,
            naturalLanguageInterpretation: parsed.naturalLanguageInterpretation,
          };
        } catch (parseError) {
          console.error("Failed to parse JSON from text:", parseError);
          throw new Error(
            "Could not extract MongoDB query and interpretation from AI response"
          );
        }
      }

      console.error("Raw AI response:", response);
      throw new Error(
        "Could not extract MongoDB query and interpretation from AI response"
      );
    }
  }
}
