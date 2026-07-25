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

export class ModelVersionDAO {
  private collection: Collection<ModelVersionDocument>;

  constructor(db: Db, collectionName = "model_evaluations") {
    this.collection = db.collection<ModelVersionDocument>(collectionName);
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
