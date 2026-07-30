import { Collection, Db } from "mongodb";

/**
 * Aggregates industry_starting_prices runners into bands of the MODEL's own
 * implied price, so each band can be checked against what actually happened
 * and against what the market thought.
 *
 * Deliberately a separate DAO rather than another method on industry-sp-dao.ts,
 * which AGENTS.md flags as a contested file — same split precedent as
 * model-version-dao.ts. The cost is that IndustrySpDAO.buildQualifyingRaceStages
 * is private and can't be reused, so the race-level $match is re-implemented
 * here; that helper only ever returns scalar counts, never the matching runner
 * subdocuments, so both existing P&L consumers in that file duplicate the same
 * logic anyway (see the comments at industry-sp-dao.ts:591-604 and :913-916).
 */

// Bucketed on modelWinProbability rather than on a computed price, so the
// boundaries are exact and no division happens inside the pipeline. Each band
// is [lower, upper) per $bucket semantics; 100.0001 as the final boundary keeps
// a runner priced at exactly 100% inside the last band rather than in `default`.
// price = 100 / modelWinProbability, hence the labels in model-accuracy-service.ts.
export const MODEL_ACCURACY_BAND_BOUNDARIES = [0, 5, 10, 20, 100 / 3, 50, 100.0001];

// $bucket's escape hatch. Should never be populated — modelWinProbability is a
// 0-100 percentage — so it's surfaced rather than silently dropped, because a
// non-empty "unbanded" row means the boundaries above are wrong.
export const UNBANDED_KEY = "unbanded";

export interface ModelAccuracyBandRaw {
  // The band's lower boundary, or UNBANDED_KEY for the $bucket default.
  _id: number | typeof UNBANDED_KEY;
  // Deliberately not named `runners` — that name is the runner *array* on a
  // race document, and app.test.ts's shared aggregate mock carries it as such.
  runnerCount: number;
  wins: number;
  modelProbSum: number;
  marketProbFairSum: number;
  marketProbRawSum: number;
  staked: number;
  returns: number;
  modelSqErrSum: number;
  marketSqErrSum: number;
}

export interface ModelAccuracyQuery {
  minRaceTime: string | null;
  maxRaceTime: string | null;
  countries: string[];
  courses: string[];
  goings: string[];
  raceClasses: string[];
  raceTypes: string[];
  minRunners: number;
  maxRunners: number;
  modelVersionId: string | null;
}

export class ModelAccuracyDAO {
  private collection: Collection<Record<string, unknown>>;

  constructor(db: Db, collectionName = "industry_starting_prices") {
    this.collection = db.collection<Record<string, unknown>>(collectionName);
  }

