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
  jockey?: string;
  trainer?: string;
  // Trainer's trailing-14-day form (same race-type category — Flat vs
  // Jumps — as this race), computed as-of this race's own date using only
  // strictly earlier runs, so it never leaks future results into a
  // historical race. Precomputed in src/commands/precompute-trainer-form.ts;
  // absent (undefined) on runners whose trainer field is empty, and
  // trainerFormWinRate is null (not 0) when trainerFormRuns is 0 — that's
  // the "no sample yet" signal the frontend badge uses to omit itself.
  trainerFormRuns?: number;
  trainerFormWins?: number;
  trainerFormWinRate?: number | null;
  trainerFormStaked?: number;
  trainerFormReturns?: number;
  // XGBoost win-probability estimate (0-100, normalized so a race's runners
  // sum to 100) — precomputed in ml/train_and_predict.py, deliberately
  // trained WITHOUT isp/ispFraction/isFavourite as inputs so it's an
  // independent view, not a recalibration of the market's own price.
  // Populated for every runner (no cold-start gap like trainerForm), so
  // undefined only means the precompute hasn't been run at all yet.
  modelWinProbability?: number | null;
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
  raceClass: string | null;
  going: string | null;
  ran: number;
  runners: IspRunner[];
}

// Escapes regex metacharacters so a raw trainer/jockey search string can't be
// interpreted as a regex pattern (both a correctness issue — literal
// characters like "O'Brien" or "St. Leger" would otherwise misbehave — and a
// safety one, since an unescaped user-supplied pattern is a ReDoS vector).
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
    fromRowRaw = 1,
    toRow: number | null = null,
    minRaceTime: string | null = null,
    maxRaceTime: string | null = null,
    courses: string[] = [],
    goings: string[] = [],
    raceClasses: string[] = [],
    raceTypes: string[] = [],
    trainerSearch: string | null = null,
    jockeySearch: string | null = null,
    trainerFormMinWinRate = 0,
    minTrainerFormRunners = 0,
    maxTrainerFormRunners = 100,
    runnerName: string | null = null,
    minModelWinProbability = 0
  ): Promise<{
    data: IspRace[];
    total: number;
    totalRunners: number;
    pnlStats: { staked: number; returns: number; pnl: number; count: number };
  }> {
    // fromRow < 1 would make rowSkip negative below — another shape
    // MongoDB's $skip rejects outright, same class of bug as the inverted
    // range guard just below. Clamping here (rather than trusting every
    // caller to have already validated it) is defense in depth: this
    // method's fromRow/toRow can originate from raw, unvalidated query
    // params (see the router) or a stale/hand-edited URL.
    const fromRow = Math.max(1, fromRowRaw);

    // An inverted range (toRow < fromRow) has no matching rows by
    // definition — short-circuit to an empty result instead of letting
    // rowLimit go negative below. A negative $limit isn't just "wrong",
    // it's a hard MongoDB error (code 5107201, "invalid argument to
    // $limit stage"), which surfaced live as a 500 / "Failed to load
    // industry SP" whenever a stale or hand-edited fromRow/toRow (or
    // fromRowA/toRowA — see getSplitStats, which calls this) reached here.
    if (toRow !== null && toRow < fromRow) {
      return { data: [], total: 0, totalRunners: 0, pnlStats: { staked: 0, returns: 0, pnl: 0, count: 0 } };
    }

    const countryMatch = countries.length > 0 ? { countryCode: { $in: countries } } : {};
    // Race-level scalar fields, same $in shape as countryMatch above.
    const courseMatch = courses.length > 0 ? { course: { $in: courses } } : {};
    const goingMatch = goings.length > 0 ? { going: { $in: goings } } : {};
    const raceClassMatch = raceClasses.length > 0 ? { raceClass: { $in: raceClasses } } : {};
    const raceTypeMatch = raceTypes.length > 0 ? { raceType: { $in: raceTypes } } : {};
    // Runner-level: a race matches if ANY runner's trainer/jockey starts
    // with the search text (case-insensitive prefix match — anchored so it
    // can use the runners.trainer/runners.jockey indexes, unlike an
    // unanchored substring search).
    const runnerTextMatches: Record<string, unknown>[] = [];
    if (trainerSearch) {
      runnerTextMatches.push({
        runners: { $elemMatch: { trainer: { $regex: `^${escapeRegex(trainerSearch)}`, $options: "i" } } },
      });
    }
    if (jockeySearch) {
      runnerTextMatches.push({
        runners: { $elemMatch: { jockey: { $regex: `^${escapeRegex(jockeySearch)}`, $options: "i" } } },
      });
    }
    // Exact (not prefix) match, anchored both ends — this is a "find this
    // specific horse's history" lookup (Runner History screen), not a
    // typeahead search, so "Sea The Stars" must not also match a race
    // whose runner is "Sea The Star".
    if (runnerName) {
      runnerTextMatches.push({
        runners: { $elemMatch: { name: { $regex: `^${escapeRegex(runnerName)}$`, $options: "i" } } },
      });
    }
    const runnerTextMatch = runnerTextMatches.length > 0 ? { $and: runnerTextMatches } : {};
    const raceTimeSortDir = sortOrder === "desc" ? -1 : 1;

    // Narrows the matched set by calendar date *before* anything else in
    // the pipeline (including the row-range $sort below) — raceTime is a
    // plain ISO string, so lexicographic $gte/$lte comparison matches
    // chronological order. Leading with this on the same field the
    // row-range $sort also uses lets MongoDB serve both from one bounded
    // walk of the {raceTime:1} index (the same shape as
    // find({raceTime:{$gte,$lte}}).sort({raceTime:1})) instead of two
    // separate operations — so this doesn't reintroduce the blocking-sort
    // risk the leading-$sort-must-be-first fix above was written to avoid.
    const dateMatchStage: Record<string, unknown>[] =
      minRaceTime != null || maxRaceTime != null
        ? [
            {
              $match: {
                raceTime: {
                  ...(minRaceTime != null ? { $gte: minRaceTime } : {}),
                  ...(maxRaceTime != null ? { $lte: maxRaceTime } : {}),
                },
              },
            },
          ]
        : [];

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

    // Runner-level "in form" threshold, race-level qualifying-runner count —
    // same $filter/$size-on-array-expression shape as inRangeRunnersCount
    // above, deliberately not $unwind: trainerFormMinWinRate is a
    // request-time threshold (unlike runnersWithIspCount's fixed isp>1
    // definition), so unlike that field it can't be precomputed once at
    // import time.
    //
    // Unlike inRangeRunnersCount though, there's no isp-range-style "covers
    // everything" fast path available here (the underlying trainerFormWinRate
    // values aren't known ahead of time), so instead this skips the $filter/
    // $size scan entirely whenever the bounds are at their true no-op
    // defaults (minTrainerFormRunners<=0, maxTrainerFormRunners>=100 — every
    // real per-race runner count is well under 100) and substitutes a literal
    // 0. Without this, every single request — including the overwhelming
    // majority that never touch this filter — would pay a $filter/$size scan
    // over every matched race's runners array, which is exactly the class of
    // per-request array scan this DAO has otherwise gone to lengths to avoid
    // on Atlas M0 (see the comments throughout this file).
    const trainerFormFilterActive = minTrainerFormRunners > 0 || maxTrainerFormRunners < 100;
    const trainerFormQualifyingCountExpr = trainerFormFilterActive
      ? {
          $size: {
            $filter: {
              input: "$runners",
              as: "r",
              cond: {
                $and: [
                  { $ne: ["$$r.trainerFormWinRate", null] },
                  { $gte: ["$$r.trainerFormWinRate", trainerFormMinWinRate] },
                ],
              },
            },
          },
        }
      : 0;

    // Same shape again for the model win-probability threshold — a single
    // "at least 1 qualifying runner" check (no separate min/max count pair
    // exposed here, unlike trainerForm's, since there's no UI need for it).
    // Same fast-path reasoning: skip the $filter/$size scan entirely when
    // the threshold is at its 0 no-op default.
    const modelFilterActive = minModelWinProbability > 0;
    const modelQualifyingCountExpr = modelFilterActive
      ? {
          $size: {
            $filter: {
              input: "$runners",
              as: "r",
              cond: {
                $and: [
                  { $ne: ["$$r.modelWinProbability", null] },
                  { $gte: ["$$r.modelWinProbability", minModelWinProbability] },
                ],
              },
            },
          },
        }
      : 0;

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
      ...dateMatchStage,
      ...leadingSortStage,
      {
        $match: {
          ...countryMatch,
          ...courseMatch,
          ...goingMatch,
          ...raceClassMatch,
          ...raceTypeMatch,
          ...runnerTextMatch,
          runnersWithIspCount: { $gte: minRunners, $lte: maxRunners },
        },
      },
      {
        $addFields: {
          allRunnersCount: "$runnersWithIspCount",
          inRangeRunnersCount: inRangeRunnersCountExpr,
          trainerFormQualifyingCount: trainerFormQualifyingCountExpr,
          modelQualifyingCount: modelQualifyingCountExpr,
        },
      },
      {
        $match: {
          $expr: {
            $and: [
              { $gte: ["$inRangeRunnersCount", minInIspRange] },
              { $lte: ["$inRangeRunnersCount", maxInIspRange] },
              { $gte: ["$trainerFormQualifyingCount", minTrainerFormRunners] },
              { $lte: ["$trainerFormQualifyingCount", maxTrainerFormRunners] },
              { $gte: ["$modelQualifyingCount", modelFilterActive ? 1 : 0] },
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
          raceClass: "$_doc.raceClass",
          going: "$_doc.going",
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
                  raceClass: 1,
                  going: 1,
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
            raceClass: 1,
            going: 1,
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
            raceClass: 1,
            going: 1,
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

  public async getDistinctCourses(): Promise<string[]> {
    const values = await this.collection.distinct("course", { course: { $exists: true, $ne: "" } });
    return (values as string[]).filter(Boolean).sort();
  }

  public async getDistinctGoings(): Promise<string[]> {
    const values = await this.collection.distinct("going", { going: { $exists: true, $ne: null } });
    return (values as string[]).filter(Boolean).sort();
  }

  public async getDistinctRaceClasses(): Promise<string[]> {
    const values = await this.collection.distinct("raceClass", { raceClass: { $exists: true, $ne: null } });
    return (values as string[]).filter(Boolean).sort();
  }

  public async getDistinctRaceTypes(): Promise<string[]> {
    const values = await this.collection.distinct("raceType", { raceType: { $exists: true, $ne: "" } });
    return (values as string[]).filter(Boolean).sort();
  }

  public async getFilterBounds(): Promise<IspFilterBounds> {
    // Used to $unwind every race's runners array (~9 runners/race, so
    // ~109k races became ~1M documents flowing through the rest of the
    // pipeline) with no filtering beforehand — a full, unindexed
    // collection scan blown up ~9x before any $group even started. That
    // made this the single slowest request on the home page (~4s live),
    // well past every other query on this screen.
    //
    // maxRunners reuses `runnersWithIspCount`, precomputed + indexed at
    // import time (see the comment on that field above) — no unwind
    // needed, just a $group over the already-matched doc count. minIsp/
    // maxIsp still need every race's runner ISPs, but computing them with
    // $filter + $min/$max *expressions* over each doc's own runners array
    // keeps the pipeline at the raw ~109k-document scale instead of
    // exploding it — no per-runner documents, no $unwind.
    const [result] = await this.collection
      .aggregate<{
        runnerCounts: [{ maxRunners: number }];
        ispBounds: [{ maxIsp: number; minIsp: number }];
      }>([
        {
          $facet: {
            runnerCounts: [{ $group: { _id: null, maxRunners: { $max: "$runnersWithIspCount" } } }],
            ispBounds: [
              {
                $addFields: {
                  validIsps: {
                    $filter: {
                      input: "$runners.isp",
                      as: "isp",
                      cond: { $and: [{ $ne: ["$$isp", null] }, { $gt: ["$$isp", 1] }] },
                    },
                  },
                },
              },
              { $match: { validIsps: { $ne: [] } } },
              {
                $group: {
                  _id: null,
                  maxIsp: { $max: { $max: "$validIsps" } },
                  minIsp: { $min: { $min: "$validIsps" } },
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
      [{ course: 1 }],
      [{ going: 1 }],
      [{ raceClass: 1 }],
      [{ raceType: 1 }],
      [{ "runners.trainer": 1 }],
      [{ "runners.jockey": 1 }],
      [{ "runners.name": 1 }],
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
