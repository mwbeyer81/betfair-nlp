import { AGENT_USER_ID, SavedFilterSetDAO, SavedFilterSetDocument, SavedFilterSetSplit } from "../dao/saved-filter-set-dao";
import { IndustrySpService } from "./industry-sp-service";
import { DatabaseConnection } from "../../config/database";
import { parseDateRangeParams, parseCsvListParam } from "./filter-params-util";
import { DynamicFilters, parseDynamicFilters } from "../filters/dynamic-filter-params";

// A snapshot is computed once, at save time, over the full qualifying set
// (not paginated) — mirrors the authenticated race cap used elsewhere
// (router.ts's clampRowSpan / getSplitStats raceCap).
const SAVE_SNAPSHOT_MAX_ROWS = 10000;

export interface SavedFilterSetApiResponse {
  id: string;
  name: string;
  filters: Record<string, string>;
  splitA: SavedFilterSetSplit;
  splitB: SavedFilterSetSplit;
  createdAt: string;
  createdBy: "user" | "agent";
  modelVersionId?: string;
}

function toApiResponse(doc: SavedFilterSetDocument): SavedFilterSetApiResponse {
  return {
    id: doc._id!.toString(),
    name: doc.name,
    filters: doc.filters,
    splitA: doc.splitA,
    splitB: doc.splitB,
    createdAt: doc.createdAt,
    // Absent on legacy docs saved before this field existed — default to
    // "user" so the frontend never has to special-case undefined.
    createdBy: doc.createdBy ?? "user",
    modelVersionId: doc.modelVersionId,
  };
}

// Params needed to recompute a filter set's qualifying races — same shape
// IndustrySpService.getSplitStats/getRaceConvergenceSeries already take.
// Built by the router from the raw filters string map (see POST
// /api/saved-filter-sets). fromRowA/toRowA/fromRowB/toRowB are the same
// explicit-split-boundary params getSplitStats already accepts — null means
// "not explicitly set", which getSplitStats resolves to the default
// half/half divide, exactly like the live Filters screen does.
export interface ComputeSnapshotParams {
  minRunners: number;
  maxRunners: number;
  countries: string[];
  minIsp: number;
  maxIsp: number;
  minInIspRange: number;
  maxInIspRange: number;
  fromRowA: number | null;
  toRowA: number | null;
  fromRowB: number | null;
  toRowB: number | null;
  minRaceTime: string | null;
  maxRaceTime: string | null;
  courses: string[];
  goings: string[];
  raceClasses: string[];
  raceTypes: string[];
  trainerSearch: string | null;
  jockeySearch: string | null;
  trainerFormMinWinRate: number;
  minTrainerFormRunners: number;
  maxTrainerFormRunners: number;
  minModelWinProbability: number;
  onlyModelBeatsSp: boolean;
  minModelSpEdgePts: number;
  // Registry-driven raw-model-field filters (src/lib/filters/field-registry.ts).
  // A saved filter set predating them simply has no min*/max* keys for them in
  // its `filters` map, which parses to {} — so old saved results replay exactly
  // as they always did.
  dynamicFilters: DynamicFilters;
}

// filters/name/courses/etc placed first in the auto-name search order
// roughly matches how a user visually scans the Filters screen top to
// bottom — course is the most identifying single field for most saved
// results, followed by race type/going/class/country.
const AUTO_NAME_FIELD_ORDER: { key: string; label: string }[] = [
  { key: "courses", label: "" },
  { key: "raceTypes", label: "" },
  { key: "goings", label: "" },
  { key: "raceClasses", label: "" },
  { key: "countries", label: "" },
];

function firstNonEmptyFilterValue(filters: Record<string, string>): string | null {
  for (const { key } of AUTO_NAME_FIELD_ORDER) {
    const value = filters[key]?.trim();
    if (value) return value.split(",")[0];
  }
  return null;
}

