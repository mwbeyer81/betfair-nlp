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
  earliestMarketTime: string;
}

export interface SummaryStats {
  totalRaces: number;
  totalRunners: number;
}

export interface RunnerFilterBounds {
  maxRunnersPerRace: number;
  maxBsp: number;
  minBsp: number;
}

export interface RaceWithRunners {
  marketId: string;
  marketTime: string;
  marketType: string;
  marketName: string;
  countryCode: string;
  runners: Array<{ id: number; name: string; status: string; sortPriority: number; bsp?: number }>;
}

export interface RaceWithEvent extends RaceWithRunners {
  eventId: string;
  eventName: string;
}

export class MarketDefinitionDAO {
  private collection: Collection<MarketDefinitionDocument>;

  constructor(db: Db, collectionName = "market_definitions") {
    this.collection =
      db.collection<MarketDefinitionDocument>(collectionName);
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
    } catch (error: any) {
      if (error.code === 11000) return; // duplicate — already in DB
      throw error;
    }
  }

  /**
   * Upsert (replace) the single market definition for a marketId.
   * Used in BSP_ONLY mode so only the final settled snapshot is kept per market.
   */
  public async upsertByMarketId(
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
    await this.collection.replaceOne({ marketId }, document, { upsert: true });
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

  public async groupByEventId(
    page: number = 1,
    limit: number = 20,
    sort: "asc" | "desc" = "asc"
  ): Promise<{ data: EventGroup[]; total: number }> {
    const sortDir = sort === "asc" ? 1 : -1;
    const skip = (page - 1) * limit;
    const result = await this.collection
      .aggregate<{ data: EventGroup[]; total: [{ count: number }] }>([
        {
          $group: {
            _id: "$eventId",
            eventName: { $first: "$eventName" },
            marketIds: { $addToSet: "$marketId" },
            earliestMarketTime: { $min: "$marketTime" },
          },
        },
        {
          $project: {
            _id: 0,
            eventId: "$_id",
            eventName: 1,
            marketIds: 1,
            count: { $size: "$marketIds" },
            earliestMarketTime: 1,
          },
        },
        { $sort: { earliestMarketTime: sortDir } },
        {
          $facet: {
            data: [{ $skip: skip }, { $limit: limit }],
            total: [{ $count: "count" }],
          },
        },
      ])
      .toArray();
    const { data, total } = result[0];
    return { data, total: total[0]?.count ?? 0 };
  }

  /**
   * Return the latest market definition snapshot per marketId for an event,
   * sorted by race time. One row per market â€” no historical noise.
   */
  public async getLatestPerMarketByEventId(
    eventId: string,
    limit: number = 200
  ): Promise<MarketDefinitionDocument[]> {
    return await this.collection
      .aggregate<MarketDefinitionDocument>([
        { $match: { eventId } },
        { $sort: { marketId: 1, timestamp: -1 } },
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
        { $sort: { marketId: 1, timestamp: -1 } },
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
        { $match: { "runners.status": { $ne: "REMOVED" }, "runners.bsp": { $exists: true, $gt: 1 } } },
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
    limit = 20,
    minRunners = 1,
    maxRunners = 30,
    countries: string[] = [],
    minBsp = 1,
    maxBsp = 1000,
    sortOrder: "asc" | "desc" = "asc",
    minInSp = 1,
    maxInSp = 1000,
    fromRow = 1,
    toRow: number | null = null
  ): Promise<{ data: RaceWithEvent[]; total: number; totalRunners: number; pnlStats: { staked: number; returns: number; pnl: number; count: number } }> {
    const countryMatch = countries.length > 0 ? { countryCode: { $in: countries } } : {};
    const marketTimeSortDir = sortOrder === "desc" ? -1 : 1;

    // Row-range offsets applied uniformly across all facets
    const rowSkip = fromRow - 1;
    const rowLimit = toRow !== null ? toRow - fromRow + 1 : null;
    const rowRangeStages: Record<string, unknown>[] = [];
    if (rowSkip > 0) rowRangeStages.push({ $skip: rowSkip });
    if (rowLimit !== null) rowRangeStages.push({ $limit: rowLimit });

    const effectiveDataSkip = rowSkip + (page - 1) * limit;
    const effectiveDataLimit = rowLimit !== null
      ? Math.min(limit, Math.max(1, rowLimit - (page - 1) * limit))
      : limit;

    const basePipeline = [
      { $match: { marketType: { $in: ["WIN", "ANTEPOST_WIN"] }, ...countryMatch } },
      {
        $group: {
          _id: "$marketId",
          eventId: { $first: "$eventId" },
          eventName: { $first: "$eventName" },
          marketTime: { $first: "$marketTime" },
          marketType: { $first: "$marketType" },
          marketName: { $first: "$name" },
          countryCode: { $first: "$countryCode" },
          runners: { $first: "$runners" },
        },
      },
      // Compute allRunnersCount (all runners with bsp > 1) and runners (BSP-range subset, sorted).
      // Both use the original runners array from $group — $addFields evaluates from pre-stage state.
      {
        $addFields: {
          allRunnersCount: {
            $size: {
              $filter: {
                input: "$runners",
                as: "r",
                cond: {
                  $and: [
                    { $ne: ["$$r.status", "REMOVED"] },
                    { $ifNull: ["$$r.bsp", false] },
                    { $gt: ["$$r.bsp", 1] },
                  ],
                },
              },
            },
          },
          runners: {
            $sortArray: {
              input: {
                $filter: {
                  input: "$runners",
                  as: "r",
                  cond: {
                    $and: [
                      { $ne: ["$$r.status", "REMOVED"] },
                      { $ifNull: ["$$r.bsp", false] },
                      { $gt: ["$$r.bsp", 1] },
                      { $gte: ["$$r.bsp", minBsp] },
                      { $lte: ["$$r.bsp", maxBsp] },
                    ],
                  },
                },
              },
              sortBy: { sortPriority: 1 },
            },
          },
        },
      },
      {
        $match: {
          $expr: {
            $and: [
              { $gte: ["$allRunnersCount", minRunners] },
              { $lte: ["$allRunnersCount", maxRunners] },
              { $gte: [{ $size: "$runners" }, minInSp] },
              { $lte: [{ $size: "$runners" }, maxInSp] },
            ],
          },
        },
      },
    ];

    const [result] = await this.collection
      .aggregate<{
        data: RaceWithEvent[];
        total: [{ count: number }];
        totalRunners: [{ count: number }];
        pnlStats: [{ staked: number; returns: number; count: number }];
      }>([
        ...basePipeline,
        {
          $facet: {
            // Strip runners before sorting so each doc is ~200 bytes — avoids Atlas M0's
            // 32 MB in-memory sort limit. $facet feeds the same input to all branches,
            // so pnlStats / totalRunners still see the full runners array.
            data: [
              { $project: { eventId: 1, eventName: 1, marketTime: 1, marketType: 1, marketName: 1, countryCode: 1 } },
              { $sort: { marketTime: marketTimeSortDir } },
              { $skip: effectiveDataSkip },
              { $limit: effectiveDataLimit },
              // Re-fetch runners for just these N docs (uses the marketId index).
              { $lookup: { from: "market_definitions", localField: "_id", foreignField: "marketId", as: "_docs" } },
              {
                $addFields: {
                  runners: {
                    $sortArray: {
                      input: {
                        $filter: {
                          input: { $ifNull: [{ $arrayElemAt: ["$_docs.runners", 0] }, []] },
                          as: "r",
                          cond: {
                            $and: [
                              { $ne: ["$$r.status", "REMOVED"] },
                              { $ifNull: ["$$r.bsp", false] },
                              { $gt: ["$$r.bsp", 1] },
                              { $gte: ["$$r.bsp", minBsp] },
                              { $lte: ["$$r.bsp", maxBsp] },
                            ],
                          },
                        },
                      },
                      sortBy: { sortPriority: 1 },
                    },
                  },
                },
              },
              {
                $project: {
                  _id: 0,
                  marketId: "$_id",
                  eventId: 1,
                  eventName: 1,
                  marketTime: 1,
                  marketType: 1,
                  marketName: 1,
                  countryCode: 1,
                  runners: 1,
                },
              },
            ],
            total: [...rowRangeStages, { $count: "count" }],
            totalRunners: [...rowRangeStages, { $group: { _id: null, count: { $sum: { $size: "$runners" } } } }],
            pnlStats: [
              ...rowRangeStages,
              { $unwind: "$runners" },
              { $match: { "runners.bsp": { $exists: true, $gt: 1 } } },
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
                  count: { $sum: 1 },
                },
              },
            ],
          },
        },
      ])
      .toArray();

    const staked = result?.pnlStats?.[0]?.staked ?? 0;
    const returns = result?.pnlStats?.[0]?.returns ?? 0;
    const count = result?.pnlStats?.[0]?.count ?? 0;

    return {
      data: result?.data ?? [],
      total: result?.total?.[0]?.count ?? 0,
      totalRunners: result?.totalRunners?.[0]?.count ?? 0,
      pnlStats: { staked, returns, pnl: returns - staked, count },
    };
  }

  public async getRunnersPnlStats(): Promise<{ staked: number; returns: number; pnl: number }> {
    const [result] = await this.collection
      .aggregate<{ staked: number; returns: number }>([
        { $match: { marketType: { $in: ["WIN", "ANTEPOST_WIN"] } } },
        { $sort: { marketId: 1, timestamp: -1 } },
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
        { $sort: { marketId: 1, timestamp: -1 } },
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

  public async getDistinctCountryCodes(): Promise<string[]> {
    const codes = await this.collection.distinct("countryCode", {
      marketType: { $in: ["WIN", "ANTEPOST_WIN"] },
      countryCode: { $exists: true, $ne: "" },
    });
    return (codes as string[]).filter(Boolean).sort();
  }

  public async getRunnerFilterBounds(): Promise<RunnerFilterBounds> {
    const [result] = await this.collection
      .aggregate<{
        runnerCounts: [{ maxRunners: number }];
        bspBounds: [{ maxBsp: number; minBsp: number }];
      }>([
        { $match: { marketType: { $in: ["WIN", "ANTEPOST_WIN"] } } },
        { $sort: { marketId: 1, timestamp: -1 } },
        { $group: { _id: "$marketId", runners: { $first: "$runners" } } },
        { $unwind: "$runners" },
        { $match: { "runners.status": { $ne: "REMOVED" }, "runners.bsp": { $exists: true, $gt: 1 } } },
        {
          $facet: {
            runnerCounts: [
              { $group: { _id: "$_id", count: { $sum: 1 } } },
              { $group: { _id: null, maxRunners: { $max: "$count" } } },
            ],
            bspBounds: [
              {
                $group: {
                  _id: null,
                  maxBsp: { $max: "$runners.bsp" },
                  minBsp: { $min: "$runners.bsp" },
                },
              },
            ],
          },
        },
      ])
      .toArray();

    return {
      maxRunnersPerRace: result?.runnerCounts?.[0]?.maxRunners ?? 30,
      maxBsp: result?.bspBounds?.[0]?.maxBsp ?? 1000,
      minBsp: result?.bspBounds?.[0]?.minBsp ?? 1,
    };
  }

  /**
   * Create indexes for better query performance
   */
  public async createIndexes(): Promise<void> {
    const specs: [Record<string, unknown>, Record<string, unknown>?][] = [
      // Query-covering indexes first — required for the hint in getAllRunnersByRace.
      // Each is attempted independently so a failure on one (e.g. the unique
      // constraint) does not prevent the others from being created.
      [{ marketType: 1, marketId: 1, timestamp: -1 }],
      [{ marketType: 1, countryCode: 1, marketId: 1, timestamp: -1 }],
      [{ marketType: 1, countryCode: 1 }],
      [{ marketId: 1, timestamp: -1 }],
      [{ eventId: 1, timestamp: -1 }],
      [{ status: 1 }],
      [{ changeId: 1, marketId: 1 }, { unique: true }],
    ];
    for (const [keys, opts] of specs) {
      try {
        await this.collection.createIndex(keys as any, opts as any);
      } catch (err) {
        console.warn(`createIndex failed for ${JSON.stringify(keys)} (non-fatal):`, err);
      }
    }
    console.log("Market definition indexes ensured");
  }
}
