import { Collection, Db } from "mongodb";

// Matches exactly what ml/experiment.py writes to the model_experiments
// collection — a flat document, not nested. Nesting into the frontend's shape
// ({meta, metrics}) happens in ModelExperimentService, not here, the same
// split ModelVersionDAO/ModelVersionService already use.
//
// WHY THIS IS A SEPARATE COLLECTION FROM model_evaluations. That collection has
// two readers on paths that must not break:
//   - ml/train_and_predict.py's current_champion(), which selects the model a
//     retrain is gated against
//   - ml/predict_daily_races.py's latest-version lookup, on the DEPLOYED daily
//     prediction path
// Both were allow-by-default over document *type*, so any new shape dropped
// into model_evaluations became eligible for them by accident. An experiment
// doc scores log loss around 0.30 against the best real training run's 0.32091,
// so it would have become a permanent champion that no genuine retrain could
// ever beat — while having no model artifact anywhere to deploy. The gate is
// now an allow-list on modelVersionId as well, but experiments living in their
// own collection is the belt to that braces: a shape that churns through a
// research phase has no business sharing a collection the deployed pipeline
// reads.

export interface ExperimentMetricsDocument {
  n: number;
  aucRoc: number | null;
  logLoss: number | null;
  brierScore: number | null;
  // Discrimination, which is the point of the whole exercise: 99.2% of the
  // model's Brier deficit against industry SP is resolution, not calibration.
  resolution?: number | null;
  reliability?: number | null;
  uncertainty?: number | null;
  withinBin?: number | null;
  top1Rate?: number | null;
  mrr?: number | null;
  races?: number;
}

export interface ExperimentPnlDocument {
  staked: number;
  returns: number;
  pnl: number;
  roiPct: number | null;
}

export interface ExperimentSelectionDocument {
  n: number;
  wins: number;
  strikeRate: number | null;
  // Both staking conventions, always. to-win-1 (stake = 1/(isp-1)) is the
  // repo's own convention; level stakes is the one to read for "is there an
  // edge", because to-win-1 stakes ~£2 on an evens shot and ~£0.05 on a 21.0
  // shot and so is dominated by favourites. A selection positive under one and
  // negative under the other is noise — see ACCEPTANCE_RULE in experiment.py.
  pnl: { toWin1: ExperimentPnlDocument | null; level: ExperimentPnlDocument | null };
  bettableN: number;
}

export interface ExperimentSegmentDocument {
  dimension: string;
  bucket: string;
  bucketOrder: number;
  n: number;
  scoredN: number;
  wins: number;
  strikeRate: number;
  model: ExperimentMetricsDocument;
  market: ExperimentMetricsDocument;
  bss: number | null;
  selections: Record<string, ExperimentSelectionDocument>;
  yearsPositiveToWin1: number;
  yearsPositiveLevel: number;
}

export interface DiscoveredSegmentDocument {
  dimension: string;
  bucket: string;
  selection: string;
  n: number;
  bss: number | null;
  strikeRate: number | null;
  roiToWin1: number | null;
  roiLevel: number | null;
  yearsPositiveToWin1: number;
  // False when the slice is real but the Filters screen has no URL param for
  // it (month, distanceBand, isHandicap, and the model-top-1 selection). The
  // UI says so rather than anyone inventing a param that does not exist.
  ispFilterable: boolean;
  filters: Record<string, string> | null;
}

export interface ModelExperimentDocument {
  experimentId: string;
  name: string;
  notes: string;
  runAt: string;
  gitCommit: string;
  mode: "fast" | "full";
  featureSetName: string;
  objective: string;
  featureCols: string[];
  newFeatureCols: string[];
  featureCoverage: Array<{ col: string; populatedPct: number }>;
  trainingParams: Record<string, unknown>;
  foldYears: string[];
  foldCount: number;
  scoredRows: number;
  unscoredRows: number;
  droppedTrainRaces: number;
  coverageMinDate: string;
  coverageMaxDate: string;
  overall: {
    model: ExperimentMetricsDocument;
    calibrated: ExperimentMetricsDocument;
    market: ExperimentMetricsDocument;
    bss: number | null;
    deltaVsBaseline?: Record<string, number | null>;
  };
  baselineExperimentId?: string;
  folds: Array<Record<string, unknown>>;
  spBandTable: ExperimentSegmentDocument[];
  segments: ExperimentSegmentDocument[];
  acceptanceRule: Record<string, unknown>;
  discoveredSegments: DiscoveredSegmentDocument[];
  filterBattery: Array<Record<string, unknown>>;
  totalSeconds: number;
  wroteModelArtifacts: boolean;
}

export type ModelExperimentSummaryDocument = Omit<
  ModelExperimentDocument,
  "segments" | "spBandTable" | "folds" | "featureCoverage" | "featureCols"
> & { featureCount: number };

// Dropped from the list view deliberately, not by oversight: a single
// experiment carries ~56 segments, each holding three selections' worth of P&L
// under two staking conventions, plus a coverage row per feature for ~143
// features. Fifty experiments of that is megabytes of payload for a screen
// showing one line each — and the omission is invisible unless a test asserts
// it, which model-experiment-dao.integration.test.ts does.
const SUMMARY_OMITTED_FIELDS = [
  "segments",
  "spBandTable",
  "folds",
  "featureCoverage",
  "featureCols",
] as const;

export class ModelExperimentDAO {
  private collection: Collection<ModelExperimentDocument>;

  constructor(db: Db, collectionName = "model_experiments") {
    this.collection = db.collection<ModelExperimentDocument>(collectionName);
  }

  /**
   * Every experiment, newest first, without the heavyweight sub-documents.
   *
   * `mode` narrows to fast or full runs. That matters more than it looks: a
   * fast run scores five folds on half the races with a tree cap, so its
   * metrics are NOT comparable to a full eleven-fold run's, and reading a
   * mixed list top-to-bottom invites exactly that comparison. experiment.py
   * refuses to record a capped run as "full" for the same reason.
   */
  public async getAll(opts: { mode?: "fast" | "full"; limit?: number } = {}): Promise<ModelExperimentSummaryDocument[]> {
    const filter = opts.mode ? { mode: opts.mode } : {};
    // An aggregation rather than find(), for one reason: featureCount. The
    // list needs to show how many features an experiment used, but shipping
    // the ~143-entry featureCols array for every row to display one integer is
    // exactly the payload this projection exists to avoid. $size computes it
    // server-side, which also means it is right for documents already written
    // — a stored count would have read 0 for every experiment that predated
    // the field. (Found by querying the running API, not by a unit test: every
    // list row said "0 features".)
    return (await this.collection
      .aggregate([
        { $match: filter },
        { $sort: { runAt: -1 } },
        { $limit: Math.min(Math.max(opts.limit ?? 100, 1), 500) },
        { $addFields: { featureCount: { $size: { $ifNull: ["$featureCols", []] } } } },
        { $unset: [...SUMMARY_OMITTED_FIELDS] },
      ])
      .toArray()) as unknown as ModelExperimentSummaryDocument[];
  }

  /** The full document, segments and all. Null for an unknown id. */
  public async getById(experimentId: string): Promise<ModelExperimentDocument | null> {
    return await this.collection.findOne({ experimentId });
  }

  public async createIndexes(): Promise<void> {
    await this.collection.createIndex({ experimentId: 1 }, { unique: true });
    await this.collection.createIndex({ runAt: -1 });
    await this.collection.createIndex({ mode: 1, runAt: -1 });
  }
}