// Independent from the frontend's own preview helper
// (client/src/utils/savedResultName.ts) — this repo has no shared code path
// between src/ and client/src/, so this is the authoritative fallback used
// whenever the user leaves the save dialog's name field blank.
export function buildAutoName(filters: Record<string, string>): string {
  const dateRange =
    filters.minDate && filters.maxDate
      ? filters.minDate === filters.maxDate
        ? filters.minDate
        : `${filters.minDate} to ${filters.maxDate}`
      : new Date().toISOString().slice(0, 10);
  const descriptor = firstNonEmptyFilterValue(filters) ?? "All races";
  return `${descriptor} · ${dateRange}`;
}

// Parses a saved filter set's raw ISP_FILTER_PARAM_NAMES string map (see
// client/src/utils/ispUrlParams.ts) into ComputeSnapshotParams, using the
// exact same helpers/clamping /api/industry-sp/splits uses — so a filter
// set's snapshot (computeSplits below) and its live day-by-day rollup
// (LiveFilterResultService) are both computed from identical parsed params,
// never a second, silently-drifting parse of the same filters map. Moved
// here from router.ts (formerly private to it) so both call sites share one
// implementation without router.ts depending on this service, or vice versa.
export function computeSnapshotParamsFromFilters(filters: Record<string, string>): ComputeSnapshotParams {
  const { minRaceTime, maxRaceTime } = parseDateRangeParams(filters.minDate, filters.maxDate);
  // Same "omit entirely means let getSplitStats compute the default 50/50
  // split" convention as /api/industry-sp/splits above — a saved result
  // from before an explicit split edit (or one that never touched the
  // split boxes) has no fromRowA/etc in its filters map at all, which is
  // exactly what should resolve to the default divide here too.
  const fromRowARaw = parseInt(filters.fromRowA);
  const toRowARaw = parseInt(filters.toRowA);
  const fromRowBRaw = parseInt(filters.fromRowB);
  const toRowBRaw = parseInt(filters.toRowB);
  const fromRowA = isNaN(fromRowARaw) ? null : Math.max(1, fromRowARaw);
  const toRowA = isNaN(toRowARaw) ? null : Math.max(1, toRowARaw);
  const fromRowB = isNaN(fromRowBRaw) ? null : Math.max(1, fromRowBRaw);
  const toRowB = isNaN(toRowBRaw) ? null : Math.max(1, toRowBRaw);
  return {
    minRunners: Math.max(1, parseInt(filters.minRunners) || 1),
    maxRunners: Math.min(100, Math.max(1, parseInt(filters.maxRunners) || 30)),
    countries: parseCsvListParam(filters.countries),
    minIsp: Math.max(1, parseFloat(filters.minIsp) || 1),
    maxIsp: Math.min(100000, parseFloat(filters.maxIsp) || 1000),
    minInIspRange: Math.max(1, parseInt(filters.minInIspRange) || 1),
    maxInIspRange: Math.min(10000, Math.max(1, parseInt(filters.maxInIspRange) || 10000)),
    fromRowA,
    toRowA,
    fromRowB,
    toRowB,
    minRaceTime,
    maxRaceTime,
    courses: parseCsvListParam(filters.courses),
    goings: parseCsvListParam(filters.goings),
    raceClasses: parseCsvListParam(filters.raceClasses),
    raceTypes: parseCsvListParam(filters.raceTypes),
    trainerSearch: filters.trainer?.trim() || null,
    jockeySearch: filters.jockey?.trim() || null,
    trainerFormMinWinRate: Math.min(100, Math.max(0, parseFloat(filters.trainerFormMinWinRate) || 0)),
    minTrainerFormRunners: filters.hasTrainerForm === "true" ? 1 : 0,
    maxTrainerFormRunners: 100,
    minModelWinProbability: Math.min(100, Math.max(0, parseFloat(filters.minModelWinProbability) || 0)),
    onlyModelBeatsSp: filters.onlyModelBeatsSp === "true",
    minModelSpEdgePts: Math.min(100, Math.max(0, parseFloat(filters.minModelSpEdgePts) || 0)),
    // Errors are discarded rather than thrown here, unlike the live routes: a
    // saved set's map was validated when it was saved, and a stored filter that
    // has since been disabled (a field going 100% null, say) should degrade to
    // "that clause no longer applies" rather than making an existing saved
    // result permanently un-openable.
    dynamicFilters: parseDynamicFilters(filters).filters,
  };
}

