import { Collection, Db } from "mongodb";
import { PriceUpdateDocument, RunnerChange } from "../../types/betfair";

export class PriceUpdateDAO {
  private collection: Collection<PriceUpdateDocument>;

  constructor(db: Db) {
    this.collection = db.collection<PriceUpdateDocument>("price_updates");
  }

  /**
   * Insert multiple price update documents
   */
  public async insertMany(priceUpdates: PriceUpdateDocument[]): Promise<void> {
    if (priceUpdates.length === 0) return;

    try {
      // Check for existing documents to avoid duplicate key errors
      const existingChangeIds = await this.collection.distinct("changeId", {
        changeId: { $in: priceUpdates.map(p => p.changeId) },
      });

      // Filter out updates that already exist
      const newUpdates = priceUpdates.filter(
        update => !existingChangeIds.includes(update.changeId)
      );

      if (newUpdates.length === 0) {
        console.log("All price updates already exist, skipping insertion");
        return;
      }

      await this.collection.insertMany(newUpdates);
      console.log(
        `Inserted ${newUpdates.length} new price updates (${priceUpdates.length - newUpdates.length} already existed)`
      );
    } catch (error) {
      console.error("Failed to insert price updates:", error);
      throw error;
    }
  }

  /**
   * Insert a single price update document
   */
  public async insert(priceUpdate: PriceUpdateDocument): Promise<void> {
    try {
      await this.collection.insertOne(priceUpdate);
      console.log(
        `Inserted price update for runner ${priceUpdate.runnerId} in market ${priceUpdate.marketId}`
      );
    } catch (error) {
      console.error("Failed to insert price update:", error);
      throw error;
    }
  }

  /**
   * Get price updates for a specific runner
   */
  public async getByRunnerId(
    runnerId: number,
    limit: number = 100
  ): Promise<PriceUpdateDocument[]> {
    return await this.collection
      .find({ runnerId })
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();
  }

  /**
   * Get price updates for a specific market
   */
  public async getByMarketId(
    marketId: string,
    limit: number = 100
  ): Promise<PriceUpdateDocument[]> {
    return await this.collection
      .find({ marketId })
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();
  }

  /**
   * Get price updates for a specific event
   */
  public async getByEventId(
    eventId: string,
    limit: number = 100
  ): Promise<PriceUpdateDocument[]> {
    return await this.collection
      .find({ eventId })
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();
  }

  /**
   * Get price updates within a time range
   */
  public async getByTimeRange(
    startTime: Date,
    endTime: Date,
    limit: number = 100
  ): Promise<PriceUpdateDocument[]> {
    return await this.collection
      .find({
        timestamp: {
          $gte: startTime,
          $lte: endTime,
        },
      })
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();
  }

  /**
   * Get latest price for a specific runner
   */
  public async getLatestPriceByRunnerId(
    runnerId: number
  ): Promise<PriceUpdateDocument | null> {
    return await this.collection.findOne(
      { runnerId },
      { sort: { timestamp: -1 } }
    );
  }

  /**
   * Create indexes for better query performance
   */
  public async createIndexes(): Promise<void> {
    try {
      await this.collection.createIndex({ marketId: 1, timestamp: -1 });
      await this.collection.createIndex({ runnerId: 1, timestamp: -1 });
      await this.collection.createIndex({ eventId: 1, timestamp: -1 });
      await this.collection.createIndex({ timestamp: -1 });
      // changeId should be unique since each represents a unique system change
      await this.collection.createIndex({ changeId: 1 }, { unique: true });
      console.log("Price update indexes created successfully");
    } catch (error) {
      console.error("Failed to create price update indexes:", error);
      throw error;
    }
  }
}
