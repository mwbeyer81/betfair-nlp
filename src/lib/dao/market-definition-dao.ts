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

export interface SummaryStats {
  totalRaces: number;
  totalRunners: number;
}

export interface RaceWithRunners {
  marketId: string;
  marketTime: string;
  marketType: string;
  marketName: string;
  runners: Array<{ id: number; name: string; status: string; sortPriority: number; bsp?: number }>;
}

export interface RaceWithEvent extends RaceWithRunners {
  eventId: string;
  eventName: string;
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
   * Group market definitions by eventId.
   * count = number of unique markets (not raw snapshot docs).
   */
  public async groupByEventId(): Promise<EventGroup[]> {
    return await this.collection
      .aggregate<EventGroup>([
        {
          $group: {
            _id: "$eventId",
            eventName: { $first: "$eventName" },
            marketIds: { $addToSet: "$marketId" },
          },
        },
        {
          $project: {
            _id: 0,
            eventId: "$_id",
            eventName: 1,
            marketIds: 1,
            count: { $size: "$marketIds" },
          },
        },
        { $sort: { count: -1 } },
      ])
      .toArray();
  }

  /**
   * Return the latest market definition snapshot per marketId for an event,
   * sorted by race time. One row per market — no historical noise.
   */
  public async getLatestPerMarketByEventId(
    eventId: string,
    limit: number = 200
  ): Promise<MarketDefinitionDocument[]> {
    return await this.collection
      .aggregate<MarketDefinitionDocument>([
        { $match: { eventId } },
        { $sort: { timestamp: -1 } },
        { $group: { _id: "$marketId", doc: { $first: "$$ROOT" } } },
        { $replaceRoot: { newRoot: "$doc" } },
        { $sort: { marketTime: 1 } },
        { $limit: limit },
      ])
      .toArray();
  }

  /**
   * Return runners grouped by WIN/ANTEPOST_WIN market, sorted by race time.
   * REMOVED runners are excluded. One entry per race.
   */
  public async getRunnersByRaceForEvent(eventId: string): Promise<RaceWithRunners[]> {
    return await this.collection
      .aggregate<RaceWithRunners>([
        { $match: { eventId, marketType: { $in: ["WIN", "ANTEPOST_WIN"] } } },
        { $sort: { timestamp: -1 } },
        {
          $group: {
            _id: "$marketId",
            marketTime: { $first: "$marketTime" },
            marketType: { $first: "$marketType" },
            marketName: { $first: "$name" },
            runners: { $first: "$runners" },
          },
        },
        { $unwind: "$runners" },
        { $match: { "runners.status": { $ne: "REMOVED" } } },
        { $sort: { marketTime: 1, "runners.sortPriority": 1 } },
        {
          $group: {
            _id: "$_id",
            marketTime: { $first: "$marketTime" },
            marketType: { $first: "$marketType" },
            marketName: { $first: "$marketName" },
            runners: {
              $push: {
                id: "$runners.id",
                name: "$runners.name",
                status: "$runners.status",
                sortPriority: "$runners.sortPriority",
                bsp: "$runners.bsp",
              },
            },
          },
        },
        { $sort: { marketTime: 1 } },
        {
          $project: {
            _id: 0,
            marketId: "$_id",
            marketTime: 1,
            marketType: 1,
            marketName: 1,
            runners: 1,
          },
        },
      ])
      .toArray();
  }