export class SavedFilterSetService {
  private savedFilterSetDAO: SavedFilterSetDAO;
  private industrySpService: IndustrySpService;

  constructor(savedFilterSetDAO?: SavedFilterSetDAO, industrySpService?: IndustrySpService) {
    if (savedFilterSetDAO) {
      this.savedFilterSetDAO = savedFilterSetDAO;
    } else {
      const db = DatabaseConnection.getInstance().getDb();
      this.savedFilterSetDAO = new SavedFilterSetDAO(db);
    }
    this.industrySpService = industrySpService ?? new IndustrySpService();
  }

  // Same resolver the live /api/industry-sp/splits route uses — resolves
  // explicit fromRowA/toRowA/fromRowB/toRowB if the caller set them, or the
  // default half/half divide otherwise, so a saved snapshot's Split A/B
  // always match what the Filters screen itself was showing at save time
  // (never a re-derived or approximated range). Shared by saveResult and
  // saveAgentResult so there's exactly one call site for these aggregations.
  private async computeSplits(
    computeParams: ComputeSnapshotParams
  ): Promise<{ splitA: SavedFilterSetSplit; splitB: SavedFilterSetSplit }> {
    const splits = await this.industrySpService.getSplitStats(
      computeParams.minRunners,
      computeParams.maxRunners,
      computeParams.countries,
      computeParams.minIsp,
      computeParams.maxIsp,
      computeParams.minInIspRange,
      computeParams.maxInIspRange,
      computeParams.fromRowA,
      computeParams.toRowA,
      computeParams.fromRowB,
      computeParams.toRowB,
      computeParams.minRaceTime,
      computeParams.maxRaceTime,
      computeParams.courses,
      computeParams.goings,
      computeParams.raceClasses,
      computeParams.raceTypes,
      computeParams.trainerSearch,
      computeParams.jockeySearch,
      computeParams.trainerFormMinWinRate,
      computeParams.minTrainerFormRunners,
      computeParams.maxTrainerFormRunners,
      computeParams.minModelWinProbability,
      computeParams.onlyModelBeatsSp,
      SAVE_SNAPSHOT_MAX_ROWS,
      computeParams.minModelSpEdgePts,
      false,
      false,
      computeParams.dynamicFilters
    );

    const [pointsA, pointsB] = await Promise.all([
      this.industrySpService.getRaceConvergenceSeries(
        computeParams.minRunners, computeParams.maxRunners, computeParams.countries,
        computeParams.minIsp, computeParams.maxIsp, computeParams.minInIspRange, computeParams.maxInIspRange,
        computeParams.minRaceTime, computeParams.maxRaceTime,
        computeParams.courses, computeParams.goings, computeParams.raceClasses, computeParams.raceTypes,
        computeParams.trainerSearch, computeParams.jockeySearch,
        computeParams.trainerFormMinWinRate, computeParams.minTrainerFormRunners, computeParams.maxTrainerFormRunners,
        computeParams.minModelWinProbability, computeParams.onlyModelBeatsSp,
        splits.splitA.fromRow, splits.splitA.toRow ?? splits.totalRaces, computeParams.minModelSpEdgePts
      ),
      this.industrySpService.getRaceConvergenceSeries(
        computeParams.minRunners, computeParams.maxRunners, computeParams.countries,
        computeParams.minIsp, computeParams.maxIsp, computeParams.minInIspRange, computeParams.maxInIspRange,
        computeParams.minRaceTime, computeParams.maxRaceTime,
        computeParams.courses, computeParams.goings, computeParams.raceClasses, computeParams.raceTypes,
        computeParams.trainerSearch, computeParams.jockeySearch,
        computeParams.trainerFormMinWinRate, computeParams.minTrainerFormRunners, computeParams.maxTrainerFormRunners,
        computeParams.minModelWinProbability, computeParams.onlyModelBeatsSp,
        splits.splitB.fromRow, splits.splitB.toRow ?? splits.totalRaces, computeParams.minModelSpEdgePts
      ),
    ]);

    return {
      splitA: { ...splits.splitA, graphPoints: pointsA },
      splitB: { ...splits.splitB, graphPoints: pointsB },
    };
  }

