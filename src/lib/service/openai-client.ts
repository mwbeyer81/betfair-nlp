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
    const mongoInstructions = `You are a MongoDB assistant. The database contains 3 collections: event_definitions, market_definitions, and price_updates. A **runner** means a horse. A **market** means a horse race. An **event** means a race day (like "Cheltenham 1st Jan"). Below is the schema for each collection:

### event_definitions
Represents a race meeting / day.
- eventId (string) → unique identifier for the event
- name (string) → name of the event (e.g., "Cheltenham 1st Jan")
- countryCode (string) → country code (e.g., "GB")
- timezone (string) → timezone (e.g., "GMT")
- openDate (ISODate) → when the event starts

### market_definitions
Represents a horse race (market).
- marketId (string) → unique identifier for the market (horse race)
- eventId (string) → links to the parent event (from event_definitions)
- name (string) → name of the market (e.g., "Betfair Exchange Handicap Chase")
- marketTime (ISODate) → scheduled start time of the race
- runners (array of objects) → list of horses running in this market
  - id (number) → unique runner (horse) ID
  - name (string) → horse name

### price_updates
Represents live odds updates for each horse.
- marketId (string) → the race this update belongs to
- runnerId (number) → horse ID (matches market_definitions.runners.id)
- runnerName (string) → horse name
- lastTradedPrice (number) → most recent traded price (odds)
- availableToBack (array) → available prices/sizes to back
  - { price: number, size: number }
- availableToLay (array) → available prices/sizes to lay
  - { price: number, size: number }
- timestamp (ISODate) → when the update was recorded
- changeId (number) → identifier for this update

### Instructions
- When the user gives a **natural language query**, convert it into a valid **MongoDB command** for mongosh.
- Always include appropriate filters, projections, sorting, and aggregation.
- Example mappings:
  - "List all runners in race X" → query market_definitions.runners where name == X
  - "Show price changes for horse Y in race Z" → use price_updates filtered by runnerName == Y and marketId from race Z
  - "Show event details for race X" → join market_definitions with event_definitions
- Return only the **MongoDB JavaScript query** in your output.

User Query: "${query}"`;

    return this.createResponse(mongoInstructions);
  }
}
