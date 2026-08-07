import {
  ModelExperimentDAO,
  ModelExperimentDocument,
  ModelExperimentSummaryDocument,
  ExperimentSegmentDocument,
  DiscoveredSegmentDocument,
  ExperimentMetricsDocument,
} from "../dao/model-experiment-dao";
import { DatabaseConnection } from "../../config/database";

// The shape client/src/services/chatApi.ts expects — nested meta/metrics,
// mirroring how ModelVersionService reshapes a flat model_evaluations doc for
// ModelPerformanceDashboard. The Mongo document itself stays flat, matching
// exactly what ml/experiment.py writes.
export interface ModelExperimentSummaryApiResponse {
  id: string;
  name: string;
  notes: string;
  runAt: string;
  mode: "fast" | "full";
  featureSetName: string;
  objective: string;
  featureCount: number;
  newFeatureCount: number;
  meta: {
    gitCommit: string;
    foldYears: string[];
    foldCount: number;
    scoredRows: number;
    unscoredRows: number;
    droppedTrainRaces: number;
    coverageMinDate: string;
    coverageMaxDate: string;
    totalSeconds: number;
    trainingParams: Record<string, unknown>;
  };
  metrics: {
    model: ExperimentMetricsDocument;
    calibrated: ExperimentMetricsDocument;
    market: ExperimentMetricsDocument;
    bss: number | null;
    deltaVsBaseline: Record<string, number | null> | null;
  };
  baselineExperimentId: string | null;
  discoveredCount: number;
}

export interface ModelExperimentApiResponse extends ModelExperimentSummaryApiResponse {
  featureCols: string[];
  newFeatureCols: string[];
  // Only the features that are actually sparse. The full ~143-row coverage list
  // is noise on a screen; what matters is whether anything is effectively dead,
  // which is the state three of the deployed model's own numeric features have
  // been in since 2026-07-26 without anyone noticing.
  sparseFeatures: Array<{ col: string; populatedPct: number }>;
  folds: Array<Record<string, unknown>>;
  spBandTable: ExperimentSegmentDocument[];
  segments: ExperimentSegmentDocument[];
  segmentDimensions: string[];
  acceptanceRule: Record<string, unknown>;
  discoveredSegments: DiscoveredSegmentDocument[];
  filterBattery: Array<Record<string, unknown>>;
}

// A feature below this is doing nothing useful and the screen says so. Kept in
// step with ml/experiment.py's own MAX_NULL_PCT guard, which fails a run
// outright above 99% null — this is the softer "worth looking at" threshold for
// runs that predate the guard.
const SPARSE_FEATURE_PCT = 5;

function toSummary(doc: ModelExperimentSummaryDocument): ModelExperimentSummaryApiResponse {
  return {
    id: doc.experimentId,
    name: doc.name,
    notes: doc.notes ?? "",
    runAt: doc.runAt,
    mode: doc.mode,
    featureSetName: doc.featureSetName,
    objective: doc.objective,
    // featureCols is projected out of the list query, so the count is computed
    // server-side there ($size in ModelExperimentDAO.getAll); the detail path
    // overrides this from the array it does carry.
    featureCount: doc.featureCount ?? 0,
    newFeatureCount: doc.newFeatureCols?.length ?? 0,
    meta: {
      gitCommit: doc.gitCommit ?? "",
      foldYears: doc.foldYears ?? [],
      foldCount: doc.foldCount ?? 0,
      scoredRows: doc.scoredRows ?? 0,
      unscoredRows: doc.unscoredRows ?? 0,
      droppedTrainRaces: doc.droppedTrainRaces ?? 0,
      coverageMinDate: doc.coverageMinDate ?? "",
      coverageMaxDate: doc.coverageMaxDate ?? "",
      totalSeconds: doc.totalSeconds ?? 0,
      trainingParams: doc.trainingParams ?? {},
    },
    metrics: {
      model: doc.overall?.model,
      calibrated: doc.overall?.calibrated,
      market: doc.overall?.market,
      bss: doc.overall?.bss ?? null,
      deltaVsBaseline: doc.overall?.deltaVsBaseline ?? null,
    },
    baselineExperimentId: doc.baselineExperimentId ?? null,
    discoveredCount: doc.discoveredSegments?.length ?? 0,
  };
}

function toDetail(doc: ModelExperimentDocument): ModelExperimentApiResponse {
  const segments = [...(doc.segments ?? [])].sort(
    (a, b) => a.dimension.localeCompare(b.dimension) || a.bucketOrder - b.bucketOrder
  );
  return {
    ...toSummary(doc as unknown as ModelExperimentSummaryDocument),
    featureCount: doc.featureCols?.length ?? 0,
    featureCols: doc.featureCols ?? [],
    newFeatureCols: doc.newFeatureCols ?? [],
    sparseFeatures: (doc.featureCoverage ?? []).filter(f => f.populatedPct < SPARSE_FEATURE_PCT),
    folds: doc.folds ?? [],
    spBandTable: doc.spBandTable ?? [],
    segments,
    // Sorted here so the component never has to derive its own chip row from
    // the segment list.
    segmentDimensions: [...new Set(segments.map(s => s.dimension))],
    acceptanceRule: doc.acceptanceRule ?? {},
    discoveredSegments: doc.discoveredSegments ?? [],
    filterBattery: doc.filterBattery ?? [],
  };
}

export class ModelExperimentService {
  private dao: ModelExperimentDAO;

  constructor(dao?: ModelExperimentDAO) {
    if (dao) {
      this.dao = dao;
    } else {
      const db = DatabaseConnection.getInstance().getDb();
      this.dao = new ModelExperimentDAO(db);
    }
  }

  public async listExperiments(opts: { mode?: "fast" | "full"; limit?: number } = {}): Promise<ModelExperimentSummaryApiResponse[]> {
    const docs = await this.dao.getAll(opts);
    return docs.map(toSummary);
  }

  public async getExperiment(experimentId: string): Promise<ModelExperimentApiResponse | null> {
    const doc = await this.dao.getById(experimentId);
    return doc ? toDetail(doc) : null;
  }

  public async createIndexes(): Promise<void> {
    await this.dao.createIndexes();
  }
}
