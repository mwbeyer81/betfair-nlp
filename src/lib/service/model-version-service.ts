import { ModelVersionDAO, ModelVersionDocument, ModelScoreCoverageDocument } from "../dao/model-version-dao";
import { DatabaseConnection } from "../../config/database";

// The shape client/src/services/chatApi.ts's ModelVersion interface expects
// — nested runMeta/performanceMetrics, matching what
// ModelPerformanceDashboard.tsx was already built against. The Mongo
// document itself (ModelVersionDocument) stays flat, matching exactly what
// ml/train_and_predict.py's save_evaluation() writes.
export interface ModelVersionApiResponse {
  id: string;
  runLabel: string;
  runAt: string;
  trainingParams: ModelVersionDocument["trainingParams"];
  runMeta: {
    featureCols: string[];
    trainRows: number;
    testRows: number;
    trainDateMax: string;
    testDateMin: string;
    bestIteration: number;
  };
  performanceMetrics: {
    aucRoc: number;
    logLoss: number;
    brierScore: number;
    calibrationTable: ModelVersionDocument["calibrationTable"];
  };
}

function toApiResponse(doc: ModelVersionDocument): ModelVersionApiResponse {
  return {
    id: doc.modelVersionId,
    runLabel: doc.runLabel,
    runAt: doc.runAt,
    trainingParams: doc.trainingParams,
    runMeta: {
      featureCols: doc.featureCols,
      trainRows: doc.trainRows,
      testRows: doc.testRows,
      trainDateMax: doc.trainDateMax,
      testDateMin: doc.testDateMin,
      bestIteration: doc.bestIteration,
    },
    performanceMetrics: {
      aucRoc: doc.aucRoc,
      logLoss: doc.logLoss,
      brierScore: doc.brierScore,
      calibrationTable: doc.calibrationTable,
    },
  };
}

export class ModelVersionService {
  private modelVersionDAO: ModelVersionDAO;

  constructor(modelVersionDAO?: ModelVersionDAO) {
    if (modelVersionDAO) {
      this.modelVersionDAO = modelVersionDAO;
    } else {
      const db = DatabaseConnection.getInstance().getDb();
      this.modelVersionDAO = new ModelVersionDAO(db);
    }
  }

  public async getAllModelVersions(): Promise<ModelVersionApiResponse[]> {
    const docs = await this.modelVersionDAO.getAll();
    return docs.map(toApiResponse);
  }

  /** Thin passthrough — see ModelScoreCoverageDocument for why this exists. */
  public async getModelScoreCoverage(): Promise<ModelScoreCoverageDocument | null> {
    return this.modelVersionDAO.getWalkForwardCoverage();
  }
}
