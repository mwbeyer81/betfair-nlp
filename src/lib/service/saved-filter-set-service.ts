import { SavedFilterSetDAO, SavedFilterSetDocument, SavedFilterSetSplit } from "../dao/saved-filter-set-dao";
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
  splitA: SavedFilterSetSplit;
  splitB: SavedFilterSetSplit;
  createdAt: string;
}

function toApiResponse(doc: SavedFilterSetDocument): SavedFilterSetApiResponse {
  return {
    id: doc._id!.toString(),
    name: doc.name,
    filters: doc.filters,
    splitA: doc.splitA,
    splitB: doc.splitB,
    createdAt: doc.createdAt,
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
    // Same resolver the live /api/industry-sp/splits route uses — resolves
    // explicit fromRowA/toRowA/fromRowB/toRowB if the caller set them, or
    // the default half/half divide otherwise, so a saved snapshot's Split
    // A/B always match what the Filters screen itself was showing at save
    // time (never a re-derived or approximated range).
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
      SAVE_SNAPSHOT_MAX_ROWS
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
        splits.splitA.fromRow, splits.splitA.toRow ?? splits.totalRaces
      ),
      this.industrySpService.getRaceConvergenceSeries(
        computeParams.minRunners, computeParams.maxRunners, computeParams.countries,
        computeParams.minIsp, computeParams.maxIsp, computeParams.minInIspRange, computeParams.maxInIspRange,
        computeParams.minRaceTime, computeParams.maxRaceTime,
        computeParams.courses, computeParams.goings, computeParams.raceClasses, computeParams.raceTypes,
        computeParams.trainerSearch, computeParams.jockeySearch,
        computeParams.trainerFormMinWinRate, computeParams.minTrainerFormRunners, computeParams.maxTrainerFormRunners,
        computeParams.minModelWinProbability, computeParams.onlyModelBeatsSp,
        splits.splitB.fromRow, splits.splitB.toRow ?? splits.totalRaces
      ),
    ]);

    const name = rawName?.trim() ? rawName.trim() : buildAutoName(filters);

    const doc = await this.savedFilterSetDAO.create({
      userId,
      name,
      filters,
      splitA: { ...splits.splitA, graphPoints: pointsA },
      splitB: { ...splits.splitB, graphPoints: pointsB },
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
