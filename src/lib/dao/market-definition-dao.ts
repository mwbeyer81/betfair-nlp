import { Collection, Db } from "mongodb";
import {
  MarketDefinitionDocument,
  MarketDefinition,
  MarketStatus,
} from "../../types/betfair";

export class MarketDefinitionDAO {
  private collection: Collection<MarketDefinitionDocument>;

  constructor(db: Db) {
    this.collection =
      db.collection<MarketDefinitionDocument>("market_definitions");
  }

  /**
   * Insert a market definition document
   */
  public async insert(
    marketDef: MarketDefinition,
    marketId: string,
    timestamp: Date,
    changeId: string
  ): Promise<void> {
    const document: MarketDefinitionDocument = {
      ...marketDef,
      marketId,
      timestamp,
      // Create unique changeId by combining original changeId with marketId
      changeId: `${changeId}_${marketId}`,
      publishTime: timestamp,
    };

    try {
      await this.collection.insertOne(document);
      console.log(`Inserted market definition for market ${marketId}`);
    } catch (error) {
      console.error(
        `Failed to insert market definition for market ${marketId}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Get market definitions for a specific market
   */
  public async getByMarketId(
    marketId: string,
    limit: number = 100
  ): Promise<MarketDefinitionDocument[]> {
    return await this.collection
      .find({ marketId })
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();
  }

  /**
   * Get market definitions by event ID
   */
  public async getByEventId(
    eventId: string,
    limit: number = 100
  ): Promise<MarketDefinitionDocument[]> {
    return await this.collection
      .find({ eventId })
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();
  }

  /**
   * Get latest market definition for a market
   */
  public async getLatestByMarketId(
    marketId: string
  ): Promise<MarketDefinitionDocument | null> {
    return await this.collection.findOne(
      { marketId },
      { sort: { timestamp: -1 } }
    );
  }

  /**
   * Get market definitions by status
   */
  public async getByStatus(
    status: MarketStatus,
    limit: number = 100
  ): Promise<MarketDefinitionDocument[]> {
    return await this.collection
      .find({ status })
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();
  }

  /**
   * Create indexes for better query performance
   */
  public async createIndexes(): Promise<void> {
    try {
      await this.collection.createIndex({ marketId: 1, timestamp: -1 });
      await this.collection.createIndex({ eventId: 1, timestamp: -1 });
      await this.collection.createIndex({ status: 1 });
      await this.collection.createIndex({ changeId: 1 }, { unique: true });
      console.log("Market definition indexes created successfully");
    } catch (error) {
      console.error("Failed to create market definition indexes:", error);
      throw error;
    }
  }
}
