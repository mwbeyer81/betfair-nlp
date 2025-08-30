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
      // Let MongoDB handle duplicates with the unique index
      const result = await this.collection.insertMany(priceUpdates, {
        ordered: false,
      });
      console.log(`Inserted ${result.insertedCount} price updates`);
    } catch (error: any) {
      // Handle bulk write errors where some documents were inserted
      if (error.code === 11000 && error.result) {
        console.log(`Inserted ${error.result.insertedCount} price updates`);
        const skippedCount = priceUpdates.length - error.result.insertedCount;
        console.log(
          `Skipped ${skippedCount} duplicate price updates (already existed)`
        );
      } else {
        console.error("Failed to insert price updates:", error);
        throw error;
      }
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
      // Compound unique index prevents duplicate changeId + runnerId combinations
      await this.collection.createIndex(
        { changeId: 1, runnerId: 1 },
        { unique: true }
      );
      console.log("Price update indexes created successfully");
    } catch (error) {
      console.error("Failed to create price update indexes:", error);
      throw error;
    }
  }
}
