import { BetfairService } from "./betfair-service";

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
}

export class NaturalLanguageService {
  private betfairService?: BetfairService;

  constructor(betfairService?: BetfairService) {
    this.betfairService = betfairService;
  }

  async processQuery(query: string): Promise<NaturalLanguageResponse> {
    // Simulate processing delay
    await new Promise(resolve => setTimeout(resolve, 500));

    // Stubbed response with horse data
    const stubbedHorses: Horse[] = [
      {
        id: "horse_001",
        name: "Desert Crown",
        odds: 3.5,
        position: 1,
        jockey: "Richard Kingscote",
        trainer: "Sir Michael Stoute",
        weight: 9.2,
        age: 4,
        form: ["1st", "2nd", "1st", "3rd", "1st"],
      },
      {
        id: "horse_002",
        name: "Baaeed",
        odds: 2.1,
        position: 2,
        jockey: "Jim Crowley",
        trainer: "William Haggas",
        weight: 9.0,
        age: 5,
        form: ["1st", "1st", "1st", "2nd", "1st"],
      },
      {
        id: "horse_003",
        name: "Inspiral",
        odds: 4.2,
        position: 3,
        jockey: "Frankie Dettori",
        trainer: "John & Thady Gosden",
        weight: 8.12,
        age: 3,
        form: ["1st", "1st", "3rd", "1st", "2nd"],
      },
      {
        id: "horse_004",
        name: "Nashwa",
        odds: 6.0,
        position: 4,
        jockey: "Hollie Doyle",
        trainer: "John & Thady Gosden",
        weight: 8.1,
        age: 3,
        form: ["2nd", "1st", "1st", "4th", "1st"],
      },
      {
        id: "horse_005",
        name: "Modern Games",
        odds: 8.5,
        position: 5,
        jockey: "William Buick",
        trainer: "Charlie Appleby",
        weight: 9.1,
        age: 3,
        form: ["1st", "3rd", "1st", "2nd", "1st"],
      },
    ];

    // In a real implementation, this would:
    // 1. Parse the natural language query
    // 2. Convert it to MongoDB aggregation pipeline
    // 3. Query the database using betfairService
    // 4. Return the results

    return {
      horses: stubbedHorses,
      query: query,
      timestamp: new Date(),
      confidence: 0.85,
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
