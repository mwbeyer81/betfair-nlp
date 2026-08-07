import { Collection, Db } from "mongodb";

export interface ModelTrainingParamsDocument {
  nEstimators: number;
  learningRate: number;
  maxDepth: number;
  subsample: number;
  colsampleBytree: number;
  minChildWeight: number;
  randomState: number;
  earlyStoppingRounds: number;
}

export interface CalibrationBucketDocument {
  meanPredicted: number;
  actualWinRate: number;
  n: number;
}

// Matches exactly what ml/train_and_predict.py's save_evaluation() writes to
// the model_evaluations collection — a flat document, not nested. Nesting
// into the frontend's ModelVersion shape ({runMeta, performanceMetrics})
// happens in ModelVersionService, not here.
export interface ModelVersionDocument {
  modelVersionId: string;
  runLabel: string;
  runAt: string;
  trainingParams: ModelTrainingParamsDocument;
  featureCols: string[];
  trainRows: number;
  testRows: number;
  trainDateMax: string;
  testDateMin: string;
  bestIteration: number;
  aucRoc: number;
  logLoss: number;
  brierScore: number;
  calibrationTable: CalibrationBucketDocument[];
}

// The date window over which an out-of-sample score actually exists — written
// by ml/walk_forward_score.py's own evaluation doc, not derived here.
//
// This is worth exposing to the UI because the window has hard edges and both
// of them silently swallow filters. `coverageMinDate` is the first year the
// walk-forward could score at all (the earliest year has no prior history to
// fit on, so ~86k runners are deliberately left unscored), and every model
// filter reads MODEL_PROB_FIELD, so a date range starting before it returns
// nothing for that stretch — correctly, but invisibly.
export interface ModelScoreCoverageDocument {
  oosVersionId: string;
  coverageMinDate: string;
  // The last race that ACTUALLY carries an out-of-sample score, read from the
  // data rather than from the walk-forward document.
  //
  // Those two stopped being the same thing on 2026-08-04, when
  // industry-sp-results-capture-service.ts started writing each day's live
  // pre-race prediction into the out-of-sample field as well (commit 5ac6e26).
  // Coverage now extends by a day every day, while the walk-forward document's
  // own coverageMaxDate is frozen at whenever that script last ran. Reading the
  // frozen value told users their date range was out of coverage when it was
  // not, and the error grew by a day daily — it was a week wide when caught.
  coverageMaxDate: string;
  // What the last walk-forward pass itself reached. Kept as its own field
  // because the two now answer different questions: "how far has the backtest
  // been run, and does it need re-running" is no longer visible from
  // coverageMaxDate above.
  walkForwardMaxDate: string;
  scoredRows: number;
  unscoredRows: number;
}

export class ModelVersionDAO {
  private collection: Collection<ModelVersionDocument>;
  private racesCollection: Collection<Record<string, unknown>>;

  constructor(db: Db, collectionName = "model_evaluations", racesCollectionName = "industry_starting_prices") {
    this.collection = db.collection<ModelVersionDocument>(collectionName);
    this.racesCollection = db.collection<Record<string, unknown>>(racesCollectionName);
  }

  /**
   * The raceDate of the most recent race that carries any out-of-sample score,
   * or null if none does.
   *
   * Sorted on `raceTime` rather than `raceDate` on purpose: raceTime is
   * indexed and raceDate is not, and since raceTime is the same date with a
   * clock time appended, the two sort identically. That turns a ~110k-document
   * collection scan into a single index seek — measured at 1 document
   * examined, 1 key, 0ms, against 0.3s for the unindexed sort.
   *
   * `$type: "number"` rather than `$ne: null`: on an array field `$ne` matches
   * documents where NO element equals null, which would wrongly exclude every
   * race that has even one unscored runner — and most races have some.
   */
  private async latestScoredRaceDate(): Promise<string | null> {
    const doc = await this.racesCollection.findOne(
      { "runners.modelWinProbabilityOos": { $type: "number" } },
      { projection: { raceDate: 1 }, sort: { raceTime: -1 } }
    );
    const raceDate = doc?.raceDate;
    return typeof raceDate === "string" ? raceDate : null;
  }

  /**
   * Coverage of the most recent walk-forward run, or null if none has been
   * recorded yet (a database seeded only with ordinary training runs, which is
   * the normal state of a fresh local stack).
   *
   * Deliberately keyed on `evaluationType: "walk_forward"` rather than sharing
   * getAll()'s `modelVersionId` filter: walk-forward docs carry `oosVersionId`
   * instead, so the two queries select disjoint sets of documents from the same
   * collection and neither can accidentally return the other's shape.
   */
  public async getWalkForwardCoverage(): Promise<ModelScoreCoverageDocument | null> {
    const doc = await this.collection.findOne(
      {
        evaluationType: "walk_forward",
        coverageMinDate: { $exists: true, $ne: null },
        coverageMaxDate: { $exists: true, $ne: null },
      } as unknown as Record<string, unknown>,
      { sort: { runAt: -1 } }
    );
    if (!doc) return null;
    const d = doc as unknown as Partial<ModelScoreCoverageDocument>;
    if (typeof d.coverageMinDate !== "string" || typeof d.coverageMaxDate !== "string") return null;
    // The live edge wins where it is ahead of the walk-forward's own figure —
    // which it now is, and by more every day. Falls back to the document's
    // value if the lookup finds nothing (a fresh local stack with an
    // evaluation doc seeded but no scored races), so this can only ever widen
    // the reported window, never narrow it below what the doc already claimed.
    const liveMax = await this.latestScoredRaceDate();
    const coverageMaxDate = liveMax && liveMax > d.coverageMaxDate ? liveMax : d.coverageMaxDate;
    return {
      oosVersionId: typeof d.oosVersionId === "string" ? d.oosVersionId : "",
      coverageMinDate: d.coverageMinDate,
      coverageMaxDate,
      walkForwardMaxDate: d.coverageMaxDate,
      scoredRows: typeof d.scoredRows === "number" ? d.scoredRows : 0,
      unscoredRows: typeof d.unscoredRows === "number" ? d.unscoredRows : 0,
    };
  }

  /**
   * All model versions, newest first. Older evaluation docs written before
   * modelVersionId existed are excluded — they have no stable id to key on.
   */
  public async getAll(): Promise<ModelVersionDocument[]> {
    return await this.collection
      .find({ modelVersionId: { $exists: true } })
      .sort({ runAt: -1 })
      .toArray();
  }

  public async getById(modelVersionId: string): Promise<ModelVersionDocument | null> {
    return await this.collection.findOne({ modelVersionId });
  }
}
