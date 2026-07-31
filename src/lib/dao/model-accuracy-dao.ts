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

/**
 * The probability this screen bands on, and the reason it is NOT
 * `modelWinProbability`.
 *
 * `modelWinProbability` is written by ml/train_and_predict.py's final refit,
 * which fits on every row including the ones it then scores — so on a
 * historical race it is the output of a model that already knew that race's
 * result. Measured, that is worth about 0.008 of Brier (0.0893 in-sample
 * against 0.0968 on a held-out tail): enough to turn a screen whose entire
 * purpose is "how accurate is the model" into an advert.
 *
 * `modelWinProbabilityOos` is written by ml/walk_forward_score.py, where every
 * race is scored by a model fitted only on races that finished before it. It
 * is absent on the earliest races (nothing to learn from yet) and that absence
 * is load-bearing — see the $ne: null gate below.
 *
 * There is deliberately no per-runner version id alongside it: an out-of-sample
 * score has no single model behind it (2019's rows come from a model fitted on
 * 2015-2018, 2020's from one fitted on 2015-2019), so a modelVersionId filter
 * would be meaningless here. The run's identity and its fold boundaries live
 * once in model_evaluations instead.
 */
export const MODEL_ACCURACY_PROB_FIELD = "modelWinProbabilityOos";

// Bucketed on the out-of-sample probability rather than on a computed price, so the
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
}

/**
 * How much of the filtered window could actually be measured. `eligible` is
 * every runner with a real industry SP; `scored` is the subset that also
 * carries an out-of-sample probability. The difference is not an error — the
 * earliest races have no prior history to be scored from — but it has to be
 * stated, or a window that is 40% unmeasurable reads exactly like one that
 * isn't.
 */
export interface ModelAccuracyCoverageRaw {
  eligibleRunners: number;
  scoredRunners: number;
}

export interface ModelAccuracyAggregate {
  bands: ModelAccuracyBandRaw[];
  coverage: ModelAccuracyCoverageRaw;
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
  public async getPriceBandAccuracy(p: ModelAccuracyQuery): Promise<ModelAccuracyAggregate> {
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
        },
      },
      {
        // One pass, two outputs. A $facet here is safe in a way it would not
        // be in industry-sp-dao.ts's paging queries: both branches emit a
        // handful of small documents (six bands and one counter), so the
        // 16MB single-document ceiling that rules $facet out there never comes
        // near being a factor. The alternative — a second aggregation for the
        // counts — would mean unwinding ~970k runner subdocuments twice per
        // screen load against a shared-tier cluster.
        $facet: {
          coverage: [
            {
              $group: {
                _id: null,
                eligibleRunners: { $sum: 1 },
                scoredRunners: {
                  // $type, NOT { $ne: [<path>, null] }. Query-language
                  // `{field: {$ne: null}}` excludes a missing field; the
                  // aggregation EXPRESSION `$ne` does not — a missing path is
                  // its own "missing" value and compares unequal to null. Both
                  // forms appear in this one pipeline (the bands branch below
                  // uses the query form inside $match, correctly), which is
                  // exactly how this went wrong the first time.
                  //
                  // Measured on production: the expression form counted
                  // 971,116 of 971,116 runners as scored when only 885,089
                  // carry the field. A fixture with an explicit `null` passes
                  // either way — real unscored runners have no field at all,
                  // so only a $type check describes them.
                  $sum: {
                    $cond: [
                      { $in: [{ $type: `$runners.${MODEL_ACCURACY_PROB_FIELD}` }, ["missing", "null"]] },
                      0,
                      1,
                    ],
                  },
                },
              },
            },
          ],
          bands: buildBandStages(),
        },
      },
    ];

    // A band aggregation is inherently a runner-level narrowing across embedded
    // arrays, so there's no index to exploit past the leading $match and no
    // equivalent of getAllRacesByRace's precomputed raceStaked/raceReturns fast
    // path (industry-sp-dao.ts:429-445). Allow spilling rather than risk the
    // 100MB in-memory group limit on a full-history query.
    const [doc] = await this.collection
      .aggregate<{ bands: ModelAccuracyBandRaw[]; coverage: ModelAccuracyCoverageRaw[] }>(pipeline, {
        allowDiskUse: true,
      })
      .toArray();

    return {
      bands: doc?.bands ?? [],
      // An empty window produces no coverage row at all, which is zero of
      // zero rather than a missing measurement.
      coverage: doc?.coverage?.[0] ?? { eligibleRunners: 0, scoredRunners: 0 },
    };
  }
}

/**
 * The banding half of the pipeline, from the point where a runner is already
 * unwound and known to have a real SP. Split out only so the $facet above
 * stays readable — it is not reused anywhere else.
 */
function buildBandStages(): Record<string, unknown>[] {
  return [
    {
      $match: {
        // $ne: null excludes missing as well as explicit null, so a runner
        // with no out-of-sample score drops out entirely rather than being
        // counted as a 0% band. This is the single most important line in
        // the file: the unscoreable early years must not be silently
        // folded in as certainties the model got wrong.
        [`runners.${MODEL_ACCURACY_PROB_FIELD}`]: { $ne: null },
      },
    },
    {
        // Project down to scalars BEFORE $bucket. industry-sp-dao.ts:993-1021
        // documents a real 32MB blowup from carrying runners[] further down a
        // pipeline than necessary.
        $project: {
          _id: 0,
          modelProb: `$runners.${MODEL_ACCURACY_PROB_FIELD}`,
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
}
