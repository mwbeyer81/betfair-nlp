import { Collection, Db, ObjectId } from "mongodb";

export interface LiveFilterResultPnlStats {
  staked: number;
  returns: number;
  pnl: number;
  count: number;
}

// One document per (savedFilterSetId, meetingId, raceDate) — the live,
// day-by-day counterpart to SavedFilterSetDocument's one-time splitA/splitB
// backtest snapshot (see saved-filter-set-dao.ts). Written by
// LiveFilterResultService.captureLiveResultsForDate, chained onto the same
// daily results-capture cron that populates industry_starting_prices, so
// this only ever reflects races RacingAPI has actually reported as finished
// — never a projection or estimate.
export interface LiveFilterResultDocument {
  _id?: ObjectId;
  savedFilterSetId: ObjectId;
  // Snapshot of the filter set's own filters map at capture time, same shape
  // as SavedFilterSetDocument.filters — kept here too (not just joined via
  // savedFilterSetId) so a historical row still means the same thing even if
  // the parent filter set is ever edited or deleted.
  filters: Record<string, string>;
  modelVersionId: string | null;
  raceDate: string;
  meetingId: string;
  meetingName: string;
  pnlStats: LiveFilterResultPnlStats;
  capturedAt: string;
}

export class LiveFilterResultDAO {
  private collection: Collection<LiveFilterResultDocument>;

  constructor(db: Db, collectionName = "saved_filter_set_live_results") {
    this.collection = db.collection<LiveFilterResultDocument>(collectionName);
  }

  public async createIndexes(): Promise<void> {
    try {
      await this.collection.createIndex(
        { savedFilterSetId: 1, meetingId: 1, raceDate: 1 },
        { unique: true }
      );
    } catch (err) {
      console.warn("createIndex failed for live-filter-result unique key (non-fatal):", err);
    }
    console.log("Live filter result indexes ensured");
  }

  // Idempotent by (savedFilterSetId, meetingId, raceDate) — safe to re-run
  // captureLiveResultsForDate for the same date more than once (e.g. a
  // manual re-trigger after a partial failure).
  public async upsertMany(docs: Omit<LiveFilterResultDocument, "_id">[]): Promise<void> {
    if (docs.length === 0) return;
    await this.collection.bulkWrite(
      docs.map(doc => ({
        updateOne: {
          filter: {
            savedFilterSetId: doc.savedFilterSetId,
            meetingId: doc.meetingId,
            raceDate: doc.raceDate,
          },
          update: { $set: doc },
          upsert: true,
        },
      })),
      { ordered: false }
    );
  }

  public async listBySavedFilterSetId(savedFilterSetId: ObjectId): Promise<LiveFilterResultDocument[]> {
    return this.collection.find({ savedFilterSetId }).sort({ raceDate: -1, meetingId: 1 }).toArray();
  }
}