  /**
   * One row per model-price band, as raw sums — every rate/mean/P&L figure is
   * derived from these in ModelAccuracyService, matching how
   * industry-sp-service.ts:316-322 computes cumulativePnl/roiPercent outside
   * Mongo rather than inside the pipeline.
   */
  public async getPriceBandAccuracy(p: ModelAccuracyQuery): Promise<ModelAccuracyBandRaw[]> {
    // Leading date $match on raceTime, not raceDate — raceTime is the indexed
    // field ({raceTime: 1}) and its "YYYY-MM-DDTHH:mm:ss" prefix makes a date
    // range a plain indexed string range (same reasoning as
    // industry-sp-dao.ts:695-698).
    const dateMatchStage: Record<string, unknown>[] =
      p.minRaceTime != null || p.maxRaceTime != null
        ? [
            {
              $match: {
                raceTime: {
                  ...(p.minRaceTime != null ? { $gte: p.minRaceTime } : {}),
                  ...(p.maxRaceTime != null ? { $lte: p.maxRaceTime } : {}),
                },
              },
            },
          ]
        : [];

    const scalarMatch: Record<string, unknown> = {
      ...(p.countries.length > 0 ? { countryCode: { $in: p.countries } } : {}),
      ...(p.courses.length > 0 ? { course: { $in: p.courses } } : {}),
      ...(p.goings.length > 0 ? { going: { $in: p.goings } } : {}),
      ...(p.raceClasses.length > 0 ? { raceClass: { $in: p.raceClasses } } : {}),
      ...(p.raceTypes.length > 0 ? { raceType: { $in: p.raceTypes } } : {}),
      // Plain indexed field, not an $expr, so it can use {runnersWithIspCount: 1}
      // — same reason industry-sp-dao.ts:243 filters on it here rather than
      // recomputing the count.
      runnersWithIspCount: { $gte: p.minRunners, $lte: p.maxRunners },
    };

    const pipeline: Record<string, unknown>[] = [
      ...dateMatchStage,
      { $match: scalarMatch },
      {
        // The book's total implied probability for this race, computed while
        // runners[] is still an array. A bookmaker's SP book sums to ~115-125%,
        // not 100% — dividing by this is what makes the market column
        // comparable to a model column that ml/train_and_predict.py's
        // normalize_within_race() has already forced to sum to exactly 100.
        $addFields: {
          _bookSum: {
            $reduce: {
              input: "$runners",
              initialValue: 0,
              in: {
                $add: [
                  "$$value",
                  { $cond: [{ $gt: ["$$this.isp", 1] }, { $divide: [100, "$$this.isp"] }, 0] },
                ],
              },
            },
          },
        },
      },
      { $unwind: "$runners" },
      {
        $match: {
          // isp > 1 is the eligibility gate used everywhere else in this repo
          // (import-industry-sp.ts:139) — it also excludes null, since Mongo
          // sorts null below every number.
          "runners.isp": { $gt: 1 },
          // $ne: null excludes missing as well as explicit null, so runners the
          // ML pipeline has never scored drop out entirely rather than counting
          // as a 0% band.
          "runners.modelWinProbability": { $ne: null },
          ...(p.modelVersionId != null ? { "runners.modelVersionId": p.modelVersionId } : {}),
        },
      },
      {
        // Project down to scalars BEFORE $bucket. industry-sp-dao.ts:993-1021
        // documents a real 32MB blowup from carrying runners[] further down a
        // pipeline than necessary.
        $project: {
          _id: 0,
          modelProb: "$runners.modelWinProbability",
          marketProbRaw: { $divide: [100, "$runners.isp"] },
          marketProbFair: {
            $cond: [
              { $gt: ["$_bookSum", 0] },
              {
                $multiply: [{ $divide: [{ $divide: [100, "$runners.isp"] }, "$_bookSum"] }, 100],
              },
              0,
            ],
          },
          isWin: { $cond: [{ $eq: ["$runners.status", "WINNER"] }, 1, 0] },
          // Level £1-to-win staking, the repo-wide convention: stake
          // 1/(isp-1) to return stake+1 on a winner (import-industry-sp.ts:137-144,
          // industry-sp-dao.ts:660-666, ispFormat.ts:15-17).
          stake: { $divide: [1, { $subtract: ["$runners.isp", 1] }] },
        },
      },
      {
        $bucket: {
          groupBy: "$modelProb",
          boundaries: MODEL_ACCURACY_BAND_BOUNDARIES,
          default: UNBANDED_KEY,
          output: {
            runnerCount: { $sum: 1 },
            wins: { $sum: "$isWin" },
            modelProbSum: { $sum: "$modelProb" },
            marketProbFairSum: { $sum: "$marketProbFair" },
            marketProbRawSum: { $sum: "$marketProbRaw" },
            staked: { $sum: "$stake" },
            returns: {
              $sum: { $cond: [{ $eq: ["$isWin", 1] }, { $add: ["$stake", 1] }, 0] },
            },
            // Brier contributions — squared error of a probability against the
            // 0/1 outcome. Summed here, divided by `runners` in the service.
            modelSqErrSum: {
              $sum: { $pow: [{ $subtract: [{ $divide: ["$modelProb", 100] }, "$isWin"] }, 2] },
            },
            marketSqErrSum: {
              $sum: { $pow: [{ $subtract: [{ $divide: ["$marketProbFair", 100] }, "$isWin"] }, 2] },
            },
          },
        },
      },
    ];

    // A band aggregation is inherently a runner-level narrowing across embedded
    // arrays, so there's no index to exploit past the leading $match and no
    // equivalent of getAllRacesByRace's precomputed raceStaked/raceReturns fast
    // path (industry-sp-dao.ts:429-445). Allow spilling rather than risk the
    // 100MB in-memory group limit on a full-history query.
    const docs = await this.collection
      .aggregate<ModelAccuracyBandRaw>(pipeline, { allowDiskUse: true })
      .toArray();

    return docs;
  }
}
