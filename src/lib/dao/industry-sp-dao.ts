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
  // Which training run produced modelWinProbability — set alongside it in
  // ml/train_and_predict.py's per-runner array_filters update. Only ever
  // reflects the MOST RECENT run that scored this runner (each run
  // overwrites both fields together); historical runs can't be
  // reconstructed for runners scored before this field existed.
  modelVersionId?: string | null;
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
   * Builds the race-matching + per-race qualifying-count stages shared by
   * getAllRacesByRace and getRaceConvergenceSeries — extracted so the two
   * can never drift apart on what counts as "a matching race" /
   * "a qualifying runner". Returns the $match (scalar filters + isp-range
   * runner count) + $addFields (qualifying-count expressions) + $match
   * (threshold expr) trio; callers add their own leading date/sort stages
   * and trailing $project.
   */
  private buildQualifyingRaceStages(p: {
    countries: string[];
    minRunners: number;
    maxRunners: number;
    minIsp: number;
    maxIsp: number;
    minInIspRange: number;
    maxInIspRange: number;
    courses: string[];
    goings: string[];
    raceClasses: string[];
    raceTypes: string[];
    trainerSearch: string | null;
    jockeySearch: string | null;
    runnerName: string | null;
    trainerFormMinWinRate: number;
    minTrainerFormRunners: number;
    maxTrainerFormRunners: number;
    minModelWinProbability: number;
    onlyModelBeatsSp: boolean;
    modelVersionId: string | null;
  }): Record<string, unknown>[] {
    const countryMatch = p.countries.length > 0 ? { countryCode: { $in: p.countries } } : {};
    const courseMatch = p.courses.length > 0 ? { course: { $in: p.courses } } : {};
    const goingMatch = p.goings.length > 0 ? { going: { $in: p.goings } } : {};
    const raceClassMatch = p.raceClasses.length > 0 ? { raceClass: { $in: p.raceClasses } } : {};
    const raceTypeMatch = p.raceTypes.length > 0 ? { raceType: { $in: p.raceTypes } } : {};

    const runnerTextMatches: Record<string, unknown>[] = [];
    if (p.trainerSearch) {
      runnerTextMatches.push({
        runners: { $elemMatch: { trainer: { $regex: `^${escapeRegex(p.trainerSearch)}`, $options: "i" } } },
      });
    }
    if (p.jockeySearch) {
      runnerTextMatches.push({
        runners: { $elemMatch: { jockey: { $regex: `^${escapeRegex(p.jockeySearch)}`, $options: "i" } } },
      });
    }
    if (p.runnerName) {
      runnerTextMatches.push({
        runners: { $elemMatch: { name: { $regex: `^${escapeRegex(p.runnerName)}$`, $options: "i" } } },
      });
    }
    const runnerTextMatch = runnerTextMatches.length > 0 ? { $and: runnerTextMatches } : {};

    const runnersInRangeFilter = {
      $filter: {
        input: "$runners",
        as: "r",
        cond: {
          $and: [
            { $ifNull: ["$$r.isp", false] },
            { $gt: ["$$r.isp", 1] },
            { $gte: ["$$r.isp", p.minIsp] },
            { $lte: ["$$r.isp", p.maxIsp] },
          ],
        },
      },
    };

    const ispRangeCoversAllRealValues = p.minIsp <= 1 && p.maxIsp >= 1000;
    const inRangeRunnersCountExpr = ispRangeCoversAllRealValues
      ? "$runnersWithIspCount"
      : { $size: runnersInRangeFilter };

    const trainerFormFilterActive = p.minTrainerFormRunners > 0 || p.maxTrainerFormRunners < 100;
    const trainerFormCond = [
      { $ne: ["$$r.trainerFormWinRate", null] },
      { $gte: ["$$r.trainerFormWinRate", p.trainerFormMinWinRate] },
    ];
    const trainerFormQualifyingCountExpr = trainerFormFilterActive
      ? { $size: { $filter: { input: "$runners", as: "r", cond: { $and: trainerFormCond } } } }
      : 0;

    const modelFilterActive = p.minModelWinProbability > 0;
    const modelCond = [
      { $ne: ["$$r.modelWinProbability", null] },
      { $gte: ["$$r.modelWinProbability", p.minModelWinProbability] },
    ];
    const modelQualifyingCountExpr = modelFilterActive
      ? { $size: { $filter: { input: "$runners", as: "r", cond: { $and: modelCond } } } }
      : 0;

    const modelBeatsSpFilterActive = p.onlyModelBeatsSp;
    const modelBeatsSpCond = [
      { $ne: ["$$r.modelWinProbability", null] },
      { $ne: ["$$r.isp", null] },
      { $gt: ["$$r.isp", 0] },
      { $gt: ["$$r.modelWinProbability", { $divide: [100, "$$r.isp"] }] },
    ];
    const modelBeatsSpQualifyingCountExpr = modelBeatsSpFilterActive
      ? { $size: { $filter: { input: "$runners", as: "r", cond: { $and: modelBeatsSpCond } } } }
      : 0;

    // Which training run scored a runner — set alongside modelWinProbability
    // in ml/train_and_predict.py, so only ever reflects the most recent run
    // (see the modelVersionId comment on IspRunner). Filtering by it lets the
    // dashboard scope a version's own P&L to runners it actually scored,
    // rather than every runner regardless of which run touched them last.
    const modelVersionFilterActive = p.modelVersionId != null;
    const modelVersionCond = [{ $eq: ["$$r.modelVersionId", p.modelVersionId] }];
    const modelVersionQualifyingCountExpr = modelVersionFilterActive
      ? { $size: { $filter: { input: "$runners", as: "r", cond: { $and: modelVersionCond } } } }
      : 0;

    // Combined per-runner qualifying count: isp-in-range AND every currently
    // active runner-level filter, jointly (not independently) — mirrors
    // IspRacesScreen.tsx's client-side qualifyingRunners() exactly, unlike
    // the three counts above (each only proves "at least one runner
    // satisfies THIS filter", not that a single runner satisfies all of them
    // at once). Backs the totalRunners stat. Fast path: identical to
    // inRangeRunnersCount when none of the three optional filters are active.
    const qualifyingRunnersFilterActive =
      trainerFormFilterActive || modelFilterActive || modelBeatsSpFilterActive || modelVersionFilterActive;
    const qualifyingRunnersCountExpr = qualifyingRunnersFilterActive
      ? {
          $size: {
            $filter: {
              input: "$runners",
              as: "r",
              cond: {
                $and: [
                  { $ifNull: ["$$r.isp", false] },
                  { $gt: ["$$r.isp", 1] },
                  { $gte: ["$$r.isp", p.minIsp] },
                  { $lte: ["$$r.isp", p.maxIsp] },
                  ...(trainerFormFilterActive ? trainerFormCond : []),
                  ...(modelFilterActive ? modelCond : []),
                  ...(modelBeatsSpFilterActive ? modelBeatsSpCond : []),
                  ...(modelVersionFilterActive ? modelVersionCond : []),
                ],
              },
            },
          },
        }
      : inRangeRunnersCountExpr;

    return [
      {
        $match: {
          ...countryMatch,
          ...courseMatch,
          ...goingMatch,
          ...raceClassMatch,
          ...raceTypeMatch,
          ...runnerTextMatch,
          runnersWithIspCount: { $gte: p.minRunners, $lte: p.maxRunners },
        },
      },
      {
        $addFields: {
          allRunnersCount: "$runnersWithIspCount",
          inRangeRunnersCount: inRangeRunnersCountExpr,
          trainerFormQualifyingCount: trainerFormQualifyingCountExpr,
          modelQualifyingCount: modelQualifyingCountExpr,
          modelBeatsSpQualifyingCount: modelBeatsSpQualifyingCountExpr,
          modelVersionQualifyingCount: modelVersionQualifyingCountExpr,
          qualifyingRunnersCount: qualifyingRunnersCountExpr,
        },
      },
      {
        $match: {
          $expr: {
            $and: [
              { $gte: ["$inRangeRunnersCount", p.minInIspRange] },
              { $lte: ["$inRangeRunnersCount", p.maxInIspRange] },
              { $gte: ["$trainerFormQualifyingCount", p.minTrainerFormRunners] },
              { $lte: ["$trainerFormQualifyingCount", p.maxTrainerFormRunners] },
              { $gte: ["$modelQualifyingCount", modelFilterActive ? 1 : 0] },
              { $gte: ["$modelBeatsSpQualifyingCount", modelBeatsSpFilterActive ? 1 : 0] },
              { $gte: ["$modelVersionQualifyingCount", modelVersionFilterActive ? 1 : 0] },
            ],
          },
        },
      },
    ];
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
    minModelWinProbability = 0,
    onlyModelBeatsSp = false,
    modelVersionId: string | null = null
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

    // Still needed locally for the pnlStats fast-path decision below
    // (buildQualifyingRaceStages uses the same expression internally for
    // inRangeRunnersCount, but doesn't expose it — trivial to recompute).
    const ispRangeCoversAllRealValues = minIsp <= 1 && maxIsp >= 1000;

    // Same "any of the three optional runner-level filters active" check
    // buildQualifyingRaceStages makes internally for qualifyingRunnersCount
    // (also not exposed — recomputed here). Needed so pnlStats' own fast
    // path only fires when NOTHING narrows the runner set below "every isp
    // in range" — trainer-form/model/model-beats-SP being active must also
    // force the $unwind fallback, same as a narrowed isp range does, or the
    // precomputed raceStaked/raceReturns fields (which don't know about
    // those filters at all) would silently include disqualified runners.
    const trainerFormFilterActive = minTrainerFormRunners > 0 || maxTrainerFormRunners < 100;
    const modelFilterActive = minModelWinProbability > 0;
    const modelBeatsSpFilterActive = onlyModelBeatsSp;
    const modelVersionFilterActive = modelVersionId != null;
    const qualifyingRunnersFilterActive =
      trainerFormFilterActive || modelFilterActive || modelBeatsSpFilterActive || modelVersionFilterActive;

    // Only a per-race id + sort key + the qualifying counts survive into
    // the $facet — every other field (course, meetingName, runners, ...) is
    // re-fetched via $lookup after sorting/paginating down to a handful of
    // docs, never before. This keeps every $sort in this pipeline operating
    // on a ~40-byte doc regardless of collection size. The leading $match
    // (inside buildQualifyingRaceStages) filters on the plain, indexed
    // runnersWithIspCount field directly (not $expr) so it can use the
    // index — this replaces what used to be a $filter/$size scan over
    // every race's embedded runners array on every single request.
    const basePipeline = [
      ...dateMatchStage,
      ...leadingSortStage,
      ...this.buildQualifyingRaceStages({
        countries, minRunners, maxRunners, minIsp, maxIsp, minInIspRange, maxInIspRange,
        courses, goings, raceClasses, raceTypes, trainerSearch, jockeySearch, runnerName,
        trainerFormMinWinRate, minTrainerFormRunners, maxTrainerFormRunners,
        minModelWinProbability, onlyModelBeatsSp, modelVersionId,
      }),
      {
        $project: {
          _id: 1,
          raceTime: 1,
          allRunnersCount: 1,
          inRangeRunnersCount: 1,
          qualifyingRunnersCount: 1,
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
            // Sums qualifyingRunnersCount (isp-in-range AND every currently
            // active runner-level filter, jointly) rather than
            // inRangeRunnersCount — so this reflects the same runner set
            // IspRacesScreen.tsx's client-side qualifyingRunners() actually
            // displays, not just the isp-range filter. Identical to the old
            // sum whenever none of the trainer-form/model/model-beats-SP
            // filters are active (see buildQualifyingRaceStages' fast path).
            totalRunners: [{ $group: { _id: null, count: { $sum: "$qualifyingRunnersCount" } } }],
            // Fast path: raceStaked/raceReturns are precomputed at import time
            // over the same static isp>1 runner set as runnersWithIspCount, so
            // whenever NOTHING narrows the runner set below "every isp in
            // range" — neither the isp range itself nor any of the trainer-
            // form/model/model-beats-SP filters, none of which those
            // precomputed fields know about — this is a plain $sum over
            // already-matched docs. No $lookup, no $unwind over every runner
            // in every matched race (that $lookup was previously the single
            // largest cost in this whole query, since it re-fetched all
            // ~109k matched races' full runners arrays on every request).
            // Regression: reported live — pnlStats.count came out roughly
            // double totalRunners (2992 vs 1589) with "Model beats SP"
            // checked and an isp range that still covered every real value,
            // because this condition only ever checked the isp range,
            // silently taking the fast path (and its filter-blind
            // precomputed fields) even though model-beats-SP was actively
            // narrowing the runner set everywhere else.
            pnlStats: ispRangeCoversAllRealValues && !qualifyingRunnersFilterActive
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
                  // Deliberately its own $lookup + qualifying-runner $filter
                  // rather than reusing reattachFullDoc's runners field —
                  // that field is isp-range-filtered only (intentionally: it
                  // also backs the `data` branch above, which must keep
                  // showing every isp-in-range runner on /isp/races, not
                  // just the narrower qualifying subset). pnlStats needs the
                  // *qualifying* set specifically, to reconcile with
                  // totalRunners' own qualifyingRunnersCount above — same
                  // condition as buildQualifyingRaceStages' internal
                  // qualifyingRunnersCountExpr, duplicated for the same
                  // reason getRaceConvergenceSeries duplicates it (that
                  // method's fast path skips $filter entirely, so it has
                  // nothing to share here).
                  { $lookup: { from: this.collectionName, localField: "_id", foreignField: "_id", as: "_docs" } },
                  { $addFields: { _doc: { $arrayElemAt: ["$_docs", 0] } } },
                  {
                    $addFields: {
                      qualifyingRunners: {
                        $filter: {
                          input: { $ifNull: ["$_doc.runners", []] },
                          as: "r",
                          cond: {
                            $and: [
                              { $ifNull: ["$$r.isp", false] },
                              { $gt: ["$$r.isp", 1] },
                              { $gte: ["$$r.isp", minIsp] },
                              { $lte: ["$$r.isp", maxIsp] },
                              ...(trainerFormFilterActive
                                ? [
                                    { $ne: ["$$r.trainerFormWinRate", null] },
                                    { $gte: ["$$r.trainerFormWinRate", trainerFormMinWinRate] },
                                  ]
                                : []),
                              ...(modelFilterActive
                                ? [
                                    { $ne: ["$$r.modelWinProbability", null] },
                                    { $gte: ["$$r.modelWinProbability", minModelWinProbability] },
                                  ]
                                : []),
                              ...(modelBeatsSpFilterActive
                                ? [
                                    { $ne: ["$$r.modelWinProbability", null] },
                                    { $ne: ["$$r.isp", null] },
                                    { $gt: ["$$r.isp", 0] },
                                    { $gt: ["$$r.modelWinProbability", { $divide: [100, "$$r.isp"] }] },
                                  ]
                                : []),
                              ...(modelVersionFilterActive ? [{ $eq: ["$$r.modelVersionId", modelVersionId] }] : []),
                            ],
                          },
                        },
                      },
                    },
                  },
                  { $unwind: "$qualifyingRunners" },
                  {
                    $group: {
                      _id: null,
                      staked: { $sum: { $divide: [1, { $subtract: ["$qualifyingRunners.isp", 1] }] } },
                      returns: {
                        $sum: {
                          $cond: [
                            { $eq: ["$qualifyingRunners.status", "WINNER"] },
                            { $add: [{ $divide: [1, { $subtract: ["$qualifyingRunners.isp", 1] }] }, 1] },
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
   * Cumulative P&L convergence series, one point per race in [fromRow, toRow]
   * (same 1-based "row N of the current sort order" meaning as
   * getAllRacesByRace's fromRow/toRow). Demonstrates how the running ROI% is
   * volatile over a small sample and settles down as more races are
   * included — shown alongside the split cards as the "P&L Convergence"
   * graph.
   *
   * Unlike a runner-ordinal series, no boundary-resolution pass is needed
   * here: buildQualifyingRaceStages already emits one document per race, so
   * [fromRow, toRow] can be selected with a plain $skip/$limit right after
   * the leading $sort, same as getAllRacesByRace's own row-range handling.
   * The runners array is still present on each doc at this point in the
   * pipeline (no $project has stripped it yet), so the slow path below can
   * filter it directly with no $lookup back to the full document.
   */
  public async getRaceConvergenceSeries(
    minRunners = 1,
    maxRunners = 30,
    countries: string[] = [],
    minIsp = 1,
    maxIsp = 1000,
    minInIspRange = 1,
    maxInIspRange = 1000,
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
    minModelWinProbability = 0,
    onlyModelBeatsSp = false,
    fromRowRaw = 1,
    toRow: number
  ): Promise<{ raceRowNumber: number; cumulativeStaked: number; cumulativeReturns: number }[]> {
    const fromRow = Math.max(1, fromRowRaw);
    if (toRow < fromRow) return [];

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

    // Same qualifying-runner condition as getAllRacesByRace's pnlStats slow
    // path — duplicated rather than shared, because buildQualifyingRaceStages'
    // fast path only exposes a scalar count, not the matching runner
    // subdocuments (isp/status) this needs.
    const trainerFormFilterActive = minTrainerFormRunners > 0 || maxTrainerFormRunners < 100;
    const trainerFormCond = [
      { $ne: ["$$r.trainerFormWinRate", null] },
      { $gte: ["$$r.trainerFormWinRate", trainerFormMinWinRate] },
    ];
    const modelFilterActive = minModelWinProbability > 0;
    const modelCond = [
      { $ne: ["$$r.modelWinProbability", null] },
      { $gte: ["$$r.modelWinProbability", minModelWinProbability] },
    ];
    const modelBeatsSpFilterActive = onlyModelBeatsSp;
    const modelBeatsSpCond = [
      { $ne: ["$$r.modelWinProbability", null] },
      { $ne: ["$$r.isp", null] },
      { $gt: ["$$r.isp", 0] },
      { $gt: ["$$r.modelWinProbability", { $divide: [100, "$$r.isp"] }] },
    ];
    const qualifyingRunnersFilterActive = trainerFormFilterActive || modelFilterActive || modelBeatsSpFilterActive;
    const qualifyingRunnersArrayExpr = {
      $filter: {
        input: "$runners",
        as: "r",
        cond: {
          $and: [
            { $ifNull: ["$$r.isp", false] },
            { $gt: ["$$r.isp", 1] },
            { $gte: ["$$r.isp", minIsp] },
            { $lte: ["$$r.isp", maxIsp] },
            ...(trainerFormFilterActive ? trainerFormCond : []),
            ...(modelFilterActive ? modelCond : []),
            ...(modelBeatsSpFilterActive ? modelBeatsSpCond : []),
          ],
        },
      },
    };

    // Fast path (no runner-level filter active): raceStaked/raceReturns are
    // precomputed at import time over the same static isp>1 runner set, so
    // this is a plain field reference. Slow path re-derives per-race
    // staked/returns from the qualifying runners array via $reduce rather
    // than $unwind, since this needs exactly one output document per race
    // (no fan-out) to keep the cumulative-sum window function below a
    // single race-ordered pass.
    const stakedFieldExpr = qualifyingRunnersFilterActive
      ? {
          $reduce: {
            input: qualifyingRunnersArrayExpr,
            initialValue: 0,
            in: { $add: ["$$value", { $divide: [1, { $subtract: ["$$this.isp", 1] }] }] },
          },
        }
      : "$raceStaked";
    const returnsFieldExpr = qualifyingRunnersFilterActive
      ? {
          $reduce: {
            input: qualifyingRunnersArrayExpr,
            initialValue: 0,
            in: {
              $add: [
                "$$value",
                {
                  $cond: [
                    { $eq: ["$$this.status", "WINNER"] },
                    { $add: [{ $divide: [1, { $subtract: ["$$this.isp", 1] }] }, 1] },
                    0,
                  ],
                },
              ],
            },
          },
        }
      : "$raceReturns";

    const rowSkip = fromRow - 1;
    const rowLimit = toRow - fromRow + 1;

    const points = await this.collection
      .aggregate<{ raceRowNumber: number; cumulativeStaked: number; cumulativeReturns: number }>(
        [
          ...dateMatchStage,
          { $sort: { raceTime: 1 } },
          ...this.buildQualifyingRaceStages({
            countries, minRunners, maxRunners, minIsp, maxIsp, minInIspRange, maxInIspRange,
            courses, goings, raceClasses, raceTypes, trainerSearch, jockeySearch, runnerName: null,
            trainerFormMinWinRate, minTrainerFormRunners, maxTrainerFormRunners,
            minModelWinProbability, onlyModelBeatsSp, modelVersionId: null,
          }),
          { $skip: rowSkip },
          { $limit: rowLimit },
          {
            $setWindowFields: {
              sortBy: { raceTime: 1 },
              output: {
                relRowNumber: { $sum: 1, window: { documents: ["unbounded", "current"] } },
                cumulativeStaked: { $sum: stakedFieldExpr, window: { documents: ["unbounded", "current"] } },
                cumulativeReturns: { $sum: returnsFieldExpr, window: { documents: ["unbounded", "current"] } },
              },
            },
          },
          { $addFields: { raceRowNumber: { $add: ["$relRowNumber", rowSkip] } } },
          { $project: { _id: 0, raceRowNumber: 1, cumulativeStaked: 1, cumulativeReturns: 1 } },
        ],
        { allowDiskUse: true }
      )
      .toArray();

    return points;
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
