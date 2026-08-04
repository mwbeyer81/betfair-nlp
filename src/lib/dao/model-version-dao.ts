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
// nothing for that stretch — correctly, but invisibly. `coverageMaxDate` is
// the last race the most recent walk-forward pass covered; races since then
// are equally invisible until it is re-run.
export interface ModelScoreCoverageDocument {
  oosVersionId: string;
  coverageMinDate: string;
  coverageMaxDate: string;
  scoredRows: number;
  unscoredRows: number;
}

export class ModelVersionDAO {
  private collection: Collection<ModelVersionDocument>;

  constructor(db: Db, collectionName = "model_evaluations") {
    this.collection = db.collection<ModelVersionDocument>(collectionName);
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
    return {
      oosVersionId: typeof d.oosVersionId === "string" ? d.oosVersionId : "",
      coverageMinDate: d.coverageMinDate,
      coverageMaxDate: d.coverageMaxDate,
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
