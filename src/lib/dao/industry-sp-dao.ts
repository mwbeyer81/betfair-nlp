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
  ispFraction: string | null;
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
    // A row range means "row N of the current sort order", so applying it
    // requires a $sort. With no fromRow/toRow narrowing (the common case),
    // no extra sort stage is added here at all — the no-range case is
    // handled entirely by dataPageStages below.
    //
    // When a range IS active, `raceTime` is indexed ({raceTime: 1}, see
    // createIndexes below), but only if the $sort is the *first* stage in
    // the pipeline — MongoDB can then walk the index directly instead of
    // buffering an in-memory sort, so $match/$addFields/$skip/$limit
    // afterwards cost O(1) memory regardless of collection size. Putting
    // the $sort anywhere after basePipeline's $match/$addFields (as this
    // used to) forces a blocking in-memory sort instead — confirmed live:
    // that blocking sort works up to ~40k matching docs but exceeds Atlas
    // M0's 32MB in-memory sort limit above ~45k, well under this
    // collection's real size (~109k) — and `allowDiskUse` can't rescue it,
    // since Atlas M0/M2/M5 silently ignore that option. Leading with the
    // indexed $sort avoids the blocking sort altogether, at any range size.
    const rowRangeActive = rowSkip > 0 || rowLimit !== null;
    const leadingSortStage: Record<string, unknown>[] = rowRangeActive
      ? [{ $sort: { raceTime: raceTimeSortDir } }]
      : [];
    const rowRangeStages: Record<string, unknown>[] = [];
    if (rowSkip > 0) rowRangeStages.push({ $skip: rowSkip });
    if (rowLimit !== null) rowRangeStages.push({ $limit: rowLimit });

    // Once rowRangeStages has already sorted+skipped+limited the input
    // ahead of $facet, the "data" branch only needs to page within that
    // already-ordered subset — page skip/limit alone, no re-sort.
    const dataPageStages: Record<string, unknown>[] = rowRangeActive
      ? [{ $skip: (page - 1) * limit }, { $limit: limit }]
      : [
          { $sort: { raceTime: raceTimeSortDir } },
          { $skip: (page - 1) * limit },
          { $limit: limit },
        ];

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

    // `runnersWithIspCount` is precomputed at import time (see
    // import-industry-sp.ts) as "count of runners with a valid, parseable
    // ISP (isp > 1)" — a definition that never depends on request params, so
    // it's stored + indexed instead of recomputed via $filter/$size on every
    // query. That makes it always usable for allRunnersCount, and it doubles
    // as inRangeRunnersCount whenever the isp range filter is wide enough to
    // cover every real isp value (true range in this dataset is
    // [1.01, 751]; minIsp<=1/maxIsp>=1000 matches the frontend's own
    // "no filter" defaults with margin). When the caller actually narrows
    // the isp range, fall back to the on-the-fly $filter as before.
    const ispRangeCoversAllRealValues = minIsp <= 1 && maxIsp >= 1000;
    const inRangeRunnersCountExpr = ispRangeCoversAllRealValues
      ? "$runnersWithIspCount"
      : { $size: runnersInRangeFilter };

    // Only a per-race id + sort key + the two precomputed counts survive
    // into the $facet — every other field (course, meetingName, runners,
    // ...) is re-fetched via $lookup after sorting/paginating down to a
    // handful of docs, never before. This keeps every $sort in this
    // pipeline operating on a ~40-byte doc regardless of collection size.
    // The leading $match filters on the plain, indexed runnersWithIspCount
    // field directly (not $expr) so it can use the index — this replaces
    // what used to be a $filter/$size scan over every race's embedded
    // runners array on every single request.
    const basePipeline = [
      ...leadingSortStage,
      {
        $match: {
          ...countryMatch,
          runnersWithIspCount: { $gte: minRunners, $lte: maxRunners },
        },
      },
      {
        $addFields: {
          allRunnersCount: "$runnersWithIspCount",
          inRangeRunnersCount: inRangeRunnersCountExpr,
        },
      },
      {
        $match: {
          $expr: {
            $and: [
              { $gte: ["$inRangeRunnersCount", minInIspRange] },
              { $lte: ["$inRangeRunnersCount", maxInIspRange] },
            ],
          },
        },
      },
      {
        $project: {
          _id: 1,
          raceTime: 1,
          allRunnersCount: 1,
          inRangeRunnersCount: 1,
          raceStaked: 1,
          raceReturns: 1,
        },
      },
    ];

    const reattachFullDoc = [
      { $lookup: { from: this.collectionName, localField: "_id", foreignField: "_id", as: "_docs" } },
      { $addFields: { _doc: { $arrayElemAt: ["$_docs", 0] } } },
      {
        $addFields: {
          raceId: "$_doc.raceId",
          meetingId: "$_doc.meetingId",
          meetingName: "$_doc.meetingName",
          course: "$_doc.course",
          countryCode: "$_doc.countryCode",
          raceName: "$_doc.raceName",
          raceType: "$_doc.raceType",
          ran: "$_doc.ran",
          runners: {
            $sortArray: {
              input: {
                $filter: {
                  input: { $ifNull: ["$_doc.runners", []] },
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
        // Applied once, ahead of $facet, when a row range is active — see
        // the rowRangeStages comment above for why this can't live inside
        // the facet branches below (that would re-run the sort per branch).
        ...rowRangeStages,
        {
          $facet: {
            data: [
              ...dataPageStages,
              ...reattachFullDoc,
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
            total: [{ $count: "count" }],
            totalRunners: [{ $group: { _id: null, count: { $sum: "$inRangeRunnersCount" } } }],
            // Fast path: raceStaked/raceReturns are precomputed at import time
            // over the same static isp>1 runner set as runnersWithIspCount, so
            // whenever the isp range filter covers every real isp value this
            // is a plain $sum over already-matched docs — no $lookup, no
            // $unwind over every runner in every matched race (that $lookup
            // was previously the single largest cost in this whole query,
            // since it re-fetched all ~109k matched races' full runners
            // arrays on every request). Narrowed isp ranges fall back to the
            // original $lookup + $unwind + $group computation.
            pnlStats: ispRangeCoversAllRealValues
              ? [
                  {
                    $group: {
                      _id: null,
                      staked: { $sum: "$raceStaked" },
                      returns: { $sum: "$raceReturns" },
                      count: { $sum: "$inRangeRunnersCount" },
                    },
                  },
                ]
              : [
                  ...reattachFullDoc,
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
      ], { allowDiskUse: true })
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

  /**
   * All races for one meeting (course + date), sorted by raceTime. A
   * meeting only ever has a handful of races, so no pagination or 32MB
   * sort-limit concerns here — this is a plain $match + $sort.
   */
  public async getRacesByMeetingId(meetingId: string): Promise<IspRace[]> {
    const races = await this.collection
      .aggregate<IspRace>([
        { $match: { meetingId } },
        {
          $addFields: {
            runners: {
              $sortArray: {
                input: {
                  $filter: {
                    input: "$runners",
                    as: "r",
                    cond: { $and: [{ $ifNull: ["$$r.isp", false] }, { $gt: ["$$r.isp", 1] }] },
                  },
                },
                sortBy: { sortPriority: 1 },
              },
            },
          },
        },
        { $sort: { raceTime: 1 } },
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
      ])
      .toArray();
    return races;
  }

  /** A single race by its raceId, or null if not found. */
  public async getRaceById(raceId: number): Promise<IspRace | null> {
    const [race] = await this.collection
      .aggregate<IspRace>([
        { $match: { _id: raceId } },
        {
          $addFields: {
            runners: {
              $sortArray: {
                input: {
                  $filter: {
                    input: "$runners",
                    as: "r",
                    cond: { $and: [{ $ifNull: ["$$r.isp", false] }, { $gt: ["$$r.isp", 1] }] },
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
      ])
      .toArray();
    return race ?? null;
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
      [{ runnersWithIspCount: 1 }],
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