  public async saveResult(
    userId: string,
    rawName: string | undefined,
    filters: Record<string, string>,
    computeParams: ComputeSnapshotParams
  ): Promise<SavedFilterSetApiResponse> {
    const { splitA, splitB } = await this.computeSplits(computeParams);
    const name = rawName?.trim() ? rawName.trim() : buildAutoName(filters);

    const doc = await this.savedFilterSetDAO.create({
      userId,
      name,
      filters,
      splitA,
      splitB,
      createdAt: new Date().toISOString(),
    });
    return toApiResponse(doc);
  }

  // Called by the ML training pipeline (via POST /api/saved-filter-sets/agent)
  // once per filter in its curated battery, right after a retrain — reuses
  // the exact same aggregation code path as saveResult so an agent result's
  // numbers mean exactly what the live Filters screen would show for the
  // same filters, just stored under the reserved AGENT_USER_ID and flagged
  // createdBy: "agent" so it's cross-user-visible but not user-owned.
  //
  // `experimentId` is the alternative provenance stamp, used by
  // ml/experiment.py: it posts its discovered segments here but never trains a
  // deployable model, so it has no model version to name. Exactly one of the
  // two is set, and both stay optional on the document, so production rows
  // predating either field keep meaning what they always did.
  //
  // WHAT AN EXPERIMENT MAY NOT POST. computeSplits above reads MODEL_PROB_FIELD
  // ("modelWinProbabilityOos") out of Mongo — the DEPLOYED walk-forward's
  // numbers, not the calling experiment's own predictions. A filter set
  // containing onlyModelBeatsSp / minModelWinProbability / minModelSpEdgePts
  // would therefore measure the OLD model under the new filters and file the
  // answer under the experiment's name: the exact shape of the 2026-08-04
  // incident where the Filters screen scored itself with a model that had
  // already seen the winners. experiment.py refuses to post those (see
  // MODEL_DEPENDENT_FILTER_PARAMS there); this note is here because the
  // constraint lives entirely in the caller and is invisible from this side.
  public async saveAgentResult(
    name: string,
    filters: Record<string, string>,
    computeParams: ComputeSnapshotParams,
    modelVersionId: string,
    experimentId?: string
  ): Promise<SavedFilterSetApiResponse> {
    const { splitA, splitB } = await this.computeSplits(computeParams);

    const doc = await this.savedFilterSetDAO.create({
      userId: AGENT_USER_ID,
      name,
      filters,
      splitA,
      splitB,
      createdAt: new Date().toISOString(),
      createdBy: "agent",
      ...(modelVersionId ? { modelVersionId } : {}),
      ...(experimentId ? { experimentId } : {}),
    });
    return toApiResponse(doc);
  }

  public async listForUser(userId: string): Promise<SavedFilterSetApiResponse[]> {
    const [ownDocs, agentDocs] = await Promise.all([
      this.savedFilterSetDAO.listByUser(userId),
      this.savedFilterSetDAO.listAgentGenerated(),
    ]);
    return [...ownDocs, ...agentDocs]
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map(toApiResponse);
  }

  public async getForUser(id: string, userId: string): Promise<SavedFilterSetApiResponse | null> {
    const doc = await this.savedFilterSetDAO.getByIdForUser(id, userId);
    if (doc) return toApiResponse(doc);
    // Not owned by this user — could still be an agent-generated result,
    // which any logged-in user is allowed to view (not private data).
    const agentDoc = await this.savedFilterSetDAO.getAgentGeneratedById(id);
    return agentDoc ? toApiResponse(agentDoc) : null;
  }

  public async deleteForUser(id: string, userId: string): Promise<boolean> {
    return this.savedFilterSetDAO.deleteByIdForUser(id, userId);
  }
}
