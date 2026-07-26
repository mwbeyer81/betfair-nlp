import { SavedFilterSetDAO, SavedFilterSetDocument, SavedFilterSetGraphPoint, SavedFilterSetPnlStats } from "../dao/saved-filter-set-dao";
import { IndustrySpService } from "./industry-sp-service";
import { DatabaseConnection } from "../../config/database";

// A snapshot is computed once, at save time, over the full qualifying set
// (not paginated) — mirrors the authenticated race cap used elsewhere
// (router.ts's clampRowSpan / getSplitStats raceCap).
const SAVE_SNAPSHOT_MAX_ROWS = 10000;

export interface SavedFilterSetApiResponse {
  id: string;
  name: string;
  filters: Record<string, string>;
  pnlStats: SavedFilterSetPnlStats;
  graphPoints: SavedFilterSetGraphPoint[];
  createdAt: string;
}

function toApiResponse(doc: SavedFilterSetDocument): SavedFilterSetApiResponse {
  return {
    id: doc._id!.toString(),
    name: doc.name,
    filters: doc.filters,
    pnlStats: doc.pnlStats,
    graphPoints: doc.graphPoints,
    createdAt: doc.createdAt,
  };
}

// Params needed to recompute a filter set's qualifying races — same shape
// IndustrySpService.getRaceConvergenceSeries already takes. Built by the
// router from the raw filters string map (see POST /api/saved-filter-sets).
export interface ComputeSnapshotParams {
  minRunners: number;
  maxRunners: number;
  countries: string[];
  minIsp: number;
  maxIsp: number;
  minInIspRange: number;
  maxInIspRange: number;
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

  public async saveResult(
    userId: string,
    rawName: string | undefined,
    filters: Record<string, string>,
    computeParams: ComputeSnapshotParams
  ): Promise<SavedFilterSetApiResponse> {
    const points = await this.industrySpService.getRaceConvergenceSeries(
      computeParams.minRunners,
      computeParams.maxRunners,
      computeParams.countries,
      computeParams.minIsp,
      computeParams.maxIsp,
      computeParams.minInIspRange,
      computeParams.maxInIspRange,
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
      1,
      SAVE_SNAPSHOT_MAX_ROWS
    );

    const last = points[points.length - 1];
    const pnlStats: SavedFilterSetPnlStats = {
      staked: last?.cumulativeStaked ?? 0,
      returns: last?.cumulativeReturns ?? 0,
      pnl: last?.cumulativePnl ?? 0,
      count: points.length,
    };
    const name = rawName?.trim() ? rawName.trim() : buildAutoName(filters);

    const doc = await this.savedFilterSetDAO.create({
      userId,
      name,
      filters,
      pnlStats,
      graphPoints: points,
      createdAt: new Date().toISOString(),
    });
    return toApiResponse(doc);
  }

  public async listForUser(userId: string): Promise<SavedFilterSetApiResponse[]> {
    const docs = await this.savedFilterSetDAO.listByUser(userId);
    return docs.map(toApiResponse);
  }

  public async getForUser(id: string, userId: string): Promise<SavedFilterSetApiResponse | null> {
    const doc = await this.savedFilterSetDAO.getByIdForUser(id, userId);
    return doc ? toApiResponse(doc) : null;
  }

  public async deleteForUser(id: string, userId: string): Promise<boolean> {
    return this.savedFilterSetDAO.deleteByIdForUser(id, userId);
  }
}
