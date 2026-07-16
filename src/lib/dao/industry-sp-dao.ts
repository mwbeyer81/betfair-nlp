import { Collection, Db } from "mongodb";

export interface IspFilterBounds {
  maxRunnersPerRace: number;
  maxIsp: number;
  minIsp: number;
}

export type IspRunnerStatus = "WINNER" | "PLACED" | "LOSER" | "NON_FINISHER";

export interface IspRunner {
  id: number;
  name: string;
  num: number | null;
  draw: number | null;
  status: IspRunnerStatus;
  sortPriority: number;
  isp: number | null;
  isFavourite: boolean;
}

export interface IspRace {
  raceId: number;
  meetingId: string;
  meetingName: string;
  course: string;
  countryCode: string;
  raceTime: string;
  raceName: string;
  raceType: string;
  ran: number;
  runners: IspRunner[];
}

interface IspRaceDocument extends IspRace {
  _id: number;
}

export class IndustrySpDAO {
  private collection: Collection<IspRaceDocument>;
  private collectionName: string;

  constructor(db: Db, collectionName = "industry_starting_prices") {
    this.collection = db.collection<IspRaceDocument>(collectionName);
    this.collectionName = collectionName;
  }

  /**
   * Return all races grouped by meeting, sorted chronologically.
   * Runners with no parseable ISP (isp === null) are excluded, mirroring how
   * REMOVED/missing-bsp runners are excluded on the Betfair-SP equivalent.
   */
  public async getAllRacesByRace(
    page = 1,
    limit = 20,
    minRunners = 1,
    maxRunners = 30,
    countries: string[] = [],
    minIsp = 1,
    maxIsp = 1000,
    sortOrder: "asc" | "desc" = "asc",
    minInIspRange = 1,
    maxInIspRange = 1000,
    fromRow = 1,
    toRow: number | null = null
  ): Promise<{
    data: IspRace[];
    total: number;
    totalRunners: number;
    pnlStats: { staked: number; returns: number; pnl: number; count: number };
  }> {
    const countryMatch = countries.length > 0 ? { countryCode: { $in: countries } } : {};
    const raceTimeSortDir = sortOrder === "desc" ? -1 : 1;

    const rowSkip = fromRow - 1;
    const rowLimit = toRow !== null ? toRow - fromRow + 1 : null;
    // A row range means "row N of the current sort order", so any branch
    // using rowRangeStages must sort first — done on the lightweight
    // (runners-free) doc shape below, never on the full array.
    const rowRangeStages: Record<string, unknown>[] = [{ $sort: { raceTime: raceTimeSortDir } }];
    if (rowSkip > 0) rowRangeStages.push({ $skip: rowSkip });
    if (rowLimit !== null) rowRangeStages.push({ $limit: rowLimit });

    const effectiveDataSkip = rowSkip + (page - 1) * limit;
    const effectiveDataLimit =
      rowLimit !== null ? Math.min(limit, Math.max(1, rowLimit - (page - 1) * limit)) : limit;

    // Only a lightweight per-race ISP-in-range *count* is computed here, not
    // the actual filtered/sorted runners array — Atlas M0 enforces a 32MB
    // in-memory sort buffer, and $sort-ing documents that still carry their
    // full embedded runners array can exceed that once the collection grows
    // (this already caused MongoServerError 292 / 500s on the equivalent
    // Betfair-SP query in production — see market-definition-dao.ts). Every
    // branch below re-attaches runners, if it needs them, via a $lookup back
    // onto this same collection *after* sorting/paginating down to a handful
    // of docs, never before.
    const runnersInRangeFilter = {
      $filter: {
        input: "$runners",
        as: "r",
        cond: {
          $and: [
            { $ifNull: ["$$r.isp", false] },
            { $gt: ["$$r.isp", 1] },
            { $gte: ["$$r.isp", minIsp] },
            { $lte: ["$$r.isp", maxIsp] },
          ],
        },
      },
    };

    const basePipeline = [
      { $match: countryMatch },
      {
        $addFields: {
          allRunnersCount: {
            $size: {
              $filter: {
                input: "$runners",
                as: "r",
                cond: { $and: [{ $ifNull: ["$$r.isp", false] }, { $gt: ["$$r.isp", 1] }] },
              },
            },
          },
          inRangeRunnersCount: { $size: runnersInRangeFilter },
        },
      },
      {
        $match: {
          $expr: {
            $and: [
              { $gte: ["$allRunnersCount", minRunners] },
              { $lte: ["$allRunnersCount", maxRunners] },
              { $gte: ["$inRangeRunnersCount", minInIspRange] },
              { $lte: ["$inRangeRunnersCount", maxInIspRange] },
            ],
          },
        },
      },
      { $project: { runners: 0 } },
    ];

    const reattachSortedRunners = [
      { $lookup: { from: this.collectionName, localField: "_id", foreignField: "_id", as: "_docs" } },
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
                      { $ifNull: ["$$r.isp", false] },
                      { $gt: ["$$r.isp", 1] },
                      { $gte: ["$$r.isp", minIsp] },
                      { $lte: ["$$r.isp", maxIsp] },
                    ],
                  },
                },
              },
              sortBy: { sortPriority: 1 },
            },
          },
        },
      },
    ];

    const [result] = await this.collection
      .aggregate<{
        data: IspRace[];
        total: [{ count: number }];
        totalRunners: [{ count: number }];
        pnlStats: [{ staked: number; returns: number; count: number }];
      }>([
        ...basePipeline,
        {
          $facet: {
            data: [
              { $sort: { raceTime: raceTimeSortDir } },
              { $skip: effectiveDataSkip },
              { $limit: effectiveDataLimit },
              ...reattachSortedRunners,
              {
                $project: {
                  _id: 0,
                  raceId: 1,
                  meetingId: 1,
                  meetingName: 1,
                  course: 1,
                  countryCode: 1,
                  raceTime: 1,
                  raceName: 1,
                  raceType: 1,
                  ran: 1,
                  runners: 1,
                },
              },
            ],
            total: [...rowRangeStages, { $count: "count" }],
            totalRunners: [
              ...rowRangeStages,
              { $group: { _id: null, count: { $sum: "$inRangeRunnersCount" } } },
            ],
            pnlStats: [
              ...rowRangeStages,
              ...reattachSortedRunners,
              { $unwind: "$runners" },
              { $match: { "runners.isp": { $exists: true, $gt: 1 } } },
              {
                $group: {
                  _id: null,
                  staked: { $sum: { $divide: [1, { $subtract: ["$runners.isp", 1] }] } },
                  returns: {
                    $sum: {
                      $cond: [
                        { $eq: ["$runners.status", "WINNER"] },
                        { $add: [{ $divide: [1, { $subtract: ["$runners.isp", 1] }] }, 1] },
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

  public async getPnlStats(): Promise<{ staked: number; returns: number; pnl: number }> {
    const [result] = await this.collection
      .aggregate<{ staked: number; returns: number }>([
        { $unwind: "$runners" },
        { $match: { "runners.isp": { $exists: true, $gt: 1 } } },
        {
          $group: {
            _id: null,
            staked: { $sum: { $divide: [1, { $subtract: ["$runners.isp", 1] }] } },
            returns: {
              $sum: {
                $cond: [
                  { $eq: ["$runners.status", "WINNER"] },
                  { $add: [{ $divide: [1, { $subtract: ["$runners.isp", 1] }] }, 1] },
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

  public async getDistinctCountryCodes(): Promise<string[]> {
    const codes = await this.collection.distinct("countryCode", { countryCode: { $exists: true, $ne: "" } });
    return (codes as string[]).filter(Boolean).sort();
  }

  public async getFilterBounds(): Promise<IspFilterBounds> {
    const [result] = await this.collection
      .aggregate<{
        runnerCounts: [{ maxRunners: number }];
        ispBounds: [{ maxIsp: number; minIsp: number }];
      }>([
        { $unwind: "$runners" },
        { $match: { "runners.isp": { $exists: true, $gt: 1 } } },
        {
          $facet: {
            runnerCounts: [
              { $group: { _id: "$_id", count: { $sum: 1 } } },
              { $group: { _id: null, maxRunners: { $max: "$count" } } },
            ],
            ispBounds: [
              {
                $group: {
                  _id: null,
                  maxIsp: { $max: "$runners.isp" },
                  minIsp: { $min: "$runners.isp" },
                },
              },
            ],
          },
        },
      ])
      .toArray();

    return {
      maxRunnersPerRace: result?.runnerCounts?.[0]?.maxRunners ?? 30,
      maxIsp: result?.ispBounds?.[0]?.maxIsp ?? 1000,
      minIsp: result?.ispBounds?.[0]?.minIsp ?? 1,
    };
  }

  public async createIndexes(): Promise<void> {
    const specs: [Record<string, unknown>, Record<string, unknown>?][] = [
      [{ raceTime: 1 }],
      [{ countryCode: 1 }],
    ];
    for (const [keys, opts] of specs) {
      try {
        await this.collection.createIndex(keys as any, opts as any);
      } catch (err) {
        console.warn(`createIndex failed for ${JSON.stringify(keys)} (non-fatal):`, err);
      }
    }
    console.log("Industry SP indexes ensured");
  }
}
