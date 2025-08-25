import { Collection, Db } from "mongodb";
import {
  MarketStatusDocument,
  MarketDefinition,
  MarketStatus,
} from "../../types/betfair";

export class MarketStatusDAO {
  private collection: Collection<MarketStatusDocument>;

  constructor(db: Db) {
    this.collection = db.collection<MarketStatusDocument>("market_statuses");
  }

  /**
   * Insert a market status document
   */
  public async insert(
    marketDef: MarketDefinition,
    marketId: string,
    timestamp: Date,
    changeId: string
  ): Promise<void> {
    const document: MarketStatusDocument = {
      marketId,
      status: marketDef.status,
      timestamp,
      changeId,
      publishTime: timestamp,
      eventId: marketDef.eventId,
      eventName: marketDef.eventName,
      numberOfActiveRunners: marketDef.numberOfActiveRunners,
    };

    try {
      await this.collection.insertOne(document);
      console.log(
        `Inserted market status for market ${marketId}: ${marketDef.status}`
      );
    } catch (error) {
      console.error(
        `Failed to insert market status for market ${marketId}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Get market status history for a specific market
   */
  public async getByMarketId(
    marketId: string,
    limit: number = 100
  ): Promise<MarketStatusDocument[]> {
    return await this.collection
      .find({ marketId })
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();
  }

  /**
   * Get market statuses by status type
   */
  public async getByStatus(
    status: MarketStatus,
    limit: number = 100
  ): Promise<MarketStatusDocument[]> {
    return await this.collection
      .find({ status })
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();
  }

  /**
   * Get market statuses for a specific event
   */
  public async getByEventId(
    eventId: string,
    limit: number = 100
  ): Promise<MarketStatusDocument[]> {
    return await this.collection
      .find({ eventId })
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();
  }

  /**
   * Get latest status for a specific market
   */
  public async getLatestStatusByMarketId(
    marketId: string
  ): Promise<MarketStatusDocument | null> {
    return await this.collection.findOne(
      { marketId },
      { sort: { timestamp: -1 } }
    );
  }

  /**
   * Get status transitions for a market
   */
  public async getStatusTransitions(
    marketId: string
  ): Promise<MarketStatusDocument[]> {
    return await this.collection
      .find({ marketId })
      .sort({ timestamp: 1 })
      .toArray();
  }

  /**
   * Get markets by active runner count
   */
  public async getByActiveRunnerCount(
    minCount: number,
    maxCount?: number
  ): Promise<MarketStatusDocument[]> {
    const query: any = { numberOfActiveRunners: { $gte: minCount } };
    if (maxCount !== undefined) {
      query.numberOfActiveRunners.$lte = maxCount;
    }

    return await this.collection.find(query).sort({ timestamp: -1 }).toArray();
  }

  /**
   * Create indexes for better query performance
   */
  public async createIndexes(): Promise<void> {
    try {
      await this.collection.createIndex({ marketId: 1, timestamp: -1 });
      await this.collection.createIndex({ status: 1, timestamp: -1 });
      await this.collection.createIndex({ eventId: 1, timestamp: -1 });
      await this.collection.createIndex({ numberOfActiveRunners: 1 });
      await this.collection.createIndex({ changeId: 1 }, { unique: true });
      console.log("Market status indexes created successfully");
    } catch (error) {
      console.error("Failed to create market status indexes:", error);
      throw error;
    }
  }
}
