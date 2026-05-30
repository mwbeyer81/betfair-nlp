import { Collection, Db } from "mongodb";
import {
  MarketDefinitionDocument,
  MarketDefinition,
  MarketStatus,
} from "../../types/betfair";

export interface EventGroup {
  eventId: string;
  eventName: string;
  marketIds: string[];
  count: number;
}

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
      changeId,
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
   * Group market definitions by eventId, returning unique markets and doc count per event
   */
  public async groupByEventId(): Promise<EventGroup[]> {
    return await this.collection
      .aggregate<EventGroup>([
        {
          $group: {
            _id: "$eventId",
            eventName: { $first: "$eventName" },
            marketIds: { $addToSet: "$marketId" },
            count: { $sum: 1 },
          },
        },
        {
          $project: {
            _id: 0,
            eventId: "$_id",
            eventName: 1,
            marketIds: 1,
            count: 1,
          },
        },
        { $sort: { count: -1 } },
      ])
      .toArray();
  }

  /**
   * Get unique runners for an event by aggregating across all market definitions,
   * using the most recent definition per market to avoid duplicates over time.
   */
  public async getUniqueRunnersByEventId(
    eventId: string
  ): Promise<Array<{ id: number; name: string; status: string; sortPriority: number }>> {
    return await this.collection
      .aggregate<{ id: number; name: string; status: string; sortPriority: number }>([
        { $match: { eventId } },
        { $sort: { timestamp: -1 } },
        { $group: { _id: "$marketId", runners: { $first: "$runners" } } },
        { $unwind: "$runners" },
        {
          $group: {
            _id: "$runners.id",
            name: { $first: "$runners.name" },
            status: { $first: "$runners.status" },
            sortPriority: { $first: "$runners.sortPriority" },
          },
        },
        {
          $project: {
            _id: 0,
            id: "$_id",
            name: 1,
            status: 1,
            sortPriority: 1,
          },
        },
        { $sort: { sortPriority: 1 } },
      ])
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
      // Compound unique index prevents duplicate changeId + marketId combinations
      await this.collection.createIndex(
        { changeId: 1, marketId: 1 },
        { unique: true }
      );
      console.log("Market definition indexes created successfully");
    } catch (error) {
      console.error("Failed to create market definition indexes:", error);
      throw error;
    }
  }
}
