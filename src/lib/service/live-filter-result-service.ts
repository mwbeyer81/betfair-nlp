import { Db, ObjectId } from "mongodb";
import { DatabaseConnection } from "../../config/database";
import { LiveFilterResultDAO, LiveFilterResultDocument } from "../dao/live-filter-result-dao";
import { SavedFilterSetDAO } from "../dao/saved-filter-set-dao";
import { IndustrySpService } from "./industry-sp-service";
import { computeSnapshotParamsFromFilters } from "./saved-filter-set-service";

export interface LiveFilterResultApiResponse {
  raceDate: string;
  meetingId: string;
  meetingName: string;
  modelVersionId: string | null;
  pnlStats: { staked: number; returns: number; pnl: number; count: number };
}

function toApiResponse(doc: LiveFilterResultDocument): LiveFilterResultApiResponse {
  return {
    raceDate: doc.raceDate,
    meetingId: doc.meetingId,
    meetingName: doc.meetingName,
    modelVersionId: doc.modelVersionId,
    pnlStats: doc.pnlStats,
  };
}

export class LiveFilterResultService {
  private liveFilterResultDAO: LiveFilterResultDAO;
  private savedFilterSetDAO: SavedFilterSetDAO;
  private industrySpService: IndustrySpService;

  constructor(db?: Db, liveFilterResultDAO?: LiveFilterResultDAO, savedFilterSetDAO?: SavedFilterSetDAO, industrySpService?: IndustrySpService) {
    const resolvedDb = db || DatabaseConnection.getInstance().getDb();
    this.liveFilterResultDAO = liveFilterResultDAO || new LiveFilterResultDAO(resolvedDb);
    this.savedFilterSetDAO = savedFilterSetDAO || new SavedFilterSetDAO(resolvedDb);
    this.industrySpService = industrySpService || new IndustrySpService();
  }

  public async createIndexes(): Promise<void> {
    return this.liveFilterResultDAO.createIndexes();
  }

  /** For every user-saved filter set (agent-generated training-battery rows
   * excluded — this is a user's own live track record, not a training
   * artifact), computes that date's qualifying meetings/P&L against
   * whatever RacingAPI results have just been captured into
   * industry_starting_prices, and upserts one saved_filter_set_live_results
   * doc per (filter set, meeting). Chained onto the existing 21:30 UTC
   * capture-results cron, right after captureTodayResults() — see
   * apps/lambda/src/handler.ts. A meeting with zero qualifying runners for
   * a given filter set produces no row at all (nothing to upsert), same
   * "absence means no match" convention getAllRacesByRace's pnlStats uses. */
  public async captureLiveResultsForDate(date: string): Promise<{ filterSetsProcessed: number; rowsUpserted: number }> {
    const allFilterSets = await this.savedFilterSetDAO.listAllUserOwned();
    let rowsUpserted = 0;

    for (const filterSet of allFilterSets) {
      const params = computeSnapshotParamsFromFilters(filterSet.filters);
      const meetings = await this.industrySpService.getQualifyingResultsByMeetingForDate({
        raceDate: date,
        countries: params.countries,
        minRunners: params.minRunners,
        maxRunners: params.maxRunners,
        minIsp: params.minIsp,
        maxIsp: params.maxIsp,
        minInIspRange: params.minInIspRange,
        maxInIspRange: params.maxInIspRange,
        courses: params.courses,
        goings: params.goings,
        raceClasses: params.raceClasses,
        raceTypes: params.raceTypes,
        trainerSearch: params.trainerSearch,
        jockeySearch: params.jockeySearch,
        trainerFormMinWinRate: params.trainerFormMinWinRate,
        minTrainerFormRunners: params.minTrainerFormRunners,
        maxTrainerFormRunners: params.maxTrainerFormRunners,
        minModelWinProbability: params.minModelWinProbability,
        onlyModelBeatsSp: params.onlyModelBeatsSp,
      });

      if (meetings.length === 0) continue;

      await this.liveFilterResultDAO.upsertMany(
        meetings.map(m => ({
          savedFilterSetId: filterSet._id as ObjectId,
          filters: filterSet.filters,
          modelVersionId: m.modelVersionId,
          raceDate: m.raceDate,
          meetingId: m.meetingId,
          meetingName: m.meetingName,
          pnlStats: m.pnlStats,
          capturedAt: new Date().toISOString(),
        }))
      );
      rowsUpserted += meetings.length;
    }

    return { filterSetsProcessed: allFilterSets.length, rowsUpserted };
  }

  public async listForFilterSet(savedFilterSetId: string): Promise<LiveFilterResultApiResponse[]> {
    if (!ObjectId.isValid(savedFilterSetId)) return [];
    const docs = await this.liveFilterResultDAO.listBySavedFilterSetId(new ObjectId(savedFilterSetId));
    return docs.map(toApiResponse);
  }
}