  /**
   * Return all runners across every event grouped by WIN/ANTEPOST_WIN market,
   * sorted chronologically. REMOVED runners excluded.
   */
  public async getAllRunnersByRace(
    page = 1,
    limit = 20
  ): Promise<{ data: RaceWithEvent[]; total: number }> {
    const skip = (page - 1) * limit;

    const basePipeline = [
      { $match: { marketType: { $in: ["WIN", "ANTEPOST_WIN"] } } },
      { $sort: { timestamp: -1 } },
      {
        $group: {
          _id: "$marketId",
          eventId: { $first: "$eventId" },
          eventName: { $first: "$eventName" },
          marketTime: { $first: "$marketTime" },
          marketType: { $first: "$marketType" },
          marketName: { $first: "$name" },
          runners: { $first: "$runners" },
        },
      },
      { $unwind: "$runners" },
      { $match: { "runners.status": { $ne: "REMOVED" } } },
      { $sort: { marketTime: 1, "runners.sortPriority": 1 } },
      {
        $group: {
          _id: "$_id",
          eventId: { $first: "$eventId" },
          eventName: { $first: "$eventName" },
          marketTime: { $first: "$marketTime" },
          marketType: { $first: "$marketType" },
          marketName: { $first: "$marketName" },
          runners: {
            $push: {
              id: "$runners.id",
              name: "$runners.name",
              status: "$runners.status",
              sortPriority: "$runners.sortPriority",
              bsp: "$runners.bsp",
            },
          },
        },
      },
      { $sort: { marketTime: 1 } },
    ];

    const projectStage = {
      $project: {
        _id: 0,
        marketId: "$_id",
        eventId: 1,
        eventName: 1,
        marketTime: 1,
        marketType: 1,
        marketName: 1,
        runners: 1,
      },
    };

    const [result] = await this.collection
      .aggregate<{ data: RaceWithEvent[]; total: [{ count: number }] }>([
        ...basePipeline,
        {
          $facet: {
            data: [{ $skip: skip }, { $limit: limit }, projectStage],
            total: [{ $count: "count" }],
          },
        },
      ])
      .toArray();

    return {
      data: result?.data ?? [],
      total: result?.total?.[0]?.count ?? 0,
    };
  }

  public async getRunnersPnlStats(): Promise<{ staked: number; returns: number; pnl: number }> {
    const [result] = await this.collection
      .aggregate<{ staked: number; returns: number }>([
        { $match: { marketType: { $in: ["WIN", "ANTEPOST_WIN"] } } },
        { $sort: { timestamp: -1 } },
        {
          $group: {
            _id: "$marketId",
            runners: { $first: "$runners" },
          },
        },
        { $unwind: "$runners" },
        { $match: { "runners.status": { $ne: "REMOVED" }, "runners.bsp": { $exists: true, $gt: 1 } } },
        {
          $group: {
            _id: null,
            staked: { $sum: { $divide: [1, { $subtract: ["$runners.bsp", 1] }] } },
            returns: {
              $sum: {
                $cond: [
                  { $eq: ["$runners.status", "WINNER"] },
                  { $add: [{ $divide: [1, { $subtract: ["$runners.bsp", 1] }] }, 1] },
                  0,
                ],
              },
            },
          },
        },
      ])
      .toArray();

    const staked = result?.staked ?? 0;
    const returns = result?.returns ?? 0;
    return { staked, returns, pnl: returns - staked };
  }

  /**
   * Count total unique races (WIN/ANTEPOST_WIN markets) and unique active runners
   * across all events in a single aggregation pass.
   */
  public async getSummaryStats(): Promise<SummaryStats> {
    const result = await this.collection
      .aggregate<{ totalRaces: number; totalRunners: number }>([
        { $match: { marketType: { $in: ["WIN", "ANTEPOST_WIN"] } } },
        { $sort: { timestamp: -1 } },
        { $group: { _id: "$marketId", runners: { $first: "$runners" } } },
        {
          $facet: {
            races: [{ $count: "count" }],
            runners: [
              { $unwind: "$runners" },
              { $match: { "runners.status": { $ne: "REMOVED" } } },
              { $group: { _id: "$runners.id" } },
              { $count: "count" },
            ],
          },
        },
        {
          $project: {
            totalRaces: { $ifNull: [{ $arrayElemAt: ["$races.count", 0] }, 0] },
            totalRunners: { $ifNull: [{ $arrayElemAt: ["$runners.count", 0] }, 0] },
          },
        },
      ])
      .toArray();

    return result[0] ?? { totalRaces: 0, totalRunners: 0 };
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
